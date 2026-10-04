import test from "node:test";
import assert from "node:assert/strict";
import {
  createController,
  WidgetctlError,
  type WidgetConfiguration,
} from "../src/controller.js";
import type { BackendOptions, BackendResult } from "../src/backend.js";
const target = {
  extension: "example.widgets",
  kind: "Example",
  size: "small" as const,
  container: "example",
};
const config: WidgetConfiguration = {
  schemaVersion: 1,
  ...target,
  intent: {
    intentClass: "INAppIntent",
    appBundleIdentifier: "example",
    extensionBundleIdentifier: "example.widgets",
    appIntentIdentifier: "Choose",
    parameters: { amount: 2, nested: { opaque: ["entity", 1] } },
  },
};
const statuses = {
  prepare: "ready",
  unload: "unloaded",
  inspect: "inspected",
  ensure: "verified",
  remove: "removed",
  exportConfiguration: "configuration_exported",
  applyConfiguration: "configuration_applied",
};
function mock() {
  const calls: BackendOptions[] = [];
  const runner = async (options: BackendOptions): Promise<BackendResult> => {
    calls.push(structuredClone(options));
    return {
      status: statuses[options.mode],
      timings: {},
      iconIdentifier: "exact-icon",
      configuration: structuredClone(options.configuration ?? config),
    };
  };
  return { calls, runner };
}
test("explicit device and exact handle identity survive every operation; release only unloads", async () => {
  const { calls, runner } = mock();
  const controller = createController({ udid: "DEVICE" }, runner);
  await controller.prepare();
  const handle = await controller.ensure(target, { exclusive: true });
  await handle.reveal();
  assert.deepEqual(await handle.parameters(), config.intent.parameters);
  await handle.remove();
  await controller.release();
  assert.deepEqual(
    calls.map((c) => c.mode),
    ["prepare", "ensure", "ensure", "exportConfiguration", "remove", "unload"],
  );
  assert.ok(calls.every((c) => c.udid === "DEVICE"));
  assert.ok(calls.slice(2, 5).every((c) => c.iconIdentifier === "exact-icon"));
  assert.equal(calls[2].position, "top");
  assert.equal(calls[1].exclusive, true);
});
test("failed operations preserve structured result and leave serialization usable", async () => {
  const failure = {
    status: "identity_mismatch",
    timings: { inspect: 4 },
    detail: { expected: "X" },
  };
  const sequence: string[] = [];
  let active = 0;
  const controller = createController({ udid: "DEVICE" }, async (options) => {
    assert.equal(active++, 0);
    sequence.push(options.mode);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return options.mode === "prepare"
      ? failure
      : { status: statuses[options.mode], timings: {} };
  });
  const failed = controller.prepare();
  const inspected = controller.inspect();
  await assert.rejects(
    failed,
    (error) => error instanceof WidgetctlError && error.result === failure,
  );
  await inspected;
  await controller.release();
  assert.deepEqual(sequence, ["prepare", "inspect", "unload"]);
});
test("configuration read-modify-write is atomic in the controller queue and preserves opaque parameters", async () => {
  const { calls, runner } = mock();
  const controller = createController({ udid: "DEVICE" }, runner);
  const handle = await controller.ensure(target);
  const update = handle.updateConfiguration(async (draft) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    draft.amount = 10;
  });
  const inspect = controller.inspect();
  const updated = await update;
  await inspect;
  assert.equal(updated.intent.parameters.amount, 10);
  assert.deepEqual(
    updated.intent.parameters.nested,
    config.intent.parameters.nested,
  );
  assert.deepEqual(
    calls.map((c) => c.mode),
    ["ensure", "exportConfiguration", "applyConfiguration", "inspect"],
  );
  assert.equal(config.intent.parameters.amount, 2);
});
test("configuration validation rejects partial envelopes, identity changes and non-JSON before backend writes", async () => {
  const { calls, runner } = mock();
  const controller = createController({ udid: "DEVICE" }, runner);
  const invalid = [
    { ...config, kind: "Other" },
    { ...config, intent: { ...config.intent, parameters: { amount: NaN } } },
    {
      ...config,
      intent: { ...config.intent, parameters: { amount: undefined } },
    },
    {
      ...config,
      intent: { ...config.intent, parameters: { date: new Date() } },
    },
    { ...config, intent: { parameters: {} } },
  ];
  const cyclic: any = structuredClone(config);
  cyclic.intent.parameters.loop = cyclic;
  invalid.push(cyclic);
  for (const value of invalid)
    await assert.rejects(
      controller.applyConfiguration(target, value as WidgetConfiguration),
      WidgetctlError,
    );
  assert.equal(calls.length, 0);
  await controller.applyConfiguration(target, config);
  assert.equal(calls.length, 1);
});
test("backend throws retain cause and explicit UDID is mandatory", async () => {
  const cause = new Error("Native worker unavailable");
  const controller = createController({ udid: "DEVICE" }, async () => {
    throw cause;
  });
  await assert.rejects(
    controller.prepare(),
    (error) => error instanceof WidgetctlError && error.cause === cause,
  );
  assert.throws(() => createController({ udid: "" }), WidgetctlError);
});
