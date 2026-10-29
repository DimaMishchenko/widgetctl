import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runCli, type CliRuntime } from "../src/cli.js";
import type { WidgetController } from "../src/controller.js";
const cli = new URL("../dist/cli.js", import.meta.url);
const udid = "208E6530-2FE7-45F7-9947-E3976A766E41";
const icon = "F08E6530-2FE7-45F7-9947-E3976A766E41";
function invoke(...args: string[]) {
  return spawnSync(process.execPath, [cli.pathname, ...args], {
    encoding: "utf8",
  });
}
function setup(overrides: Partial<CliRuntime> = {}) {
  const calls: string[] = [];
  let stdout = "";
  let stderr = "";
  const controller = {
    prepare: async () => {
      calls.push("prepare");
    },
    release: async () => {
      calls.push("release");
    },
    catalog: async () => ({
      apps: [
        {
          bundleIdentifier: "app",
          name: "Example",
          widgets: [
            {
              target: {
                container: "app",
                extension: "app.widget",
                kind: "rates",
              },
              sizes: ["small"],
            },
          ],
        },
      ],
    }),
    installedWidgets: async () => [],
    ensure: async () => {
      calls.push("ensure");
      return {
        iconIdentifier: icon,
        target: { extension: "app.widget", kind: "rates", size: "small" },
      };
    },
    getWidget: async () => ({
      remove: async () => {
        calls.push("remove");
        return { status: "removed" };
      },
    }),
  } as unknown as WidgetController;
  const runtime: Partial<CliRuntime> = {
    isTTY: false,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    devices: async () => [
      { udid, name: "Phone", state: "booted", runtime: "26.0" },
    ],
    controller: () => controller,
    prompts: async () => {
      throw new Error("Unexpected prompt");
    },
    ...overrides,
  };
  return {
    runtime,
    calls,
    controller,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}
test("CLI help and version do not connect to a simulator", () => {
  assert.equal(invoke("--help").status, 0);
  assert.match(invoke("--help").stdout, /devices[\s\S]*configure/);
  assert.equal(invoke("--version").stdout.trim(), "0.1.0");
  assert.equal(invoke().status, 0);
});
test("JSON invalid input is stable and does not contain ANSI output", async () => {
  for (const args of [
    ["prepare"],
    ["ensure"],
    ["unknown"],
    ["add", "--device", udid],
    ["remove", "--device", udid],
    ["add", "--device", "invalid"],
    ["list", "--device", udid, "--replace"],
    ["list", "--unknown"],
    ["export", "--device", udid, "--widget", icon],
    ["edit", "--device", udid, "--widget", icon],
  ]) {
    const environment = setup();
    assert.equal(
      await runCli([...args, "--json"], environment.runtime),
      2,
      args.join(" "),
    );
    assert.deepEqual(environment.calls, []);
    assert.equal(JSON.parse(environment.stdout()).status, "failed");
    assert.equal(JSON.parse(environment.stdout()).schemaVersion, 1);
    assert.doesNotMatch(environment.stdout(), /\u001b/);
  }
});
test("add resolves only installed catalog metadata and always releases", async () => {
  const environment = setup();
  assert.equal(
    await runCli(
      [
        "add",
        "--device",
        udid,
        "--app",
        "app",
        "--kind",
        "rates",
        "--size",
        "small",
        "--json",
      ],
      environment.runtime,
    ),
    0,
  );
  assert.deepEqual(environment.calls, ["prepare", "ensure", "release"]);
  assert.equal(JSON.parse(environment.stdout()).iconIdentifier, icon);
});
test("unsupported catalog size never writes and still releases", async () => {
  const environment = setup();
  assert.equal(
    await runCli(
      [
        "add",
        "--device",
        udid,
        "--app",
        "app",
        "--kind",
        "rates",
        "--size",
        "large",
        "--json",
      ],
      environment.runtime,
    ),
    2,
  );
  assert.deepEqual(environment.calls, ["prepare", "release"]);
});
test("a failed preparation releases its partially initialized helper", async () => {
  const environment = setup();
  environment.controller.prepare = async () => {
    environment.calls.push("prepare");
    throw new Error("partial setup failed");
  };
  assert.equal(
    await runCli(["catalog", "--device", udid, "--json"], environment.runtime),
    1,
  );
  assert.deepEqual(environment.calls, ["prepare", "release"]);
  assert.match(JSON.parse(environment.stdout()).error, /partial setup/);
});
test("remove targets an exact identity without ensuring or adding", async () => {
  const environment = setup();
  assert.equal(
    await runCli(
      ["remove", "--device", udid, "--widget", icon, "--json"],
      environment.runtime,
    ),
    0,
  );
  assert.deepEqual(environment.calls, ["prepare", "remove", "release"]);
});
test("devices is read only and JSON mode never prompts even in a terminal", async () => {
  const environment = setup({ isTTY: true });
  assert.equal(await runCli(["devices", "--json"], environment.runtime), 0);
  assert.equal(JSON.parse(environment.stdout()).devices[0].runtime, "26.0");
  assert.deepEqual(environment.calls, []);
});
test("guided cancellation before preparation does not initialize helpers", async () => {
  const environment = setup({
    isTTY: true,
    prompts: async () => ({
      select: async () => "$exit" as never,
      confirm: async () => false,
      input: async () => "",
      editor: async () => "",
    }),
  });
  assert.equal(await runCli([], environment.runtime), 130);
  assert.deepEqual(environment.calls, []);
});
test("guided shutdown simulator requires explicit boot and UI restart consent", async () => {
  const questions: string[] = [];
  const environment = setup({
    isTTY: true,
    devices: async () => [
      { udid, name: "Phone", state: "shutdown", runtime: "26.0" },
    ],
    boot: async () => {
      questions.push("booted");
    },
    prompts: async () => ({
      select: async () => udid as never,
      confirm: async (message) => {
        questions.push(message);
        return !message.startsWith("Prepare");
      },
      input: async () => "",
      editor: async () => "",
    }),
  });
  assert.equal(await runCli(["catalog"], environment.runtime), 130);
  assert.match(questions[0]!, /Boot.*claim/);
  assert.equal(questions[1], "booted");
  assert.match(questions[2]!, /UI may restart/);
  assert.deepEqual(environment.calls, []);
});
test("CLI runs through an npm-style executable symlink", () => {
  const directory = mkdtempSync(join(tmpdir(), "widgetctl-bin-"));
  try {
    const executable = join(directory, "widgetctl");
    symlinkSync(cli.pathname, executable);
    const result = spawnSync(process.execPath, [executable, "--help"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /iOS Simulator widget testing helper/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cleanup failure keeps the original operation error visible", async () => {
  const environment = setup();
  environment.controller.prepare = async () => {
    throw new Error("setup failed");
  };
  environment.controller.release = async () => {
    throw new Error("release failed");
  };
  assert.equal(
    await runCli(["catalog", "--device", udid, "--json"], environment.runtime),
    1,
  );
  assert.match(
    JSON.parse(environment.stdout()).error,
    /setup failed.*release failed/,
  );
});

test("human device names cannot inject terminal control sequences", async () => {
  const environment = setup({
    devices: async () => [
      { udid, name: "Phone\u001b[2J\u0007", runtime: "26.0", state: "booted" },
    ],
  });
  assert.equal(await runCli(["devices"], environment.runtime), 0);
  assert.doesNotMatch(environment.stdout(), /\u001b|\u0007/);
  assert.match(environment.stdout(), /Phone/);
});

test("SIGINT during prepare prevents mutation and releases before reporting cancellation", async () => {
  const environment = setup();
  environment.controller.prepare = async () => {
    environment.calls.push("prepare");
    process.emit("SIGINT");
    return {} as never;
  };
  assert.equal(
    await runCli(
      [
        "add",
        "--device",
        udid,
        "--app",
        "app",
        "--kind",
        "rates",
        "--size",
        "small",
        "--json",
      ],
      environment.runtime,
    ),
    130,
  );
  assert.deepEqual(environment.calls, ["prepare", "release"]);
  assert.equal(JSON.parse(environment.stdout()).status, "cancelled");
});

test("SIGINT does not hide a failed release or claim successful cancellation", async () => {
  const environment = setup();
  environment.controller.prepare = async () => {
    process.emit("SIGINT");
    return {} as never;
  };
  environment.controller.release = async () => {
    throw new Error("worker_still_live");
  };
  assert.equal(
    await runCli(["catalog", "--device", udid, "--json"], environment.runtime),
    1,
  );
  const result = JSON.parse(environment.stdout());
  assert.equal(result.status, "failed");
  assert.match(result.error, /worker_still_live/);
});

test("JSON results preserve canonical strings containing terminal-sensitive codepoints", async () => {
  const text = "left\u202eright\u0085\tline\nnext";
  const environment = setup();
  environment.controller.catalog = async () => ({
    apps: [{ bundleIdentifier: "app", name: text, widgets: [] }],
  });
  assert.equal(
    await runCli(["catalog", "--device", udid, "--json"], environment.runtime),
    0,
  );
  assert.equal(JSON.parse(environment.stdout()).catalog.apps[0].name, text);
  assert.doesNotMatch(environment.stdout(), /\u202e|\u0085/);
});

test("listing saved widget identities never prepares or restarts the simulator UI", async () => {
  const environment = setup();
  environment.controller.installedWidgets = async () => {
    environment.calls.push("list");
    return [];
  };
  assert.equal(
    await runCli(["list", "--device", udid, "--json"], environment.runtime),
    0,
  );
  assert.deepEqual(environment.calls, ["list"]);
  assert.equal(JSON.parse(environment.stdout()).status, "widgets_listed");
});
