import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { summarize, benchmark } from "../scripts/benchmark.js";

test("small benchmark samples report median and observed maximum without implying p95", () => {
  assert.deepEqual(summarize([9, 1, 3, 7]), {
    samplesMs: [9, 1, 3, 7],
    count: 4,
    medianMs: 5,
    maxMs: 9,
  });
  assert.equal(
    summarize(Array.from({ length: 20 }, (_, i) => i + 1)).p95Ms,
    19,
  );
  assert.throws(() => summarize([]));
  assert.throws(() => summarize([Infinity]));
});
test("benchmark requires an explicit simulator before touching state", async () => {
  await assert.rejects(benchmark({}), /SIMULATOR_UDID/);
  await assert.rejects(
    benchmark({
      SIMULATOR_UDID: "7340CED0-DD75-40BC-B2B8-62A1F8B25422",
      BENCHMARK_SAVE: "1",
    }),
    /exact WIDGET_ICON_IDENTIFIER/,
  );
});

import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WidgetctlError, type WidgetController } from "../src/index.js";
const udid = "7340CED0-DD75-40BC-B2B8-62A1F8B25422";
const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-27-0";
async function fixture(t: TestContext) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "widgetctl-benchmark-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  let interrupt: () => void = () => {};
  let unsubscribed = false;
  const calls: string[] = [];
  const deps = {
    run: async (file: string, args: string[]) => {
      calls.push(file);
      if (file === "git")
        return args.includes("HEAD") ? "abc123" : " M scripts/benchmark.ts";
      if (file === "xcodebuild") return "Xcode 27";
      if (args.includes("devices"))
        return JSON.stringify({
          devices: {
            [runtime]: [
              { udid, state: "Booted", name: "Test", isAvailable: true },
            ],
          },
        });
      return JSON.stringify({
        runtimes: [
          {
            identifier: runtime,
            version: "27",
            buildversion: "build",
            isAvailable: true,
          },
        ],
      });
    },
    fingerprint: async () => "stable",
    onInterrupt: (callback: () => void) => {
      interrupt = callback;
      return () => {
        unsubscribed = true;
      };
    },
    progress: () => {},
  };
  return {
    directory,
    deps,
    calls,
    interrupt: () => interrupt(),
    unsubscribed: () => unsubscribed,
    env: {
      SIMULATOR_UDID: udid,
      BENCHMARK_OUTPUT: directory,
      BENCHMARK_SAMPLES: "1",
    },
  };
}
test("benchmark creates fresh progress reports and records successful summaries and git identity", async (t) => {
  const f = await fixture(t);
  let releases = 0;
  const createController = () =>
    ({
      prepare: async () => {},
      release: async () => {
        releases++;
      },
      catalog: async () => ({}),
    }) as unknown as WidgetController;
  const first = await benchmark(f.env, { ...f.deps, createController });
  const second = await benchmark(f.env, { ...f.deps, createController });
  assert.equal(first.completed, true);
  assert.notEqual(first.resultPath, second.resultPath);
  assert.equal(releases, 4);
  const report = JSON.parse(await readFile(second.resultPath, "utf8"));
  assert.equal(report.results.catalog.count, 1);
  assert.equal(report.sourceSHA256, "stable");
  assert.deepEqual(report.environment.git, { head: "abc123", dirty: true });
  assert.equal(f.unsubscribed(), true);
});
test("SIGINT waits for the active prepare and releases before reporting cancellation", async (t) => {
  const f = await fixture(t);
  const events: string[] = [];
  const result = await benchmark(f.env, {
    ...f.deps,
    createController: () =>
      ({
        prepare: async () => {
          events.push("start");
          f.interrupt();
          await Promise.resolve();
          events.push("finished");
        },
        release: async () => {
          events.push("release");
        },
      }) as unknown as WidgetController,
  });
  assert.deepEqual(events, ["start", "finished", "release"]);
  assert.equal(result.exitCode, 130);
  const report = JSON.parse(await readFile(result.resultPath, "utf8"));
  assert.equal(report.status, "cancelled");
  assert.equal(report.completed, false);
  assert.equal(f.unsubscribed(), true);
});
test("failed prepare and failed cleanup retain both safe failures and never return cancellation success", async (t) => {
  const f = await fixture(t);
  const result = await benchmark(f.env, {
    ...f.deps,
    createController: () =>
      ({
        prepare: async () => {
          f.interrupt();
          throw new WidgetctlError("PRIVATE configuration value", {
            code: "QUERY_FAILED",
          });
        },
        release: async () => {
          throw Error("PRIVATE cleanup payload");
        },
      }) as unknown as WidgetController,
  });
  const text = await readFile(result.resultPath, "utf8");
  const report = JSON.parse(text);
  assert.equal(result.exitCode, 1);
  assert.equal(report.status, "cleanup-failed");
  assert.deepEqual(
    report.failures.map((failure: { operation: string }) => failure.operation),
    ["coldPrepare", "cleanup-release"],
  );
  assert.equal(report.failures[0].code, "QUERY_FAILED");
  assert.doesNotMatch(text, /PRIVATE|secret/);
});
test("metadata failure leaves a fresh failed report before creating a controller or state directory", async (t) => {
  const f = await fixture(t);
  let controllers = 0;
  const result = await benchmark(f.env, {
    ...f.deps,
    run: async () => {
      throw Error("private metadata failure");
    },
    createController: () => {
      controllers++;
      throw Error("must not construct");
    },
  });
  assert.equal(controllers, 0);
  assert.equal(result.completed, false);
  const runFiles = await readdir(path.dirname(result.resultPath));
  assert.deepEqual(runFiles, ["results.json"]);
  assert.equal(
    JSON.parse(await readFile(result.resultPath, "utf8")).failures[0].operation,
    "preflight",
  );
});
test("changed integrated source rejects samples and still releases setup", async (t) => {
  const f = await fixture(t);
  let hashes = 0;
  let releases = 0;
  const result = await benchmark(f.env, {
    ...f.deps,
    fingerprint: async () => (++hashes < 4 ? "stable" : "changed"),
    createController: () =>
      ({
        prepare: async () => {},
        release: async () => {
          releases++;
        },
      }) as unknown as WidgetController,
  });
  const report = JSON.parse(await readFile(result.resultPath, "utf8"));
  assert.equal(result.completed, false);
  assert.equal(releases, 1);
  assert.deepEqual(report.results, {});
  assert.equal(report.failures[0].name, "SourceChangedError");
});

test("preflight cancellation avoids controller setup and still finalizes its report", async (t) => {
  const f = await fixture(t);
  let controllers = 0;
  const result = await benchmark(f.env, {
    ...f.deps,
    run: async (file, args) => {
      const text = await f.deps.run(file, args);
      f.interrupt();
      return text;
    },
    createController: () => {
      controllers++;
      throw Error("must not construct");
    },
  });
  assert.equal(controllers, 0);
  assert.equal(result.exitCode, 130);
  const report = JSON.parse(await readFile(result.resultPath, "utf8"));
  assert.equal(report.failures[0].code, "CANCELLED");
  assert.equal(report.status, "cancelled");
});
