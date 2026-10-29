import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWidgetController,
  classifyError,
  type WidgetController,
} from "../src/index.js";

const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));
const boundedRun = async (file: string, args: string[]) =>
  (
    await exec(file, args, {
      timeout: 15000,
      killSignal: "SIGKILL",
      maxBuffer: 4 * 1024 * 1024,
      cwd: repository,
    })
  ).stdout;
export async function sourceFingerprint() {
  const files = [
    ...(await readdir(path.join(repository, "src")))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `src/${name}`),
    "native/worker.m",
    "package-lock.json",
    "scripts/benchmark.ts",
  ].sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = await readFile(path.join(repository, file));
    hash
      .update(file)
      .update("\0")
      .update(String(bytes.length))
      .update("\0")
      .update(bytes);
  }
  return hash.digest("hex");
}
interface Dependencies {
  run: typeof boundedRun;
  createController: typeof createWidgetController;
  fingerprint: typeof sourceFingerprint;
  onInterrupt: (callback: () => void) => () => void;
  progress: (resultPath: string) => void;
}
const defaults: Dependencies = {
  run: boundedRun,
  createController: createWidgetController,
  fingerprint: sourceFingerprint,
  onInterrupt: (callback) => {
    process.on("SIGINT", callback);
    return () => {
      process.off("SIGINT", callback);
    };
  },
  progress: (resultPath) => {
    console.error(`Benchmark progress: ${resultPath}`);
  },
};
class Interrupted extends Error {
  constructor() {
    super("Benchmark interrupted");
    this.name = "AbortError";
  }
}
class SourceChanged extends Error {
  constructor() {
    super("Benchmark source changed");
    this.name = "SourceChangedError";
  }
}
export function summarize(samples: number[]) {
  if (!samples.length || samples.some((n) => !Number.isFinite(n) || n < 0))
    throw Error("At least one finite nonnegative sample is required");
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    samplesMs: samples,
    count: samples.length,
    medianMs:
      sorted.length % 2
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2,
    maxMs: sorted.at(-1)!,
    ...(sorted.length >= 20
      ? { p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]! }
      : {}),
  };
}

