import test from "node:test";
import assert from "node:assert/strict";
import { createDiscovery } from "../src/discovery.js";
const udid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ios = "com.apple.CoreSimulator.SimRuntime.iOS-26-0";
const tv = "com.apple.CoreSimulator.SimRuntime.tvOS-26-0";
function fixture(extra: Record<string, unknown> = {}) {
  const calls: string[][] = [];
  const devices = {
    devices: {
      [ios]: [
        {
          udid,
          name: "My iPhone",
          state: "Booted",
          isAvailable: true,
          ...extra,
        },
      ],
      [tv]: [
        {
          udid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          name: "TV",
          state: "Booted",
          isAvailable: true,
        },
      ],
    },
  };
  const run = async (args: string[]) => {
    calls.push(args);
    if (args.includes("runtimes"))
      return JSON.stringify({
        runtimes: [
          { identifier: ios, version: "26.0", isAvailable: true },
          { identifier: tv, version: "26.0", isAvailable: true },
        ],
      });
    if (args.includes("devices")) return JSON.stringify(devices);
    if (args.includes("listapps"))
      return JSON.stringify({
        "org.example": {
          CFBundleIdentifier: "org.example",
          CFBundleDisplayName: "Real App Name",
          Bundle: "/Apps/Example.app",
        },
      });
    throw Error("Unexpected command");
  };
  return { ...createDiscovery(run), calls };
}
test("discovery uses available iOS metadata and real names without selecting a device", async () => {
  const f = fixture();
  assert.deepEqual(await f.listSimulators(), [
    {
      udid: udid.toUpperCase(),
      name: "My iPhone",
      state: "booted",
      runtime: "26.0",
    },
  ]);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(await f.listApplications(udid), [
    {
      bundleIdentifier: "org.example",
      name: "Real App Name",
      path: "/Apps/Example.app",
    },
  ]);
  assert.deepEqual(f.calls.at(-1), [
    "xcrun",
    "simctl",
    "listapps",
    udid.toUpperCase(),
  ]);
});
test("shutdown devices are listed but app discovery does not target them", async () => {
  const f = fixture({ state: "Shutdown" });
  assert.equal((await f.listSimulators())[0]!.state, "shutdown");
  await assert.rejects(f.listApplications(udid), /explicitly requested/);
  assert.ok(f.calls.every((args) => !args.includes("listapps")));
});
test("unavailable devices are excluded and malformed names are rejected", async () => {
  assert.deepEqual(await fixture({ isAvailable: false }).listSimulators(), []);
  await assert.rejects(
    fixture({ name: undefined }).listSimulators(),
    /identity or name/,
  );
  await assert.rejects(fixture().listApplications("booted"), /explicit UUID/);
});

test("OpenStep listapps metadata converts through plutil and removes its temporary file", async () => {
  const fs = await import("node:fs/promises");
  let temporary = "";
  const run = async (args: string[]) => {
    if (args.includes("runtimes"))
      return JSON.stringify({
        runtimes: [{ identifier: ios, version: "26.0", isAvailable: true }],
      });
    if (args.includes("devices"))
      return JSON.stringify({
        devices: {
          [ios]: [{ udid, name: "Phone", state: "Booted", isAvailable: true }],
        },
      });
    if (args.includes("listapps"))
      return '{ "org.example" = { CFBundleName = Example; }; }';
    assert.equal(args[0], "/usr/bin/plutil");
    temporary = args.at(-1)!;
    assert.match(
      await fs.readFile(temporary, "utf8"),
      /CFBundleName = Example/,
    );
    return JSON.stringify({ "org.example": { CFBundleName: "Example" } });
  };
  assert.deepEqual(await createDiscovery(run).listApplications(udid), [
    { bundleIdentifier: "org.example", name: "Example" },
  ]);
  await assert.rejects(fs.access(temporary));
});
