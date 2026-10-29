import test from "node:test";
import assert from "node:assert/strict";
import {
  createController,
  type WidgetCatalog,
  type WidgetConfiguration,
} from "../src/controller.js";
import { WidgetctlError } from "../src/errors.js";
import type { BackendOptions, BackendResult } from "../src/backend.js";
import type { ReadinessClock } from "../src/readiness.js";

const target = {
  container: "example",
  extension: "example.widgets",
  kind: "Example",
  size: "small" as const,
};
const empty: WidgetCatalog = { apps: [] };
const found = (): WidgetCatalog => ({
  apps: [
    {
      bundleIdentifier: target.container,
      name: "Example",
      widgets: [{ target: { ...target }, sizes: ["small"] }],
    },
  ],
});
function clock() {
  let elapsed = 0;
  const sleeps: number[] = [];
  const runtime: ReadinessClock = {
    now: () => elapsed,
    sleep: async (ms) => {
      sleeps.push(ms);
      elapsed += ms;
    },
  };
  return { runtime, sleeps, advance: (ms: number) => (elapsed += ms) };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};
function fixture(query: () => Promise<unknown>, time = clock()) {
  const calls: string[] = [];
  const requests: BackendOptions[] = [];
  const controller = createController(
    { udid: "OWNED-DEVICE" },
    async (options: BackendOptions): Promise<BackendResult> => {
      calls.push(options.mode);
      requests.push(options);
      assert.equal(options.udid, "OWNED-DEVICE");
      if (options.mode === "catalog")
        return { status: "catalogued", catalog: await query(), timings: {} };
      if (options.mode === "inspect")
        return { status: "inspected", timings: {} };
      throw Error(`Unexpected mutating operation: ${options.mode}`);
    },
    undefined,
    time.runtime,
  );
  return { controller, calls, requests, time };
}
const code = (expected: string) => (error: unknown) =>
  error instanceof WidgetctlError && error.code === expected;