export async function benchmark(
  env = process.env,
  overrides: Partial<Dependencies> = {},
) {
  const deps = { ...defaults, ...overrides };
  const udid = env.SIMULATOR_UDID?.toUpperCase();
  if (!udid || !/^[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(udid))
    throw Error(
      "SIMULATOR_UDID must name an explicitly owned, booted simulator",
    );
  const count = Number(env.BENCHMARK_SAMPLES ?? 5);
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw Error("BENCHMARK_SAMPLES must be 1–100");
  if (env.BENCHMARK_SAVE === "1" && !env.WIDGET_ICON_IDENTIFIER)
    throw Error("Save timing requires an exact WIDGET_ICON_IDENTIFIER");
  if (env.WIDGET_PARAMETER_KEY && !env.WIDGET_ICON_IDENTIFIER)
    throw Error("Entity query timing requires an exact WIDGET_ICON_IDENTIFIER");
  const runDirectory = path.join(
    path.resolve(env.BENCHMARK_OUTPUT ?? ".local/benchmark"),
    randomUUID(),
  );
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  const resultPath = path.join(runDirectory, "results.json");
  const state = path.join(runDirectory, "state");
  const rows: Record<string, number[]> = {};
  const nativeTimings: {
    sample: number;
    mode: string;
    timingsSeconds: Record<string, number>;
  }[] = [];
  const failures: {
    operation: string;
    elapsedMs: number;
    code: string;
    name: string;
  }[] = [];
  const environment: Record<string, unknown> = {
    platform: os.platform(),
    hostOS: os.release(),
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(),
    node: process.version,
  };
  let completed = false;
  let cancelled = false;
  let cleanupFailed = false;
  let current: WidgetController | undefined;
  let operation = "preflight";
  let sourceSHA256 = "";
  let failedElapsedMs = 0;
  const record = (name: string, error: unknown, elapsedMs = 0) => {
    failures.push({
      operation: name,
      elapsedMs,
      code: classifyError(error).code,
      name:
        error instanceof Interrupted
          ? "AbortError"
          : error instanceof SourceChanged
            ? "SourceChangedError"
            : error instanceof Error &&
                /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
              ? error.name
              : "Error",
    });
  };
  const snapshot = async (status: string) => {
    await writeFile(
      resultPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          capturedAt: new Date().toISOString(),
          status,
          completed,
          cancelled,
          cleanupFailed,
          requestedSamples: count,
          nativeTimings,
          failures,
          environment,
          sourceSHA256,
          stateDirectory: state,
          results: Object.fromEntries(
            Object.entries(rows).map(([name, samples]) => [
              name,
              summarize(samples),
            ]),
          ),
          definitions: {
            coldPrepare:
              "prepare with a new state directory per sample; compile and injection included; OS caches retained",
            readyPrepare: "prepare with an already ready worker",
            cachedPrepare:
              "release then prepare with the same compiled-worker cache",
            catalog: "public catalog call with a ready worker",
            describe:
              "canonical export plus metadata discovery and field description",
            entityQuery:
              "public configurationChoices with canonical draft and expected guard",
            unchangedGuardedSave:
              "explicitly opted-in unchanged canonical apply with expected guard; no retries",
          },
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  };
  await snapshot("preflight");
  deps.progress(resultPath);
  const unsubscribe = deps.onInterrupt(() => {
    cancelled = true;
  });
  const checkpoint = () => {
    if (cancelled) throw new Interrupted();
  };
  const stable = async () => {
    if ((await deps.fingerprint()) !== sourceSHA256) throw new SourceChanged();
  };
  const measure = async <T>(
    name: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    operation = name;
    checkpoint();
    await stable();
    checkpoint();
    const start = performance.now();
    let value: T;
    let elapsed: number;
    try {
      value = await action();
      elapsed = performance.now() - start;
    } catch (error) {
      failedElapsedMs = performance.now() - start;
      throw error;
    }
    await stable();
    (rows[name] ??= []).push(elapsed);
    await snapshot("running");
    checkpoint();
    return value;
  };
  try {
    sourceSHA256 = await deps.fingerprint();
    environment.xcode = (await deps.run("xcodebuild", ["-version"])).trim();
    checkpoint();
    const listing = JSON.parse(
      await deps.run("xcrun", ["simctl", "list", "devices", "--json"]),
    );
    const entries = Object.entries(
      listing.devices as Record<
        string,
        { udid: string; state: string; name: string; isAvailable?: boolean }[]
      >,
    ).flatMap(([runtime, devices]) =>
      devices.map((device) => ({ runtime, ...device })),
    );
    const matches = entries.filter(
      (device) => device.udid.toUpperCase() === udid,
    );
    const entry = matches.length === 1 ? matches[0] : undefined;
    if (
      !entry ||
      entry.state !== "Booted" ||
      entry.isAvailable === false ||
      !entry.runtime.startsWith("com.apple.CoreSimulator.SimRuntime.iOS-")
    )
      throw Error("Explicit iOS simulator is not available and booted");
    checkpoint();
    const runtimes = JSON.parse(
      await deps.run("xcrun", ["simctl", "list", "runtimes", "--json"]),
    );
    const runtime = runtimes.runtimes.find(
      (item: { identifier: string; isAvailable: boolean }) =>
        item.identifier === entry.runtime && item.isAvailable === true,
    );
    if (!runtime) throw Error("Requested simulator runtime is unavailable");
    environment.simulator = entry;
    environment.runtime = {
      identifier: runtime.identifier,
      version: runtime.version,
      build: runtime.buildversion,
    };
    try {
      environment.git = {
        head: (await deps.run("git", ["rev-parse", "HEAD"])).trim(),
        dirty: Boolean(
          (
            await deps.run("git", [
              "status",
              "--porcelain",
              "--untracked-files=normal",
            ])
          ).trim(),
        ),
      };
    } catch {
      environment.git = { available: false };
    }
    await stable();
    checkpoint();
    await mkdir(state, { mode: 0o700 });
    await snapshot("running");
    for (let index = 0; index < count; index++) {
      checkpoint();
      operation = "controller-setup";
      current = deps.createController({
        udid,
        stateDirectory: path.join(state, `cold-${index}`),
        onResult: (result) => {
          nativeTimings.push({
            sample: index,
            mode:
              typeof result.mode === "string" && /^[A-Za-z]+$/.test(result.mode)
                ? result.mode
                : "unknown",
            timingsSeconds: Object.fromEntries(
              Object.entries(result.timings ?? {}).filter(
                ([key, value]) =>
                  /^[a-z_]+_seconds$/.test(key) &&
                  typeof value === "number" &&
                  Number.isFinite(value) &&
                  value >= 0,
              ),
            ),
          });
        },
      });
      await measure("coldPrepare", () => current!.prepare());
      await measure("readyPrepare", () => current!.prepare());
      operation = "release-for-cache";
      await current.release();
      checkpoint();
      await measure("cachedPrepare", () => current!.prepare());
      await measure("catalog", () => current!.catalog());
      if (env.WIDGET_ICON_IDENTIFIER) {
        checkpoint();
        operation = "widget-lookup";
        const widget = await current.getWidget(env.WIDGET_ICON_IDENTIFIER);
        checkpoint();
        operation = "configuration-export";
        const original = await widget.exportConfiguration();
        await measure("describe", () => widget.describeConfiguration());
        if (env.WIDGET_PARAMETER_KEY)
          await measure("entityQuery", () =>
            widget.configurationChoices(
              env.WIDGET_PARAMETER_KEY!,
              env.WIDGET_SEARCH ?? "",
              { configuration: original, expected: original },
            ),
          );
        if (env.BENCHMARK_SAVE === "1")
          await measure("unchangedGuardedSave", () =>
            widget.applyConfiguration(original, { expected: original }),
          );
      }
      operation = "release";
      await current.release();
      current = undefined;
      checkpoint();
    }
    await stable();
    checkpoint();
    completed = true;
  } catch (error) {
    record(operation, error, failedElapsedMs);
  } finally {
    try {
      if (current) await current.release();
    } catch (error) {
      cleanupFailed = true;
      record("cleanup-release", error);
    }
    completed = completed && !cleanupFailed && !cancelled;
    try {
      await snapshot(
        completed
          ? "completed"
          : cleanupFailed
            ? "cleanup-failed"
            : cancelled
              ? "cancelled"
              : "failed",
      );
    } finally {
      unsubscribe();
    }
  }
  return {
    resultPath,
    completed,
    cancelled,
    cleanupFailed,
    exitCode: completed ? 0 : cancelled && !cleanupFailed ? 130 : 1,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await benchmark();
    console.error(
      `Benchmark ${result.completed ? "completed" : result.cleanupFailed ? "cleanup failed" : result.cancelled ? "cancelled" : "failed"}: ${result.resultPath}`,
    );
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(
      `Benchmark failed (${classifyError(error).code}); inspect the reported progress path if one was created.`,
    );
    process.exitCode = 1;
  }
}
