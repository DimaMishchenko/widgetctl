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
    (error) =>
      error instanceof WidgetctlError &&
      error.cause === cause &&
      /Native worker unavailable/.test(error.message),
  );
  assert.throws(() => createController({ udid: "" }), WidgetctlError);
});

test("queued operations snapshot targets, ensure options and configuration at invocation", async () => {
  const { calls, runner } = mock();
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const controller = createController({ udid: "DEVICE" }, async (options) => {
    if (options.mode === "prepare") await blocked;
    return runner(options);
  });
  const preparing = controller.prepare();
  const selected = { ...target };
  const options = {
    exclusive: false,
    replace: false,
    position: "top" as const,
  };
  const ensuring = controller.ensure(selected, options);
  const exporting = controller.exportConfiguration(selected);
  const value = structuredClone(config);
  const applying = controller.applyConfiguration(selected, value);
  selected.extension = "other.widgets";
  selected.kind = "Other";
  options.exclusive = true;
  options.replace = true;
  value.intent.parameters.amount = 99;
  unblock();
  await preparing;
  const handle = await ensuring;
  await exporting;
  await applying;
  assert.deepEqual(handle.target, { ...target, iconIdentifier: "exact-icon" });
  assert.ok(
    calls
      .slice(1)
      .every(
        (call) =>
          call.extension === target.extension && call.kind === target.kind,
      ),
  );
  assert.equal(calls[1].exclusive, false);
  assert.equal(calls[1].replace, false);
  assert.equal(calls[3].configuration!.intent.parameters.amount, 2);

  const updated = structuredClone(config);
  const pending = handle.applyConfiguration(updated);
  updated.intent.parameters.amount = 123;
  assert.equal((await pending).intent.parameters.amount, 2);
});

test("configuration rejects array accessors and non-JSON array properties without reading getters", async () => {
  const { calls, runner } = mock();
  const controller = createController({ udid: "DEVICE" }, runner);
  let getterReads = 0;
  const accessor = [1];
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    get() {
      getterReads++;
      return 1;
    },
  });
  const extra = Object.assign([1], { metadata: "lost by JSON" });
  const symbol = [1];
  Object.defineProperty(symbol, Symbol("metadata"), { value: 1 });
  const hidden = [1];
  Object.defineProperty(hidden, "0", { enumerable: false });
  class CustomArray extends Array<number> {}
  const invalid = [
    accessor,
    extra,
    symbol,
    hidden,
    new CustomArray(1),
    Array(1),
    [undefined],
    [Infinity],
  ];
  for (const values of invalid) {
    const value = structuredClone(config);
    value.intent.parameters.values = values as any;
    let pending!: Promise<WidgetConfiguration>;
    assert.doesNotThrow(() => {
      pending = controller.applyConfiguration(target, value);
    });
    await assert.rejects(pending, WidgetctlError);
  }
  assert.equal(getterReads, 0);
  assert.equal(calls.length, 0);
  const value = structuredClone(config);
  const shared = { opaque: true };
  value.intent.parameters.values = [
    shared,
    shared,
    [],
    [null, false, 3, "entity"],
  ];
  assert.deepEqual(
    (await controller.applyConfiguration(target, value)).intent.parameters,
    value.intent.parameters,
  );
});

test("input validation rejects promises without breaking subsequent operations", async () => {
  const { runner } = mock();
  const controller = createController({ udid: "DEVICE" }, runner);
  let pending!: Promise<unknown>;
  assert.doesNotThrow(() => {
    pending = controller.ensure({ ...target, kind: "" });
  });
  await assert.rejects(pending, WidgetctlError);
  await controller.inspect();
});

test("structured operation failures include the backend diagnosis", async () => {
  const result = {
    status: "worker_rejected",
    error: "Unsupported widget family",
    timings: {},
  };
  const controller = createController({ udid: "DEVICE" }, async () => result);
  await assert.rejects(
    controller.prepare(),
    (error) =>
      error instanceof WidgetctlError &&
      error.result === result &&
      /Unsupported widget family/.test(error.message),
  );
});

test(
  "mutator reentrancy rejects without blocking external queued operations or release",
  { timeout: 2000 },
  async () => {
    const { calls, runner } = mock();
    const controller = createController({ udid: "DEVICE" }, runner);
    const handle = await controller.ensure(target);
    let started!: () => void;
    let proceed!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const continuing = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const update = handle.updateConfiguration(async () => {
      started();
      await continuing;
      await controller.inspect();
    });
    const rejected = assert.rejects(
      update,
      (error) =>
        error instanceof WidgetctlError &&
        /mutators cannot call operations on the same controller/.test(
          error.message,
        ),
    );
    await entered;
    const inspected = controller.inspect();
    assert.deepEqual(
      calls.map((call) => call.mode),
      ["ensure", "exportConfiguration"],
    );
    proceed();
    await rejected;
    await inspected;
    await controller.release();
    assert.deepEqual(
      calls.map((call) => call.mode),
      ["ensure", "exportConfiguration", "inspect", "unload"],
    );
  },
);