test("descriptor wait polls only successful absence then returns on an exact descriptor", async () => {
  let query = 0;
  const f = fixture(async () => (++query === 1 ? empty : found()));
  await f.controller.waitForWidgetDescriptor(target, { timeoutMs: 1000 });
  assert.deepEqual(f.calls, ["catalog", "catalog"]);
  assert.deepEqual(f.time.sleeps, [250]);
  await f.controller.catalog();
  assert.deepEqual(f.calls, ["catalog", "catalog", "catalog"]);
  assert.deepEqual(
    f.requests.map((request) => request.requirePrepared),
    [true, true, undefined],
  );
});
for (const mismatch of ["container", "extension", "kind", "size"] as const) {
  test(`descriptor wait does not accept a different ${mismatch}`, async () => {
    const catalog = found();
    const widget = catalog.apps[0]!.widgets[0]!;
    if (mismatch === "size") widget.sizes = ["medium"];
    else if (mismatch === "container") {
      catalog.apps[0]!.bundleIdentifier = "other";
      widget.target.container = "other";
    } else widget.target[mismatch] = "other";
    const f = fixture(async () => catalog);
    await assert.rejects(
      f.controller.waitForWidgetDescriptor(target, { timeoutMs: 251 }),
      (error) => {
        assert.ok(code("DESCRIPTOR_TIMEOUT")(error));
        assert.match(
          (error as Error).message,
          /OWNED-DEVICE.*example.*1 apps, 1 descriptors/,
        );
        return true;
      },
    );
    assert.deepEqual(f.calls, ["catalog", "catalog"]);
    assert.deepEqual(f.time.sleeps, [250, 1]);
  });
}
for (const malformed of [
  null,
  {},
  { apps: null },
  { apps: [null] },
  { apps: [{ bundleIdentifier: "example", name: "Example", widgets: [{}] }] },
  {
    apps: [
      {
        ...found().apps[0],
        widgets: [{ ...found().apps[0]!.widgets[0], sizes: [] }],
      },
    ],
  },
]) {
  test(`malformed catalog fails once: ${JSON.stringify(malformed)}`, async () => {
    const f = fixture(async () => malformed);
    await assert.rejects(
      f.controller.waitForWidgetDescriptor(target, { timeoutMs: 1000 }),
      code("OPERATION_FAILED"),
    );
    assert.deepEqual(f.calls, ["catalog"]);
    assert.deepEqual(f.time.sleeps, []);
  });
}
test("duplicate descriptors and duplicate apps fail immediately", async () => {
  const descriptors = found();
  descriptors.apps[0]!.widgets.push(
    structuredClone(descriptors.apps[0]!.widgets[0]!),
  );
  const apps = found();
  apps.apps.push(structuredClone(apps.apps[0]!));
  for (const catalog of [descriptors, apps]) {
    const f = fixture(async () => catalog);
    await assert.rejects(
      f.controller.waitForWidgetDescriptor(target, { timeoutMs: 1000 }),
      code("AMBIGUOUS_TARGET"),
    );
    assert.deepEqual(f.calls, ["catalog"]);
  }
});
for (const failure of [
  "OWNERSHIP_LOST",
  "HELPER_UNAVAILABLE",
  "UNSUPPORTED_RUNTIME",
  "QUERY_FAILED",
  "APP_NOT_REGISTERED",
] as const) {
  test(`${failure} is propagated without polling`, async () => {
    const error = new WidgetctlError("original error", { code: failure });
    const f = fixture(async () => {
      throw error;
    });
    await assert.rejects(
      f.controller.waitForWidgetDescriptor(target, { timeoutMs: 1000 }),
      (received) => received === error,
    );
    assert.deepEqual(f.calls, ["catalog"]);
    assert.deepEqual(f.time.sleeps, []);
  });
}
test("backend failure status is not treated as catalog absence", async () => {
  const calls: string[] = [];
  const controller = createController(
    { udid: "OWNED-DEVICE" },
    async ({ mode }) => {
      calls.push(mode);
      return { status: "failed", errorCode: "OWNERSHIP_LOST", timings: {} };
    },
  );
  await assert.rejects(
    controller.waitForWidgetDescriptor(target, { timeoutMs: 1000 }),
    code("OWNERSHIP_LOST"),
  );
  assert.deepEqual(calls, ["catalog"]);
});
test("invalid arguments and budgets reject before any backend call", async () => {
  const f = fixture(async () => found());
  for (const timeoutMs of [0, -1, NaN, Infinity, 2_147_483_648, "100"])
    await assert.rejects(
      f.controller.waitForWidgetDescriptor(target, {
        timeoutMs: timeoutMs as number,
      }),
      code("INVALID_INPUT"),
    );
  for (const invalid of [
    null,
    {},
    { ...target, container: undefined },
    { ...target, extension: "" },
    { ...target, kind: " " },
    { ...target, size: "huge" },
  ])
    await assert.rejects(
      f.controller.waitForWidgetDescriptor(invalid as typeof target, {
        timeoutMs: 1000,
      }),
      code("INVALID_INPUT"),
    );
  await assert.rejects(
    f.controller.waitForWidgetDescriptor(target, undefined as never),
    code("INVALID_INPUT"),
  );
  await assert.rejects(
    f.controller.waitForWidgetDescriptor(target, {
      timeoutMs: 1000,
      signal: {} as AbortSignal,
    }),
    code("INVALID_INPUT"),
  );
  assert.deepEqual(f.calls, []);
});
test("the invocation snapshots arguments and includes time spent queued", async () => {
  const gate = deferred();
  const entered = deferred();
  const f = fixture(async () => {
    entered.resolve();
    await gate.promise;
    return found();
  });
  const existing = f.controller.catalog();
  await entered.promise;
  const pending = f.controller.waitForWidgetDescriptor(target, {
    timeoutMs: 100,
  });
  const rejected = assert.rejects(pending, (error) => {
    assert.ok(code("DESCRIPTOR_TIMEOUT")(error));
    assert.match(
      (error as Error).message,
      /controller queue.*no successful catalog query/,
    );
    return true;
  });
  f.time.advance(100);
  gate.resolve();
  await existing;
  await rejected;
  assert.deepEqual(f.calls, ["catalog"]);
});
test("queued target and options mutations cannot redirect or extend the wait", async () => {
  const f = fixture(async () => found());
  const selected = { ...target };
  const options = { timeoutMs: 1000 };
  const waiting = f.controller.waitForWidgetDescriptor(selected, options);
  selected.kind = "changed";
  options.timeoutMs = 0;
  await waiting;
  assert.deepEqual(f.calls, ["catalog"]);
});
for (const matches of [false, true]) {
  test(`late catalog response cannot succeed (${matches}) and blocks the next operation until drained`, async () => {
    const gate = deferred();
    const entered = deferred();
    const f = fixture(async () => {
      entered.resolve();
      await gate.promise;
      return matches ? found() : empty;
    });
    const pending = f.controller.waitForWidgetDescriptor(target, {
      timeoutMs: 100,
    });
    const rejected = assert.rejects(pending, code("DESCRIPTOR_TIMEOUT"));
    await entered.promise;
    f.time.advance(101);
    const inspect = f.controller.inspect();
    await Promise.resolve();
    assert.deepEqual(f.calls, ["catalog"]);
    gate.resolve();
    await rejected;
    await inspect;
    assert.deepEqual(f.calls, ["catalog", "inspect"]);
    assert.deepEqual(f.time.sleeps, []);
  });
}
test("pre-cancellation performs no query and uses read-only recovery", async () => {
  const f = fixture(async () => found());
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    f.controller.waitForWidgetDescriptor(target, {
      timeoutMs: 1000,
      signal: abort.signal,
    }),
    (error) => {
      assert.ok(code("CANCELLED")(error));
      assert.match(
        (error as WidgetctlError).recovery.join(),
        /no widget writes/,
      );
      return true;
    },
  );
  assert.deepEqual(f.calls, []);
});
test("cancellation during sleep prevents another catalog query", async () => {
  const entered = deferred();
  const time = clock();
  const abort = new AbortController();
  time.runtime.sleep = async (_ms, signal) => {
    entered.resolve();
    await new Promise<void>((_resolve, reject) =>
      signal!.addEventListener("abort", () => reject(signal!.reason), {
        once: true,
      }),
    );
  };
  const f = fixture(async () => empty, time);
  const pending = f.controller.waitForWidgetDescriptor(target, {
    timeoutMs: 1000,
    signal: abort.signal,
  });
  const rejected = assert.rejects(pending, code("CANCELLED"));
  await entered.promise;
  abort.abort();
  await rejected;
  assert.deepEqual(f.calls, ["catalog"]);
});
test("cancellation during a query drains it before rejecting and allowing a later operation", async () => {
  const entered = deferred();
  const gate = deferred();
  const abort = new AbortController();
  const f = fixture(async () => {
    entered.resolve();
    await gate.promise;
    return found();
  });
  let settled = false;
  const pending = f.controller
    .waitForWidgetDescriptor(target, { timeoutMs: 1000, signal: abort.signal })
    .finally(() => (settled = true));
  const rejected = assert.rejects(pending, code("CANCELLED"));
  await entered.promise;
  abort.abort();
  const inspect = f.controller.inspect();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(f.calls, ["catalog"]);
  gate.resolve();
  await rejected;
  await inspect;
  assert.deepEqual(f.calls, ["catalog", "inspect"]);
});
test("descriptor wait retains mutator reentrancy protection without calling the backend", async () => {
  const config: WidgetConfiguration = {
    schemaVersion: 1,
    ...target,
    intent: {
      intentClass: "INAppIntent",
      appBundleIdentifier: target.container,
      extensionBundleIdentifier: target.extension,
      appIntentIdentifier: "Choose",
      parameters: {},
    },
  };
  const calls: string[] = [];
  const controller = createController(
    { udid: "OWNED-DEVICE" },
    async ({ mode }) => {
      calls.push(mode);
      if (mode === "installedWidgets")
        return {
          status: "listed",
          widgets: [
            {
              target: { ...target, iconIdentifier: "ICON" },
              widgetIdentifier: "WIDGET",
            },
          ],
          timings: {},
        };
      if (mode === "exportConfiguration")
        return {
          status: "configuration_exported",
          configuration: config,
          timings: {},
        };
      throw Error(mode);
    },
  );
  const handle = await controller.getWidget("ICON");
  await assert.rejects(
    handle.updateConfiguration(async () => {
      await controller.waitForWidgetDescriptor(target, { timeoutMs: 1000 });
    }),
    code("INVALID_INPUT"),
  );
  assert.deepEqual(calls, ["installedWidgets", "exportConfiguration"]);
});

test("in-flight ownership failure remains authoritative after cancellation and budget expiry", async () => {
  const entered = deferred();
  const gate = deferred();
  const abort = new AbortController();
  const error = new WidgetctlError("Ownership fence failed", {
    code: "OWNERSHIP_LOST",
  });
  const f = fixture(async () => {
    entered.resolve();
    await gate.promise;
    throw error;
  });
  const waiting = f.controller.waitForWidgetDescriptor(target, {
    timeoutMs: 10,
    signal: abort.signal,
  });
  const rejected = assert.rejects(waiting, (received) => received === error);
  await entered.promise;
  f.time.advance(11);
  abort.abort();
  gate.resolve();
  await rejected;
  assert.deepEqual(f.calls, ["catalog"]);
});
