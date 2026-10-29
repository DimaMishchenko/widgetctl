import { test } from "node:test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as plist from "plist";
import { UID } from "bplist-parser";
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
  preparedWorker,
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
        {
          udid: UDID,
          name: "Owned simulator",
          state: "Booted",
          isAvailable: true,
          dataPath: path.join(dir, "data"),
        },
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
    preparedWorker: async () => [path.join(dir, "worker.dylib"), "identity"],
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
    assert.equal(result.visibility, "unverified");
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
      if (!corrupt) assert.equal(result.visibility, "unverified");
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
        nested: [{ data: Buffer.from("nested") }],
      }),
    );
    const [value] = await loadIconstate([file]);
    assert.deepEqual(value.iconLists, []);
    assert.ok(value.date instanceof Date);
    assert.ok(Buffer.isBuffer(value.data));
    assert.deepEqual(value.data, Buffer.from("data"));
    assert.deepEqual(value.nested[0].data, Buffer.from("nested"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("binary IconState preserves opaque null, UID, date, data and exact integers", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "widgetctl-binary-plist-"),
  );
  try {
    const file = path.join(dir, "IconState.plist");
    await fs.writeFile(
      file,
      Buffer.from(
        "YnBsaXN0MDDZAQIDBAUGBwgJCgsMDQ4PEBQVW2Fic2VudFZhbHVlVGRhdGFUZGF0ZVlpY29uTGlzdHNcbGFyZ2VJbnRlZ2VyXxAPbmVnYXRpdmVJbnRlZ2VyVm5lc3RlZFtzYWZlSW50ZWdlclN1aWQARGRhdGEzQcHeDEAAAACgFAAAAAAAAAAAgAAAAAAAAAET/////////9akChESEwgQAFATAAABAAAAAAGAKggbJywxO0haYW1xcneAgZKboKGjpK0AAAAAAAABAQAAAAAAAAAWAAAAAAAAAAAAAAAAAAAArw==",
        "base64",
      ),
    );
    const [value, source] = await loadIconstate([file]);
    assert.equal(source, file);
    assert.deepEqual(value.iconLists, []);
    assert.ok(Object.hasOwn(value, "absentValue"));
    assert.equal(value.absentValue, null);
    assert.deepEqual(value.nested, [null, false, 0, ""]);
    assert.equal(value.date.toISOString(), "2020-01-01T00:00:00.000Z");
    assert.deepEqual(value.data, Buffer.from("data"));
    assert.ok(value.uid instanceof UID);
    assert.equal(value.uid.UID, 42);
    assert.equal(value.safeInteger, 1_099_511_627_777);
    assert.equal(value.negativeInteger, -42);
    assert.equal(value.largeInteger, 9_223_372_036_854_775_809n);
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
    assert.deepEqual(
      await preparedWorker(dir, UDID, listing, "arm64", run),
      first,
    );
    assert.equal(count, 1);
    runtime.version = "27.1";
    await assert.rejects(
      preparedWorker(dir, UDID, listing, "arm64", run),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "HELPER_UNAVAILABLE",
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
test("supplied container is checked before existing widget mutations", async () => {
  for (const mode of ["ensure", "remove"] as const) {
    const f = await fixture({ iconLists: [[w]] });
    try {
      const result = await f.run({ ...tuple, mode, container: "org.wrong" });
      assert.equal(result.status, "failed");
      assert.match(result.error, /container/);
      assert.equal(f.payloads.length, 0);
    } finally {
      await f.dispose();
    }
  }
});
test("exact widget UUID selection accepts equivalent letter case", async () => {
  const widget = {
    ...w,
    displayIdentifier: "ABCDEFAB-2222-2222-2222-222222222222",
  };
  const f = await fixture({ iconLists: [[widget]] });
  try {
    const result = await f.run({
      ...tuple,
      mode: "ensure",
      iconIdentifier: widget.displayIdentifier.toLowerCase(),
    });
    assert.equal(result.status, "verified");
    assert.equal(f.payloads[0]!.iconIdentifier, widget.displayIdentifier);
  } finally {
    await f.dispose();
  }
});
test("JavaScript callers cannot enable destructive flags with truthy non-booleans", async () => {
  const f = await fixture({ iconLists: [[w]] });
  try {
    for (const key of ["exclusive", "replace"]) {
      const result = await f.run({
        ...tuple,
        mode: "ensure",
        [key]: "false",
      } as any);
      assert.equal(result.status, "failed");
      assert.match(result.error, /must be a boolean/);
    }
    for (const key of [
      "container",
      "iconIdentifier",
      "stateDirectory",
      "launchDomain",
    ]) {
      const result = await f.run({ ...tuple, mode: "ensure", [key]: "" });
      assert.equal(result.status, "failed");
      assert.match(result.error, /nonempty string/);
    }
    assert.equal(f.commands.length, 0);
    assert.equal(f.payloads.length, 0);
  } finally {
    await f.dispose();
  }
});
test("placement does not verify a widget from a different app container", async () => {
  const f = await fixture();
  try {
    f.r.requestWorker = async () => {
      f.setState({ iconLists: [[w]] });
      return [{ status: "submitted" }, 0];
    };
    const result = await f.run({
      ...tuple,
      mode: "ensure",
      container: "org.wrong",
    });
    assert.equal(result.status, "placement_persistence_unverified");
    assert.match(result.verification_error, /container/);
  } finally {
    await f.dispose();
  }
});

test("prepared-only catalog rejects cold sessions without creating directories or compiling", async () => {
  const f = await fixture();
  try {
    let builds = 0;
    f.r.compileWorker = async () => {
      builds++;
      throw Error("compile forbidden");
    };
    f.r.preparedWorker = async () => {
      throw Error("cache inspection forbidden before session validation");
    };
    const result = await f.run({
      udid: UDID,
      mode: "catalog",
      requirePrepared: true,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "HELPER_UNAVAILABLE");
    assert.equal(builds, 0);
    assert.deepEqual(f.commands, []);
    assert.deepEqual(f.payloads, []);
    assert.deepEqual(await fs.readdir(f.dir), []);
  } finally {
    await f.dispose();
  }
});

for (const stale of [
  "missing heartbeat",
  "wrong identity",
  "wrong protocol",
  "not ready",
  "wrong device",
  "wrong pid",
  "restarted SpringBoard",
  "pending injection",
  "wrong injection target",
  "missing injection",
  "stale cache identity",
  "missing cache",
] as const) {
  test(`prepared-only catalog fails closed without repair: ${stale}`, async () => {
    const f = await fixture();
    try {
      assert.equal(
        (await f.run({ udid: UDID, mode: "prepare" })).status,
        "ready",
      );
      const session = path.join(f.dir, "global/sessions", UDID);
      const injectionPath = path.join(session, "injection.json");
      const injection = await fs.readFile(injectionPath, "utf8");
      const live = { ...(await f.r.heartbeat(session))! };
      if (stale === "missing heartbeat") f.r.heartbeat = async () => null;
      else if (stale === "wrong identity") {
        live.identity = "changed";
        f.r.heartbeat = async () => live;
      } else if (stale === "wrong protocol") {
        live.protocol = 2;
        f.r.heartbeat = async () => live;
      } else if (stale === "not ready") {
        live.ready = false;
        f.r.heartbeat = async () => live;
      } else if (stale === "wrong device") {
        live.udid = "other";
        f.r.heartbeat = async () => live;
      } else if (stale === "wrong pid") {
        live.pid = 456;
        f.r.heartbeat = async () => live;
      } else if (stale === "restarted SpringBoard") {
        const command = f.r.command;
        f.r.command = async (args, timeout) =>
          args.includes("print") ? "pid = 456\n" : command(args, timeout);
      } else if (stale === "pending injection")
        await fs.writeFile(
          injectionPath,
          JSON.stringify({ ...JSON.parse(injection), pending: true }),
        );
      else if (stale === "wrong injection target")
        await fs.writeFile(
          injectionPath,
          JSON.stringify({ ...JSON.parse(injection), target: "other" }),
        );
      else if (stale === "missing injection") await fs.rm(injectionPath);
      else if (stale === "stale cache identity")
        f.r.preparedWorker = async () => ["/existing/worker.dylib", "changed"];
      else if (stale === "missing cache")
        f.r.preparedWorker = async () => {
          throw new (await import("../src/errors.js")).WidgetctlError(
            "Missing cached worker",
            { code: "HELPER_UNAVAILABLE" },
          );
        };
      const before = await readJson(injectionPath);
      await fs.writeFile(
        path.join(session, "command.json"),
        "existing protocol command",
      );
      f.commands.length = 0;
      let builds = 0;
      f.r.compileWorker = async () => {
        builds++;
        throw Error("compile forbidden");
      };
      const result = await f.run({
        udid: UDID,
        mode: "catalog",
        requirePrepared: true,
      });
      assert.equal(result.status, "failed");
      assert.equal(result.errorCode, "HELPER_UNAVAILABLE", result.error);
      assert.equal(builds, 0);
      assert.deepEqual(f.payloads, []);
      assert.equal(
        f.commands.some(
          (command) =>
            command.includes("debug") ||
            command.includes("kickstart") ||
            command.includes("-dynamiclib"),
        ),
        false,
      );
      assert.equal(
        await fs.readFile(path.join(session, "command.json"), "utf8"),
        "existing protocol command",
      );
      assert.deepEqual(await readJson(injectionPath), before);
    } finally {
      await f.dispose();
    }
  });
}

test("prepared-only catalog queries the live exact worker without compilation or changing injection state", async () => {
  const f = await fixture();
  try {
    await f.run({ udid: UDID, mode: "prepare" });
    const injectionPath = path.join(
      f.dir,
      "global/sessions",
      UDID,
      "injection.json",
    );
    const before = await fs.readFile(injectionPath, "utf8");
    f.commands.length = 0;
    f.r.compileWorker = async () => {
      throw Error("compile forbidden");
    };
    f.r.loadIconstate = async () => {
      throw Error("IconState read forbidden");
    };
    const command = f.r.command;
    f.r.command = async (args, timeout) =>
      args.includes("listapps")
        ? "{}"
        : args.includes("runtimes")
          ? JSON.stringify({
              runtimes: [
                {
                  identifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0",
                  version: "27.0",
                  isAvailable: true,
                },
              ],
            })
          : command(args, timeout);
    f.r.requestWorker = async (_session, live, payload) => {
      assert.equal(live.identity, "identity");
      f.payloads.push(payload);
      return [
        {
          status: "catalogued",
          widgets: [
            {
              extension: "org.widgets",
              container: "org.app",
              kind: "Kind",
              sizes: ["small"],
            },
          ],
        },
        0,
      ];
    };
    const result = await f.run({
      udid: UDID,
      mode: "catalog",
      requirePrepared: true,
    });
    assert.equal(result.status, "catalogued", result.error);
    assert.equal(result.catalog.apps[0].widgets[0].target.container, "org.app");
    assert.deepEqual(f.payloads, [{ mode: "catalog" }]);
    assert.equal(await fs.readFile(injectionPath, "utf8"), before);
    assert.equal(
      f.commands.some(
        (command) =>
          command.includes("debug") ||
          command.includes("kickstart") ||
          command.includes("-dynamiclib"),
      ),
      false,
    );
  } finally {
    await f.dispose();
  }
});

test("requirePrepared is boolean and catalog-only", async () => {
  const f = await fixture();
  try {
    for (const options of [
      { udid: UDID, mode: "prepare" as const, requirePrepared: true },
      { ...tuple, mode: "ensure" as const, requirePrepared: false },
      {
        udid: UDID,
        mode: "catalog" as const,
        requirePrepared: "true" as never,
      },
    ]) {
      const result = await f.run(options);
      assert.equal(result.errorCode, "INVALID_INPUT");
    }
    assert.deepEqual(f.commands, []);
  } finally {
    await f.dispose();
  }
});
