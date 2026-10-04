import { test } from "node:test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import plist from "plist";
import { createBackend } from "../src/backend.js";
import {
  type Runtime,
  atomicJson,
  readJson,
  prepareDirectory,
  heartbeat,
  withLock,
  loadIconstate,
  compileWorker,
  requestWorker,
  command,
} from "../src/backend-runtime.js";
import { persistedTarget, type Dict } from "../src/backend-model.js";
const UDID = "11111111-1111-1111-1111-111111111111";
const w = {
  widgetIdentifier: "Kind",
  bundleIdentifier: "org.widgets",
  containerBundleIdentifier: "org.app",
  gridSize: "small",
  displayIdentifier: "22222222-2222-2222-2222-222222222222",
  uniqueIdentifier: "33333333-3333-3333-3333-333333333333",
};
const tuple = {
  udid: UDID,
  extension: "org.widgets",
  kind: "Kind",
  size: "small" as const,
};
async function fixture(initial: Dict = { iconLists: [] }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-test-"));
  let state = initial,
    time = 0;
  const commands: string[][] = [],
    payloads: Dict[] = [];
  const live = {
    udid: UDID,
    pid: 123,
    identity: "identity",
    protocol: 1,
    ready: true,
  };
  const listing = {
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
        { udid: UDID, state: "Booted", dataPath: path.join(dir, "data") },
      ],
    },
  };
  const r: Runtime = {
    command: async (args) => {
      commands.push(args);
      if (args.includes("devices")) return JSON.stringify(listing);
      if (args.includes("manageruid")) return "501\n";
      if (args.includes("print")) return "pid = 123\n";
      throw Error("Unexpected host command " + args.join(" "));
    },
    heartbeat: async () => live,
    compileWorker: async () => [path.join(dir, "worker.dylib"), "identity"],
    loadIconstate: async () => [state, path.join(dir, "state")],
    requestWorker: async (_s, _live, payload, expected) => {
      payloads.push(payload);
      return [{ status: "submitted", action: "reveal", ...expected }, 0.001];
    },
    sleep: async (ms) => {
      time += ms;
    },
    now: () => time,
  };
  return {
    dir,
    r,
    commands,
    payloads,
    run: createBackend(r, path.join(dir, "global")),
    setState: (v: Dict) => {
      state = v;
    },
    dispose: () => fs.rm(dir, { recursive: true, force: true }),
  };
}
test("missing removal skips compile injection and commands", async () => {
  const f = await fixture();
  try {
    f.r.compileWorker = async () => {
      throw Error("compile forbidden");
    };
    assert.equal(
      (
        await f.run({
          ...tuple,
          mode: "remove",
          stateDirectory: path.join(f.dir, "custom"),
        })
      ).status,
      "removed",
    );
    assert.equal(f.payloads.length, 0);
    assert.equal(
      f.commands.filter((c) => c.includes("debug") || c.includes("kickstart"))
        .length,
      0,
    );
  } finally {
    await f.dispose();
  }
});
test("duplicate preflight sends no widget command or compilation", async () => {
  const f = await fixture({ iconLists: [[w, w]] });
  try {
    f.r.compileWorker = async () => {
      throw Error("compile forbidden");
    };
    assert.equal(
      (await f.run({ ...tuple, mode: "ensure" })).status,
      "duplicate_existing_widgets",
    );
    assert.equal(f.payloads.length, 0);
  } finally {
    await f.dispose();
  }
});
test("exact handles address duplicate tuples and stale handles fail closed", async () => {
  const other = {
    ...w,
    displayIdentifier: "44444444-4444-4444-4444-444444444444",
    uniqueIdentifier: "55555555-5555-5555-5555-555555555555",
  };
  const f = await fixture({ iconLists: [[w, other]] });
  try {
    const result = await f.run({
      ...tuple,
      mode: "ensure",
      iconIdentifier: w.displayIdentifier,
    });
    assert.equal(result.status, "verified");
    assert.equal(result.iconIdentifier, w.displayIdentifier);
    assert.equal(f.payloads.length, 1);
    assert.equal(
      (
        await f.run({
          ...tuple,
          mode: "ensure",
          iconIdentifier: "66666666-6666-6666-6666-666666666666",
        })
      ).status,
      "failed",
    );
    assert.equal(f.payloads.length, 1);
  } finally {
    await f.dispose();
  }
});
test("prepare and inspect use warm worker without IconState", async () => {
  const f = await fixture();
  try {
    f.r.loadIconstate = async () => {
      throw Error("read forbidden");
    };
    assert.equal(
      (await f.run({ udid: UDID, mode: "prepare" })).status,
      "ready",
    );
    assert.equal(f.payloads.length, 0);
    f.r.requestWorker = async (_s, _l, p) => {
      f.payloads.push(p);
      return [{ status: "inspected", inspection: { classes: {} } }, 0];
    };
    assert.equal(
      (await f.run({ udid: UDID, mode: "inspect" })).status,
      "inspected",
    );
    assert.deepEqual(f.payloads, [{ mode: "inspect" }]);
  } finally {
    await f.dispose();
  }
});
test("new placement reveals separately and rejects changed persisted identity", async () => {
  for (const corrupt of [false, true]) {
    const f = await fixture({ iconLists: [["app"]] });
    try {
      f.r.requestWorker = async (_s, _l, p, expected) => {
        f.payloads.push(p);
        f.setState({
          iconLists: [
            [
              "app",
              {
                ...w,
                ...(corrupt && expected
                  ? { uniqueIdentifier: "44444444-4444-4444-4444-444444444444" }
                  : {}),
              },
            ],
          ],
        });
        return [
          {
            status: "submitted",
            ...(expected ? { ...expected, action: "reveal" } : {}),
          },
          0,
        ];
      };
      const result = await f.run({ ...tuple, mode: "ensure" });
      assert.equal(
        result.status,
        corrupt ? "reveal_persistence_unverified" : "verified",
      );
      assert.equal(f.payloads.length, 2);
      assert.equal(f.payloads[1]!.iconIdentifier, w.displayIdentifier);
    } finally {
      await f.dispose();
    }
  }
});
test("placement verifies preservation of apps", async () => {
  const f = await fixture({ iconLists: [["app"]] });
  try {
    f.r.requestWorker = async (_s, _l, _p, expected) => {
      f.setState({ iconLists: [[w]] });
      return [
        {
          status: "submitted",
          ...(expected ? { ...expected, action: "reveal" } : {}),
        },
        0,
      ];
    };
    assert.equal(
      (await f.run({ ...tuple, mode: "ensure" })).status,
      "placement_persistence_unverified",
    );
  } finally {
    await f.dispose();
  }
});
test("exclusive preflight failure prevents every removal", async () => {
  const f = await fixture({
    iconLists: [
      [
        w,
        {
          ...w,
          gridSize: "medium",
          displayIdentifier: "44444444-4444-4444-4444-444444444444",
          uniqueIdentifier: "55555555-5555-5555-5555-555555555555",
        },
      ],
    ],
  });
  try {
    f.r.requestWorker = async (_s, _l, p) => {
      f.payloads.push(p);
      return [{ status: "error", error: "descriptor unavailable" }, 0];
    };
    assert.equal(
      (await f.run({ ...tuple, mode: "ensure", exclusive: true })).status,
      "exclusive_preflight_rejected",
    );
    assert.deepEqual(
      f.payloads.map((p) => p.mode),
      ["validate"],
    );
  } finally {
    await f.dispose();
  }
});
test("removal observes both target absence and unrelated preservation", async () => {
  const f = await fixture({ iconLists: [["app", w]] });
  try {
    f.r.requestWorker = async () => {
      f.setState({ iconLists: [[]] });
      return [{ status: "removal_submitted" }, 0];
    };
    const result = await f.run({ ...tuple, mode: "remove" });
    assert.equal(result.status, "removal_unverified");
    assert.match(result.verification_error, /disappeared/);
  } finally {
    await f.dispose();
  }
});
const intent = {
  intentClass: "INAppIntent",
  appBundleIdentifier: "org.app",
  extensionBundleIdentifier: "org.widgets",
  appIntentIdentifier: "Settings",
  parameters: { entity: { identifier: "opaque", image: { uri: "preserved" } } },
};
const config = {
  schemaVersion: 1,
  ...tuple,
  container: "org.app",
  ...persistedTarget(w),
  intent,
};
test("configuration export returns detached exact envelope and rejects incomplete roundtrip", async () => {
  for (const corrupt of [false, true]) {
    const f = await fixture({ iconLists: [["app", w]] });
    try {
      f.r.requestWorker = async () => [
        {
          status: "configuration_exported",
          widgetIdentityVerified: true,
          roundtripVerified: true,
          configuration: config,
          roundtrip: corrupt ? { ...intent, parameters: {} } : intent,
        },
        0,
      ];
      const result = await f.run({ ...tuple, mode: "exportConfiguration" });
      assert.equal(
        result.status,
        corrupt ? "failed" : "configuration_exported",
      );
      if (!corrupt) assert.deepEqual(result.configuration, config);
    } finally {
      await f.dispose();
    }
  }
});
test("configuration apply requires new identity persistence and all other identity counts", async () => {
  for (const corrupt of [false, true]) {
    const f = await fixture({ iconLists: [["app", w]] });
    try {
      const updated = {
        ...w,
        uniqueIdentifier: "44444444-4444-4444-4444-444444444444",
      };
      f.r.requestWorker = async (_s, _l, p) => {
        assert.deepEqual(p.configuration, config);
        f.setState({ iconLists: [corrupt ? [updated] : ["app", updated]] });
        return [
          {
            status: "configuration_applied",
            widgetIdentityVerified: true,
            roundtripVerified: true,
            archiving: true,
            appliedWidgetIdentifier: updated.uniqueIdentifier,
            configuration: {
              ...config,
              widgetIdentifier: updated.uniqueIdentifier,
            },
            roundtrip: intent,
          },
          0,
        ];
      };
      const result = await f.run({
        ...tuple,
        mode: "applyConfiguration",
        configuration: config,
      });
      assert.equal(result.status, corrupt ? "failed" : "configuration_applied");
      if (!corrupt)
        assert.equal(
          result.configuration.widgetIdentifier,
          updated.uniqueIdentifier,
        );
    } finally {
      await f.dispose();
    }
  }
});
test("invalid configuration binding fails before compilation", async () => {
  const f = await fixture({ iconLists: [[w]] });
  try {
    f.r.compileWorker = async () => {
      throw Error("compile forbidden");
    };
    const result = await f.run({
      ...tuple,
      mode: "applyConfiguration",
      configuration: { ...config, udid: "other" },
    });
    assert.match(result.error, /udid does not match/);
    assert.equal(f.payloads.length, 0);
  } finally {
    await f.dispose();
  }
});
test("unload absent ownership is a no-op without restart", async () => {
  const f = await fixture();
  try {
    f.r.heartbeat = async () => null;
    const result = await f.run({ udid: UDID, mode: "unload" });
    assert.equal(result.status, "unloaded");
    assert.equal(result.no_op, true);
    assert.equal(f.commands.filter((c) => c.includes("kickstart")).length, 0);
  } finally {
    await f.dispose();
  }
});
test("state directory safety and atomic JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-fs-"));
  try {
    const state = await prepareDirectory(
      path.join(dir, "cache $(nothing); spaces"),
    );
    await atomicJson(path.join(state, "value.json"), { literal: "$(nothing)" });
    assert.deepEqual(await readJson(path.join(state, "value.json")), {
      literal: "$(nothing)",
    });
    await fs.symlink(state, path.join(dir, "link"));
    await assert.rejects(prepareDirectory(path.join(dir, "link")), /symlink/);
    await fs.chmod(state, 0o777);
    await assert.rejects(prepareDirectory(state), /writable by others/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("heartbeat validates freshness device and live integer PID", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-hb-"));
  const session = path.join(dir, UDID);
  await fs.mkdir(session);
  try {
    const live = { udid: UDID, pid: process.pid, timestamp: Date.now() / 1000 };
    await atomicJson(path.join(session, "heartbeat.json"), live);
    assert.ok(await heartbeat(session));
    for (const bad of [
      { ...live, udid: "other" },
      { ...live, pid: true },
      { ...live, pid: 0 },
      { ...live, timestamp: 0 },
      { ...live, timestamp: "nan" },
    ]) {
      await atomicJson(path.join(session, "heartbeat.json"), bad);
      assert.equal(await heartbeat(session), null);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("locks serialize and recover dead process owner", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-lock-"));
  try {
    const lock = path.join(dir, "lock"),
      events: string[] = [];
    await Promise.all([
      withLock(lock, async () => {
        events.push("a");
        await new Promise((r) => setTimeout(r, 60));
        events.push("b");
      }),
      withLock(lock, async () => {
        events.push("c");
      }),
    ]);
    assert.ok(
      JSON.stringify(events) === '["a","b","c"]' ||
        JSON.stringify(events) === '["c","a","b"]',
    );
    await fs.writeFile(lock, "old dead-process metadata");
    assert.equal(await withLock(lock, async () => 42), 42);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("plist loading requires Home iconLists and accepts XML date/data", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-plist-"));
  try {
    const file = path.join(dir, "IconState.plist");
    await assert.rejects(loadIconstate([file]));
    await fs.writeFile(file, plist.build({ todayLists: [] }));
    await assert.rejects(loadIconstate([file]));
    await fs.writeFile(
      file,
      plist.build({
        iconLists: [],
        date: new Date("2020-01-01"),
        data: Buffer.from("data"),
      }),
    );
    const [value] = await loadIconstate([file]);
    assert.deepEqual(value.iconLists, []);
    assert.ok(value.date instanceof Date);
    assert.ok(Buffer.isBuffer(value.data));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("compilation cache identity ignores volatile runtime metadata", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-compile-"));
  try {
    const id = "com.apple.CoreSimulator.SimRuntime.iOS-27-0",
      listing = { devices: { [id]: [{ udid: UDID }] } },
      runtime = {
        identifier: id,
        version: "27.0",
        supportedArchitectures: ["arm64"],
        lastUsedAt: "a",
      };
    let count = 0;
    const run = async (args: string[]) => {
      if (args.includes("runtimes"))
        return JSON.stringify({ runtimes: [runtime] });
      if (args.includes("--show-sdk-path")) return "/SDK with spaces";
      if (args.includes("--find")) return "/clang with spaces";
      if (args.includes("--show-sdk-version")) return "27.0";
      if (args.includes("--version")) return "clang version";
      if (args.includes("-dynamiclib")) {
        count++;
        assert.equal(
          args[args.indexOf("-target") + 1],
          "arm64-apple-ios27.0-simulator",
        );
        await fs.writeFile(
          args[args.indexOf("-o") + 1]!,
          Buffer.from("worker"),
        );
        return "";
      }
      throw Error("Unexpected command");
    };
    const first = await compileWorker(dir, UDID, listing, "arm64", run);
    runtime.lastUsedAt = "b";
    assert.deepEqual(
      await compileWorker(dir, UDID, listing, "arm64", run),
      first,
    );
    assert.equal(count, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("exec arguments stay literal without shell", async () =>
  assert.equal(
    await command([
      process.execPath,
      "-e",
      "process.stdout.write(process.argv[1])",
      "$(touch nope); `echo no`",
    ]),
    "$(touch nope); `echo no`",
  ));
test("request ignores stale nonce then fails changed heartbeat and clears command", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-request-"));
  const session = path.join(dir, UDID);
  await fs.mkdir(session);
  try {
    await assert.rejects(
      requestWorker(
        session,
        { pid: 123, identity: "identity" },
        { mode: "inspect" },
      ),
      /heartbeat changed or stopped/,
    );
    await assert.rejects(fs.access(path.join(session, "command.json")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("kernel lock releases after owner dies", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-death-"));
  const lock = path.join(dir, "lock");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import {withLock} from './src/backend-runtime.ts';await withLock(${JSON.stringify(lock)},async()=>{process.stdout.write('OWNED\\n');await new Promise(()=>{});});`,
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("OWNED")) resolve();
      });
      child.once("error", reject);
      child.once("exit", (code) => reject(Error("child exited " + code)));
    });
    child.kill("SIGKILL");
    assert.equal(await withLock(lock, async () => 42), 42);
  } finally {
    child.kill("SIGKILL");
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("worker transport ignores stale nonce and verifies exact PID", async () => {
  for (const wrongPid of [false, true]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-nonce-"));
    const session = path.join(dir, UDID);
    await fs.mkdir(session);
    try {
      const live = {
        udid: UDID,
        pid: process.pid,
        identity: "identity",
        timestamp: Date.now() / 1000,
      };
      await atomicJson(path.join(session, "heartbeat.json"), live);
      const response = (async () => {
        let payload;
        while (!(payload = await readJson(path.join(session, "command.json"))))
          await new Promise((r) => setTimeout(r, 5));
        await atomicJson(path.join(session, "response.json"), {
          nonce: "stale",
          pid: process.pid,
          status: "inspected",
        });
        await new Promise((r) => setTimeout(r, 60));
        await atomicJson(path.join(session, "response.json"), {
          nonce: payload.nonce,
          pid: wrongPid ? process.pid + 1 : process.pid,
          status: "inspected",
          inspection: {},
        });
      })();
      const request = requestWorker(session, live, { mode: "inspect" });
      if (wrongPid) await assert.rejects(request, /SpringBoard PID/);
      else assert.equal((await request)[0].status, "inspected");
      await response;
      await assert.rejects(fs.access(path.join(session, "command.json")));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});
