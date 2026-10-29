import test from "node:test";
import assert from "node:assert/strict";
import { createDoctor } from "../src/doctor.js";
const udid = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-0";
function fixture(
  options: {
    state?: string;
    heartbeat?: unknown;
    unsafe?: boolean;
    runtimeAvailable?: boolean;
  } = {},
) {
  const calls: string[][] = [];
  const reads: string[] = [];
  const stats: string[] = [];
  const doctor = createDoctor({
    platform: "darwin",
    home: "/fake",
    uid: 501,
    now: () => 100000,
    alive: (pid) => pid === 42,
    stat: async (file) => {
      stats.push(file);
      return {
        isDirectory: () => !file.endsWith("runner.lock"),
        isFile: () => file.endsWith("runner.lock"),
        isSymbolicLink: () => options.unsafe === true,
        uid: 501,
        mode: 0o700,
      };
    },
    read: async (file) => {
      reads.push(file);
      return JSON.stringify(
        options.heartbeat ?? { udid, timestamp: 100, pid: 42 },
      );
    },
    run: async (args) => {
      calls.push(args);
      if (args.includes("runtimes"))
        return JSON.stringify({
          runtimes: [
            {
              identifier: runtime,
              isAvailable: options.runtimeAvailable ?? true,
            },
          ],
        });
      if (args.includes("devices"))
        return JSON.stringify({
          devices: {
            [runtime]: [
              {
                udid,
                name: "Phone",
                isAvailable: true,
                state: options.state ?? "Booted",
              },
            ],
          },
        });
      if (args.includes("listapps")) return "{}";
      if (args.includes("--find")) return "/fake/clang";
      return "Xcode 26.0";
    },
  });
  return { doctor, calls, reads, stats };
}
test("doctor fails clearly on unsupported hosts without commands or reads", async () => {
  const f = fixture();
  const doctor = createDoctor({
    platform: "linux",
    run: async () => {
      throw Error("must not run");
    },
    stat: async () => {
      throw Error("must not read");
    },
  });
  const report = await doctor();
  assert.equal(report.healthy, false);
  assert.match(report.checks[0]!.message, /Unsupported host linux/);
  assert.equal(f.calls.length, 0);
});
test("doctor without a device inspects host metadata without selecting or reading sessions", async () => {
  const f = fixture();
  const report = await f.doctor();
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.healthy, true);
  assert.equal(
    report.checks.find((check) => check.id === "device")?.status,
    "warn",
  );
  assert.equal(f.reads.length, 0);
  assert.equal(f.stats.length, 0);
  assert.ok(f.calls.every((args) => !args.includes("listapps")));
});
test("doctor inspects only explicit UDID and reports fresh session snapshot without acquiring a lock", async () => {
  const f = fixture();
  const report = await f.doctor({
    udid: udid.toLowerCase(),
    stateDirectory: "/custom-cache",
  });
  assert.equal(report.healthy, true);
  assert.equal(
    report.checks.find((check) => check.id === "helper-heartbeat")?.status,
    "pass",
  );
  assert.equal(
    report.checks.find((check) => check.id === "helper-lock")?.status,
    "warn",
  );
  assert.deepEqual(f.reads, [
    `/fake/Library/Caches/widgetctl/sessions/${udid}/heartbeat.json`,
  ]);
  assert.deepEqual(
    f.calls.find((args) => args.includes("listapps")),
    ["xcrun", "simctl", "listapps", udid],
  );
  assert.ok(
    f.calls.every(
      (args) =>
        !args.some((arg) =>
          ["boot", "spawn", "shutdown", "delete", "kill", "launch"].includes(
            arg,
          ),
        ),
    ),
  );
  assert.match(
    report.checks.find((check) => check.id === "widget-registration")!.message,
    /cannot establish.*private API compatibility/,
  );
});
test("shutdown target gets exact recovery and no application registry access", async () => {
  const f = fixture({ state: "Shutdown" });
  const report = await f.doctor({ udid });
  assert.equal(report.healthy, false);
  assert.ok(
    report.checks
      .find((check) => check.id === "device")
      ?.recovery?.includes(`xcrun simctl boot ${udid}`),
  );
  assert.ok(f.calls.every((args) => !args.includes("listapps")));
});
test("unavailable iOS runtime fails even if its device appears booted", async () => {
  const f = fixture({ runtimeAvailable: false });
  const report = await f.doctor({ udid });
  assert.equal(
    report.checks.find((check) => check.id === "ios-runtimes")?.status,
    "fail",
  );
  assert.equal(
    report.checks.find((check) => check.id === "device")?.status,
    "fail",
  );
  assert.ok(f.calls.every((args) => !args.includes("listapps")));
});
test("stale and mismatched heartbeats are warnings; symlink sessions are never read", async () => {
  for (const heartbeat of [
    { udid, timestamp: 10, pid: 42 },
    { udid: "other", timestamp: 100, pid: 42 },
    { udid, timestamp: 100, pid: 99 },
  ]) {
    const report = await fixture({ heartbeat }).doctor({ udid });
    assert.equal(
      report.checks.find((check) => check.id === "helper-heartbeat")?.status,
      "warn",
    );
  }
  const f = fixture({ unsafe: true });
  const report = await f.doctor({ udid });
  assert.equal(
    report.checks.find((check) => check.id === "helper-session")?.status,
    "fail",
  );
  assert.deepEqual(f.reads, []);
});
test("invalid device input never reaches host commands or filesystem", async () => {
  const f = fixture();
  const report = await f.doctor({ udid: "../../other" });
  assert.equal(report.healthy, false);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.stats, []);
});
test("individual failed probes preserve subsequent diagnostics", async () => {
  const f = fixture();
  const doctor = createDoctor({
    platform: "darwin",
    run: async () => {
      throw Error("CoreSimulator unavailable");
    },
  });
  const report = await doctor();
  assert.equal(report.healthy, false);
  assert.ok(
    report.checks.some(
      (check) => check.id === "xcode" && check.status === "fail",
    ),
  );
  assert.ok(
    report.checks.some(
      (check) => check.id === "ios-devices" && check.status === "fail",
    ),
  );
  assert.deepEqual(f.calls, []);
});

test("missing sessions are normal and do not trigger state creation", async () => {
  let read = false;
  const doctor = createDoctor({
    platform: "darwin",
    run: async () => {
      throw Error("metadata unavailable");
    },
    stat: async () => {
      throw Object.assign(Error("missing"), { code: "ENOENT" });
    },
    read: async () => {
      read = true;
      throw Error("must not read");
    },
  });
  const report = await doctor({ udid });
  assert.equal(
    report.checks.find((check) => check.id === "helper-session")?.status,
    "pass",
  );
  assert.equal(read, false);
});
