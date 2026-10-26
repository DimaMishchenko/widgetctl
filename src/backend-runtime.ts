import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import plist from "plist";
import bplist from "bplist-parser";
import {
  type Dict,
  object,
  targetIdentity,
  validateResponse,
} from "./backend-model.js";
const execute = promisify(execFile);
type LockContext = { lost: Error | null };
const lockContexts = new AsyncLocalStorage<LockContext[]>();
export function assertLockOwnership(): void {
  for (const context of lockContexts.getStore() ?? [])
    if (context.lost) throw context.lost;
}
export async function command(
  args: string[],
  timeout = 15000,
): Promise<string> {
  assertLockOwnership();
  const { stdout } = await execute(args[0]!, args.slice(1), {
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 16 * 1024 * 1024,
    encoding: "utf8",
  });
  assertLockOwnership();
  return stdout;
}
export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));
export async function readJson(p: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}
export async function atomicJson(p: string, v: unknown): Promise<void> {
  assertLockOwnership();
  const temp = `${p}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(v) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    assertLockOwnership();
    await fs.rename(temp, p);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export async function prepareDirectory(p: string): Promise<string> {
  p = path.resolve(
    p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p,
  );
  try {
    if ((await fs.lstat(p)).isSymbolicLink())
      throw Error(`State directory must not be a symlink: ${p}`);
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  await fs.mkdir(p, { recursive: true, mode: 0o700 });
  const info = await fs.stat(p);
  if (info.uid !== process.getuid?.() || info.mode & 0o022)
    throw Error(
      `State directory must be owned by this user and not writable by others: ${p}`,
    );
  return fs.realpath(p);
}
export function processAlive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || (pid as number) < 1) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (e: any) {
    return e.code === "EPERM";
  }
}
export async function heartbeat(session: string): Promise<Dict | null> {
  const v = await readJson(path.join(session, "heartbeat.json"));
  if (
    !object(v) ||
    v.udid !== path.basename(session) ||
    typeof v.timestamp !== "number" ||
    !Number.isFinite(v.timestamp) ||
    Math.abs(Date.now() / 1000 - v.timestamp) > 3 ||
    !processAlive(v.pid)
  )
    return null;
  return v;
}
export async function withLock<T>(
  p: string,
  action: () => Promise<T>,
): Promise<T> {
  assertLockOwnership();
  try {
    const file = await fs.open(p, "ax", 0o600);
    await file.close();
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
  }
  const info = await fs.lstat(p);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    info.mode & 0o022
  )
    throw Error("Unsafe lock ownership");
  const utility =
    process.platform === "darwin" ? "/usr/bin/lockf" : "/usr/bin/flock";
  const args =
    process.platform === "darwin" ? ["-k", "-t", "120", p] : ["-w", "120", p];
  const holder = spawn(
    utility,
    [
      ...args,
      process.execPath,
      "--input-type=module",
      "-e",
      "process.stdout.write('LOCKED\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const context: LockContext = { lost: null };
  let releasing = false;
  let stderr = "";
  holder.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    holder.once("error", (error) => {
      context.lost = Error(`Lock holder failed: ${error.message}`);
      reject(error);
    });
    holder.once("exit", (code, signal) => {
      if (!releasing)
        context.lost = Error(
          `Lock ownership lost (${signal ?? code}); an in-flight operation may have completed`,
        );
      resolve(code);
    });
  });
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      let output = "";
      holder.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("LOCKED\n")) resolve();
      });
      holder.once("error", reject);
    }),
    exited.then((code) => {
      throw Error(`Cannot acquire lock (${code}): ${stderr.trim()}`);
    }),
  ]);
  try {
    return await lockContexts.run(
      [...(lockContexts.getStore() ?? []), context],
      async () => {
        assertLockOwnership();
        const result = await action();
        assertLockOwnership();
        return result;
      },
    );
  } finally {
    releasing = true;
    holder.stdin.end();
    await exited;
  }
}

export interface Runtime {
  command: typeof command;
  heartbeat: typeof heartbeat;
  loadIconstate: typeof loadIconstate;
  compileWorker: typeof compileWorker;
  requestWorker: typeof requestWorker;
  sleep: typeof sleep;
  now: () => number;
}
export async function loadIconstate(paths: string[]): Promise<[Dict, string]> {
  const errors: string[] = [];
  for (const p of paths)
    try {
      const bytes = await fs.readFile(p);
      const value =
        bytes.subarray(0, 8).toString() === "bplist00"
          ? bplist.parseBuffer(bytes)[0]
          : plist.parse(bytes.toString());
      if (!object(value) || !Array.isArray(value.iconLists))
        throw Error("IconState must contain Home iconLists");
      return [value, p];
    } catch (e) {
      errors.push(String(e));
    }
  throw Error(
    "Cannot read persisted Home IconState for duplicate preflight: " +
      errors.join("; "),
  );
}
export async function compileWorker(
  state: string,
  udid: string,
  listing: Dict,
  architecture?: string,
  run = command,
): Promise<[string, string]> {
  assertLockOwnership();
  const discoveries = await Promise.allSettled([
    run(["xcrun", "simctl", "list", "runtimes", "--json"]),
    run(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"]),
    (async () => {
      const compiler = (
        await run(["xcrun", "--sdk", "iphonesimulator", "--find", "clang"])
      ).trim();
      return { compiler, version: await run([compiler, "--version"]) };
    })(),
    run(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"]),
  ]);
  assertLockOwnership();
  for (const result of discoveries)
    if (result.status === "rejected") throw result.reason;
  const [runtimeResult, sdkResult, compilerResult, sdkVersionResult] =
    discoveries as [
      PromiseFulfilledResult<string>,
      PromiseFulfilledResult<string>,
      PromiseFulfilledResult<{ compiler: string; version: string }>,
      PromiseFulfilledResult<string>,
    ];
  const [target, runtime] = targetIdentity(
    listing,
    JSON.parse(runtimeResult.value),
    udid,
    architecture ?? (os.arch() === "x64" ? "x86_64" : os.arch()),
  );
  const sdk = sdkResult.value.trim();
  const { compiler, version } = compilerResult.value;
  const sdkVersion = sdkVersionResult.value.trim();
  const source = fileURLToPath(new URL("../native/worker.m", import.meta.url));
  const identity = createHash("sha256")
    .update(await fs.readFile(source))
    .update(
      JSON.stringify({
        protocol: 1,
        target,
        runtime: {
          identifier: runtime.identifier,
          version: runtime.version,
          buildversion: runtime.buildversion,
        },
        sdk,
        sdkVersion,
        compiler,
        version,
      }),
    )
    .digest("hex");
  const workers = await prepareDirectory(path.join(state, "workers"));
  const cache = await prepareDirectory(path.join(workers, identity));
  const worker = path.join(cache, "worker.dylib");
  await withLock(path.join(cache, "compile.lock"), async () => {
    try {
      const info = await fs.lstat(worker);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid?.()
      )
        throw Error("Unsafe compiled worker ownership");
      return;
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    const temp = path.join(cache, `worker-${randomUUID()}.dylib`);
    try {
      await run(
        [
          compiler,
          "-target",
          target,
          "-isysroot",
          sdk,
          "-dynamiclib",
          "-framework",
          "Foundation",
          "-fobjc-arc",
          "-Wall",
          "-Wextra",
          "-Werror",
          source,
          "-o",
          temp,
        ],
        60000,
      );
      assertLockOwnership();
      await fs.rename(temp, worker);
    } finally {
      await fs.rm(temp, { force: true });
    }
  });
  return [worker, identity];
}
export async function requestWorker(
  session: string,
  live: Dict,
  payload: Dict,
  expected?: any,
): Promise<[Dict, number]> {
  assertLockOwnership();
  const nonce = randomUUID();
  const started = performance.now();
  await fs.rm(path.join(session, "command.json"), { force: true });
  assertLockOwnership();
  await fs.rm(path.join(session, "response.json"), { force: true });
  await atomicJson(path.join(session, "command.json"), {
    ...payload,
    nonce,
    worker: {
      pid: live.pid,
      identity: live.identity,
      udid: path.basename(session),
    },
  });
  try {
    while (performance.now() - started < 30000) {
      assertLockOwnership();
      const v = await readJson(path.join(session, "response.json"));
      assertLockOwnership();
      if (object(v) && v.nonce === nonce)
        return [
          validateResponse(v, nonce, live.pid, expected),
          (performance.now() - started) / 1000,
        ];
      const current = await heartbeat(session);
      if (
        !current ||
        current.pid !== live.pid ||
        current.identity !== live.identity
      )
        throw Error(
          "Worker heartbeat changed or stopped while waiting for command response",
        );
      await sleep(50);
    }
    throw Error("No response matching the command nonce within 30 seconds");
  } finally {
    const pending = await readJson(path.join(session, "command.json"));
    if (pending?.nonce === nonce) {
      assertLockOwnership();
      await fs.rm(path.join(session, "command.json"), { force: true });
    }
  }
}
export const runtime: Runtime = {
  command,
  heartbeat,
  loadIconstate,
  compileWorker,
  requestWorker,
  sleep,
  now: () => performance.now(),
};
