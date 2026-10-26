import { test } from "node:test";
import assert from "node:assert/strict";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  withLock,
  command,
  atomicJson,
  requestWorker,
  compileWorker,
} from "../src/backend-runtime.js";

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-runtime-"));
  return { dir, dispose: () => fs.rm(dir, { recursive: true, force: true }) };
}

test("command timeout kills an owned child that ignores SIGTERM", async () => {
  const f = await fixture();
  let childPid: number | undefined;
  try {
    const pidFile = path.join(f.dir, "pid");
    const result = command(
      [
        process.execPath,
        "-e",
        "require('node:fs').writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
        pidFile,
      ],
      500,
    );
    let watchdogForced = false;
    const watchdog = setTimeout(async () => {
      watchdogForced = true;
      try {
        childPid = Number(await fs.readFile(pidFile, "utf8"));
        process.kill(childPid, "SIGKILL");
      } catch {}
    }, 3000);
    try {
      await assert.rejects(result, (error: any) => {
        assert.equal(error.killed, true);
        assert.equal(error.signal, "SIGKILL");
        return true;
      });
      assert.equal(
        watchdogForced,
        false,
        "command required watchdog termination",
      );
    } finally {
      clearTimeout(watchdog);
    }
  } finally {
    if (childPid)
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    await f.dispose();
  }
});

test("lost lock rejects success and fences later writes and commands", async () => {
  const f = await fixture();
  const original = cp.spawn;
  let holder: cp.ChildProcess | undefined;
  cp.spawn = function (...args: Parameters<typeof cp.spawn>) {
    const child = original(...args);
    if (
      !holder &&
      args[0].endsWith(process.platform === "darwin" ? "lockf" : "flock")
    )
      holder = child;
    return child;
  } as typeof cp.spawn;
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      withLock(path.join(f.dir, "lock"), async () => {
        assert.ok(holder);
        const exited = once(holder, "exit");
        holder.kill("SIGKILL");
        await exited;
        await assert.rejects(
          atomicJson(path.join(f.dir, "forbidden"), {}),
          /Lock ownership lost/,
        );
        await assert.rejects(
          command([process.execPath, "-e", "process.exit(0)"]),
          /Lock ownership lost/,
        );
        await assert.rejects(
          requestWorker(f.dir, {}, {}),
          /Lock ownership lost/,
        );
        return "must not succeed";
      }),
      /Lock ownership lost/,
    );
    await assert.rejects(fs.access(path.join(f.dir, "forbidden")));
    assert.equal(await withLock(path.join(f.dir, "lock"), async () => 42), 42);
  } finally {
    cp.spawn = original;
    syncBuiltinESMExports();
    await f.dispose();
  }
});

test("compiler discovery overlaps independent commands and drains failures", async () => {
  const f = await fixture();
  let active = 0,
    peak = 0,
    finished = 0;
  const run = async (args: string[]) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    finished++;
    if (args.includes("runtimes")) throw Error("runtime discovery failed");
    if (args.includes("--find")) return "/clang";
    return "sdk metadata";
  };
  try {
    await assert.rejects(
      compileWorker(
        f.dir,
        "11111111-1111-1111-1111-111111111111",
        {},
        "arm64",
        run,
      ),
      /runtime discovery failed/,
    );
    assert.equal(peak, 4);
    assert.equal(active, 0);
    assert.equal(finished, 5);
  } finally {
    await f.dispose();
  }
});

test("lost request ownership preserves a successor command during cleanup", async () => {
  const f = await fixture();
  const udid = "11111111-1111-1111-1111-111111111111";
  const session = path.join(f.dir, udid);
  await fs.mkdir(session);
  const live = {
    udid,
    pid: process.pid,
    identity: "identity",
    timestamp: Date.now() / 1000,
  };
  await atomicJson(path.join(session, "heartbeat.json"), live);
  const original = cp.spawn;
  let holder: cp.ChildProcess | undefined;
  cp.spawn = function (...args: Parameters<typeof cp.spawn>) {
    const child = original(...args);
    if (!holder) holder = child;
    return child;
  } as typeof cp.spawn;
  syncBuiltinESMExports();
  const successor = { nonce: "successor", mode: "inspect" };
  let stop = false;
  const replace = (async () => {
    while (!stop) {
      try {
        const pending = JSON.parse(
          await fs.readFile(path.join(session, "command.json"), "utf8"),
        );
        assert.deepEqual(pending.worker, {
          pid: live.pid,
          identity: live.identity,
          udid,
        });
        assert.ok(holder);
        const exited = once(holder, "exit");
        holder.kill("SIGKILL");
        await exited;
        await fs.writeFile(
          path.join(session, "command.json"),
          JSON.stringify(successor),
        );
        return;
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  })();
  try {
    await assert.rejects(
      withLock(path.join(f.dir, "lock"), () =>
        requestWorker(session, live, {
          mode: "inspect",
          worker: { pid: 0, identity: "spoofed", udid: "other" },
        }),
      ),
      /Lock ownership lost/,
    );
    await replace;
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(session, "command.json"), "utf8")),
      successor,
    );
  } finally {
    stop = true;
    await replace;
    cp.spawn = original;
    syncBuiltinESMExports();
    await f.dispose();
  }
});