test("mutator descendants may call the controller after their mutator settles", async () => {
  const { calls, runner } = mock();
  const controller = createController({ udid: "DEVICE" }, runner);
  const handle = await controller.ensure(target);
  let proceed!: () => void;
  let descendant!: Promise<BackendResult>;
  const continuing = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  await handle.updateConfiguration((parameters) => {
    parameters.amount = 8;
    descendant = continuing.then(() => controller.inspect());
  });
  proceed();
  await descendant;
  await controller.release();
  assert.deepEqual(
    calls.map((call) => call.mode),
    [
      "ensure",
      "exportConfiguration",
      "applyConfiguration",
      "inspect",
      "unload",
    ],
  );
});

test("persisted outcome failures expose verification_error when error is absent", async () => {
  const result = {
    status: "position_unverified",
    verification_error: "Widget is not at index zero of its original Home page",
    timings: {},
  };
  const controller = createController({ udid: "DEVICE" }, async () => result);
  await assert.rejects(
    controller.prepare(),
    (error) =>
      error instanceof WidgetctlError &&
      error.result === result &&
      error.message.includes(result.verification_error),
  );
});

test("catalog and existing widget binding do not create or reveal widgets", async () => {
  const calls: BackendOptions[] = [];
  const installed = {
    target: { ...target, iconIdentifier: "existing-icon" },
    widgetIdentifier: "existing-widget",
    position: { page: 0, index: 2 },
  };
  const catalog = {
    apps: [{ bundleIdentifier: "example", name: "Example App", widgets: [] }],
  };
  const controller = createController({ udid: "DEVICE" }, async (options) => {
    calls.push(options);
    if (options.mode === "catalog")
      return { status: "catalogued", catalog, timings: {} };
    if (options.mode === "installedWidgets")
      return { status: "listed", widgets: [installed], timings: {} };
    return { status: "removed", timings: {} };
  });
  assert.deepEqual(await controller.catalog(), catalog);
  assert.deepEqual(await controller.installedWidgets(), [installed]);
  const handle = await controller.getWidget("EXISTING-ICON");
  assert.equal(handle.iconIdentifier, "existing-icon");
  await handle.remove();
  assert.deepEqual(
    calls.map((call) => call.mode),
    ["catalog", "installedWidgets", "installedWidgets", "remove"],
  );
  assert.equal(calls.at(-1)!.iconIdentifier, "existing-icon");
  await assert.rejects(controller.getWidget("missing-icon"), /exactly one/);
});

test("descriptions use validated canonical configuration and compiler metadata", async () => {
  const controller = createController(
    { udid: "DEVICE" },
    async (options) =>
      options.mode === "ensure"
        ? { status: "verified", iconIdentifier: "existing-icon", timings: {} }
        : options.mode === "exportConfiguration"
          ? {
              status: "configuration_exported",
              configuration: config,
              numberFormat: { locale: "en_US", decimalSeparator: "." },
              timings: {},
            }
          : {
              status: "configuration_described",
              description: {
                configuration: config,
                numberFormat: { locale: "en_US", decimalSeparator: "." },
                fields: [],
              },
              timings: {},
            },
    async (udid, value) => {
      assert.equal(udid, "DEVICE");
      assert.deepEqual(value, config);
      return {
        version: 1,
        actions: {
          Choose: {
            identifier: "Choose",
            parameters: [
              {
                name: "amount",
                title: { key: "Amount" },
                isOptional: false,
                valueType: { primitive: { wrapper: { typeIdentifier: 7 } } },
              },
            ],
          },
        },
      };
    },
  );
  const handle = await controller.ensure(target);
  const description = await handle.describeConfiguration();
  assert.equal(
    description.fields.find((field) => field.key === "amount")!.type,
    "number",
  );
  assert.equal(
    description.fields.find((field) => field.key === "nested")!.type,
    "unsupported",
  );
});

test("optimistic applies snapshot and validate expected configuration before queueing", async () => {
  const { calls, runner } = mock();
  const controller = createController({ udid: "DEVICE" }, runner);
  const handle = await controller.ensure(target);
  const expected = structuredClone(config);
  const pending = handle.applyConfiguration(config, { expected });
  expected.intent.parameters.amount = 99;
  await pending;
  assert.equal(
    calls.at(-1)!.expectedConfiguration!.intent.parameters.amount,
    2,
  );
  const before = calls.length;
  await assert.rejects(
    handle.applyConfiguration(config, {
      expected: { ...config, kind: "Wrong" },
    }),
    WidgetctlError,
  );
  assert.equal(calls.length, before);
  await handle.updateConfiguration((parameters) => {
    parameters.amount = 12;
  });
  assert.equal(
    calls.at(-1)!.expectedConfiguration!.intent.parameters.amount,
    2,
  );
  assert.equal(calls.at(-1)!.configuration!.intent.parameters.amount, 12);
});

test("bound handles reject configurations explicitly bound to another installed icon", async () => {
  const { calls, runner } = mock();
  const controller = createController({ udid: "DEVICE" }, runner);
  const handle = await controller.ensure(target);
  const before = calls.length;
  await assert.rejects(
    handle.applyConfiguration({ ...config, iconIdentifier: "other-icon" }),
    /does not match/,
  );
  await assert.rejects(
    handle.applyConfiguration(config, {
      expected: { ...config, iconIdentifier: "other-icon" },
    }),
    /does not match/,
  );
  assert.equal(calls.length, before);
});

test("installed listing rejects shared persisted widget identities", async () => {
  const controller = createController({ udid: "DEVICE" }, async () => ({
    status: "listed",
    timings: {},
    widgets: [
      {
        target: { ...target, iconIdentifier: "first" },
        widgetIdentifier: "shared",
      },
      {
        target: { ...target, iconIdentifier: "second" },
        widgetIdentifier: "shared",
      },
    ],
  }));
  await assert.rejects(
    controller.installedWidgets(),
    /ambiguous installed widget identity/,
  );
});

test("entity choices preserve native canonical envelopes and validate query inputs before queueing", async () => {
  const calls: BackendOptions[] = [];
  const choice = {
    label: "Fern",
    value: { entity: { identifier: "fern", opaque: ["native", 3] } },
  };
  const controller = createController(
    { udid: "DEVICE" },
    async (options) => {
      calls.push(structuredClone(options));
      if (options.mode === "ensure")
        return {
          status: "verified",
          iconIdentifier: "exact-icon",
          timings: {},
        };
      if (options.mode === "exportConfiguration")
        return {
          status: "configuration_exported",
          configuration: structuredClone(config),
          timings: {},
        };
      if (options.parameterKey === "amount")
        return {
          status: "worker_rejected",
          error: "Unsupported entity parameter",
          timings: {},
        };
      return {
        status: "configuration_choices",
        choices: [choice],
        timings: {},
      };
    },
    async () => ({
      version: 1,
      actions: {
        Choose: {
          identifier: "Choose",
          parameters: [
            {
              name: "plant",
              title: { key: "Plant" },
              isOptional: true,
              valueType: { entity: { wrapper: { typeName: "Plant" } } },
            },
          ],
        },
      },
      entities: { Plant: { mangledTypeName: "12TestAppPlant" } },
    }),
  );
  const widget = await controller.ensure(target);
  const draft = structuredClone(config);
  draft.intent.parameters.amount = 7;
  const pending = widget.configurationChoices("plant", "fer", {
    configuration: draft,
    expected: config,
  });
  draft.intent.parameters.amount = 99;
  const result = await pending;
  assert.equal(calls.at(-1)!.configuration!.intent.parameters.amount, 7);
  assert.equal(
    calls.at(-1)!.expectedConfiguration!.intent.parameters.amount,
    2,
  );
  assert.deepEqual(result, [choice]);
  assert.equal(calls.at(-1)!.parameterKey, "plant");
  assert.equal(calls.at(-1)!.search, "fer");
  assert.equal(calls.at(-1)!.iconIdentifier, "exact-icon");
  result[0]!.label = "changed";
  assert.equal(choice.label, "Fern");
  const count = calls.length;
  await assert.rejects(
    widget.configurationChoices("plant", "x".repeat(1025)),
    /at most/,
  );
  assert.equal(calls.length, count);
  await assert.rejects(
    widget.configurationChoices("amount"),
    /Unsupported entity parameter/,
  );
  assert.equal(calls.at(-1)!.mode, "configurationChoices");
});

test("cancelled queued entity searches do no backend work and do not delay release", async () => {
  const calls: string[] = [];
  let unblock!: () => void;
  const blocking = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const controller = createController({ udid: "DEVICE" }, async (options) => {
    calls.push(options.mode);
    if (options.mode === "ensure")
      return { status: "verified", iconIdentifier: "exact-icon", timings: {} };
    if (options.mode === "prepare") {
      await blocking;
      return { status: "ready", timings: {} };
    }
    if (options.mode === "unload") return { status: "unloaded", timings: {} };
    throw Error("Abandoned search reached backend");
  });
  const widget = await controller.ensure(target);
  const preparing = controller.prepare();
  const abort = new AbortController();
  const search = widget.configurationChoices("plant", "fer", {
    signal: abort.signal,
  });
  const rejected = assert.rejects(search, /abort/i);
  abort.abort();
  const release = controller.release();
  unblock();
  await Promise.all([preparing, rejected, release]);
  assert.deepEqual(calls, ["ensure", "prepare", "unload"]);
});
