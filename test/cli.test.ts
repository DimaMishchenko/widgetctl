import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runCli, type CliRuntime } from "../src/cli.js";
import type { WidgetController } from "../src/controller.js";
import { WidgetctlError } from "../src/errors.js";
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
    applications: async () => [{ bundleIdentifier: "app", name: "Example" }],
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
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(invoke("--version").stdout.trim(), manifest.version);
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
test("guided exit before preparation does not initialize helpers", async () => {
  const environment = setup({
    isTTY: true,
    prompts: async () => ({
      select: async () => "$exit" as never,
      confirm: async () => false,
      input: async () => "",
      editor: async () => "",
    }),
  });
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, []);
});
test("guided stopped simulator combines boot and session consent", async () => {
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
        return true;
      },
      input: async () => "",
      editor: async () => "",
    }),
  });
  assert.equal(await runCli(["catalog"], environment.runtime), 0);
  assert.equal(questions.length, 2);
  assert.match(questions[0]!, /Boot and use Phone.*Home Screen.*restart/);
  assert.equal(questions[1], "booted");
  assert.deepEqual(environment.calls, ["prepare", "release"]);
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

function session(
  steps: (
    string | ((choices: { name: string; value: unknown }[]) => unknown)
  )[],
  overrides: Partial<CliRuntime> = {},
) {
  const selections = [...steps];
  const environment = setup({
    isTTY: true,
    prompts: async () => ({
      select: async (_message, choices) => {
        assert.ok(selections.length, `Unexpected prompt: ${_message}`);
        const next = selections.shift()!;
        return (typeof next === "function" ? next(choices) : next) as never;
      },
      confirm: async () => true,
      input: async () => "configuration.json",
      editor: async () => "",
    }),
    ...overrides,
  });
  return { ...environment, selections };
}

test("guided sessions retain one helper across actions and fetch fresh catalogs", async () => {
  const environment = session(["add", udid, "add", "list", "$exit"]);
  const catalog = environment.controller.catalog;
  environment.controller.catalog = async () => {
    environment.calls.push("catalog");
    return catalog();
  };
  environment.controller.installedWidgets = async () => {
    environment.calls.push("list");
    return [];
  };
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, [
    "prepare",
    "catalog",
    "ensure",
    "catalog",
    "ensure",
    "list",
    "release",
  ]);
  assert.match(environment.stdout(), /widgetctl.*Phone/);
  assert.equal(environment.selections.length, 0);
});

test("listing in a guided session is lazy and exit without workers needs no release", async () => {
  const environment = session(["list", udid, "$exit"]);
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, []);
});

test("changing simulator releases the previous helper before using the next controller", async () => {
  const second = "308E6530-2FE7-45F7-9947-E3976A766E41";
  const environment = session(
    ["catalog", udid, "$device", second, "catalog", "$exit"],
    {
      devices: async () => [
        { udid, name: "First", state: "booted", runtime: "26.0" },
        { udid: second, name: "Second", state: "booted", runtime: "26.0" },
      ],
    },
  );
  environment.runtime.controller = ({ udid: selected }) => {
    environment.calls.push(`controller:${selected}`);
    return {
      ...environment.controller,
      prepare: async () => {
        environment.calls.push(`prepare:${selected}`);
        return {} as never;
      },
      release: async () => {
        environment.calls.push(`release:${selected}`);
        return {} as never;
      },
    };
  };
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, [
    `controller:${udid}`,
    `prepare:${udid}`,
    `release:${udid}`,
    `controller:${second}`,
    `prepare:${second}`,
    `release:${second}`,
  ]);
});

test("cancelled widget pickers return to the session menu", async () => {
  const environment = session(["remove", udid, "$back", "catalog", "$exit"]);
  environment.controller.installedWidgets = async () =>
    [
      {
        target: {
          container: "app",
          extension: "app.widget",
          kind: "rates",
          size: "small",
          iconIdentifier: icon,
        },
      },
    ] as never;
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, ["prepare", "release"]);
  assert.equal(environment.stderr(), "");
});

test("cancelled configuration drafts return to menu and refresh exact widget handles", async () => {
  const environment = session([
    "edit",
    udid,
    icon,
    (choices) => choices.find((choice) => choice.name === "Back")!.value,
    "remove",
    icon,
    "$exit",
  ]);
  environment.controller.installedWidgets = async () =>
    [
      {
        target: {
          container: "app",
          extension: "app.widget",
          kind: "rates",
          size: "small",
          iconIdentifier: icon,
        },
      },
    ] as never;
  environment.controller.getWidget = async () => {
    environment.calls.push("get");
    return {
      describeConfiguration: async () => ({
        configuration: { intent: { parameters: {} } },
        fields: [],
      }),
      remove: async () => {
        environment.calls.push("remove");
        return { status: "removed" };
      },
    } as never;
  };
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, [
    "prepare",
    "get",
    "get",
    "remove",
    "release",
  ]);
});

test("unknown session errors release before guidance and another action", async () => {
  const environment = session(["catalog", udid, "list", "$exit"]);
  environment.controller.catalog = async () => {
    throw new Error("catalog unavailable");
  };
  environment.controller.installedWidgets = async () => {
    environment.calls.push("list");
    return [];
  };
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, ["prepare", "release", "list"]);
  assert.match(environment.stderr(), /catalog unavailable/);
});

test("session preparation failures clean up before returning to menu", async () => {
  const environment = session(["catalog", udid, "catalog", "$exit"]);
  let attempt = 0;
  environment.controller.prepare = async () => {
    environment.calls.push("prepare");
    if (attempt++ === 0) throw new Error("setup failed");
    return {} as never;
  };
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, [
    "prepare",
    "release",
    "prepare",
    "release",
  ]);
});

test("session cleanup failure stops without offering unsafe further operations", async () => {
  const environment = session(["catalog", udid, "$device", "add"]);
  environment.controller.release = async () => {
    environment.calls.push("release");
    throw new Error("worker still live");
  };
  assert.equal(await runCli([], environment.runtime), 1);
  assert.deepEqual(environment.calls, ["prepare", "release"]);
  assert.equal(environment.selections.length, 1);
  assert.match(environment.stderr(), /worker still live/);
});

test("SIGINT exits a persistent session and releases its helper", async () => {
  const environment = session(["catalog", udid]);
  environment.controller.catalog = async () => {
    process.emit("SIGINT");
    return { apps: [] };
  };
  assert.equal(await runCli([], environment.runtime), 130);
  assert.deepEqual(environment.calls, ["prepare", "release"]);
});

test("doctor is read only and needs no selected simulator even in a terminal", async () => {
  for (const healthy of [true, false]) {
    const environment = setup({
      isTTY: true,
      devices: async () => {
        throw new Error("doctor must own discovery");
      },
      boot: async () => {
        throw new Error("doctor must never boot");
      },
      controller: () => {
        throw new Error("doctor must never create a controller");
      },
      doctor: async (options) => {
        assert.equal(options?.udid, undefined);
        return {
          schemaVersion: 1,
          healthy,
          checks: [
            {
              id: "tools",
              status: healthy ? "pass" : "fail",
              message: "diagnosis",
            },
          ],
        };
      },
    });
    assert.equal(
      await runCli(["doctor", "--json"], environment.runtime),
      healthy ? 0 : 1,
    );
    const result = JSON.parse(environment.stdout());
    assert.equal(result.status, "diagnosed");
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.healthy, healthy);
    assert.deepEqual(environment.calls, []);
  }
});

test("declining session preparation returns to the menu without worker setup", async () => {
  const environment = session(["catalog", udid, "$exit"]);
  const prompts = environment.runtime.prompts!;
  environment.runtime.prompts = async (signal) => ({
    ...(await prompts(signal)),
    confirm: async () => false,
  });
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, []);
});

test("catalog picker cancellation retains a prepared helper for the next action", async () => {
  const environment = session([
    "add",
    udid,
    (choices) => choices.find((choice) => choice.name === "Cancel")!.value,
    "catalog",
    "$exit",
  ]);
  environment.controller.catalog = async () => ({
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
            sizes: ["small", "medium"],
          },
        ],
      },
    ],
  });
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, ["prepare", "release"]);
  assert.equal(environment.stderr(), "");
});

test("session export and apply refresh exact widgets while keeping the helper", async () => {
  const environment = session([
    "export",
    udid,
    icon,
    "configure",
    icon,
    "$exit",
  ]);
  environment.runtime.read = async () => '{"intent":{"parameters":{}}}';
  environment.runtime.write = async (file) => {
    environment.calls.push(`write:${file}`);
  };
  environment.controller.installedWidgets = async () => {
    environment.calls.push("list");
    return [
      {
        target: {
          container: "app",
          extension: "app.widget",
          kind: "rates",
          size: "small",
          iconIdentifier: icon,
        },
      },
    ] as never;
  };
  environment.controller.getWidget = async () => {
    environment.calls.push("get");
    return {
      exportConfiguration: async () => ({ intent: { parameters: {} } }),
      applyConfiguration: async () => {
        environment.calls.push("apply");
        return {};
      },
    } as never;
  };
  assert.equal(await runCli([], environment.runtime), 0);
  assert.deepEqual(environment.calls, [
    "prepare",
    "list",
    "get",
    "write:configuration.json",
    "list",
    "get",
    "apply",
    "release",
  ]);
});

test("JSON local input failures include machine readable guidance", async () => {
  const environment = setup();
  assert.equal(
    await runCli(
      ["list", "--device", "invalid", "--json"],
      environment.runtime,
    ),
    2,
  );
  const result = JSON.parse(environment.stdout());
  assert.equal(result.code, "INVALID_INPUT");
  assert.equal(typeof result.retryable, "boolean");
  assert.ok(result.recovery.length > 0);
});

test("unsafe session errors release and stop before another action", async () => {
  for (const code of [
    "OWNERSHIP_LOST",
    "UNSAFE_STATE",
    "CLEANUP_FAILED",
    "HELPER_UNAVAILABLE",
  ] as const) {
    const environment = session(["catalog", udid, "add"]);
    environment.controller.catalog = async () => {
      throw new WidgetctlError("Session unsafe", { code });
    };
    assert.equal(await runCli([], environment.runtime), 1);
    assert.deepEqual(environment.calls, ["prepare", "release"]);
    assert.deepEqual(environment.selections, ["add"]);
    assert.match(environment.stderr(), /Session unsafe/);
  }
});

test("unknown write outcomes release and require a fresh preparation before continuing", async () => {
  for (const code of [
    "VERIFICATION_FAILED",
    "COMMAND_TIMEOUT",
    "OPERATION_FAILED",
  ] as const) {
    const environment = session(["add", udid, "catalog", "$exit"]);
    environment.controller.ensure = async () => {
      environment.calls.push("ensure");
      throw new WidgetctlError("Inspect the result before retrying", { code });
    };
    let confirmations = 0;
    const prompts = environment.runtime.prompts!;
    environment.runtime.prompts = async (signal) => ({
      ...(await prompts(signal)),
      confirm: async () => {
        confirmations++;
        return true;
      },
    });
    assert.equal(await runCli([], environment.runtime), 0);
    assert.deepEqual(environment.calls, [
      "prepare",
      "ensure",
      "release",
      "prepare",
      "release",
    ]);
    assert.equal(confirmations, 1);
    assert.match(environment.stderr(), /Inspect the result/);
  }
});

test("fatal editor queries never apply configuration and propagate session recovery policy", async () => {
  const failures = [
    new WidgetctlError("Lost editor ownership", { code: "OWNERSHIP_LOST" }),
    new WidgetctlError("Unknown query outcome", { code: "COMMAND_TIMEOUT" }),
    new WidgetctlError("Stale editor configuration", {
      code: "STALE_CONFIGURATION",
    }),
    new Error("Unexpected editor failure"),
  ];
  for (const stage of ["initial", "search"] as const) {
    for (const failure of failures) {
      const environment = session(["edit", udid, icon, "currency", "$exit"]);
      const basePrompts = environment.runtime.prompts!;
      environment.runtime.prompts = async (signal) => ({
        ...(await basePrompts(signal)),
        search: async (_message, source) => (await source("broken"))[0]!.value,
      });
      environment.controller.installedWidgets = async () =>
        [
          {
            target: {
              container: "app",
              extension: "app.widget",
              kind: "rates",
              size: "small",
              iconIdentifier: icon,
            },
          },
        ] as never;
      environment.controller.getWidget = async () =>
        ({
          describeConfiguration: async () => ({
            configuration: {
              intent: { parameters: { currency: { identifier: "USD" } } },
            },
            fields: [{ key: "currency", label: "Currency", type: "entity" }],
          }),
          configurationChoices: async (_key: string, term?: string) => {
            if (stage === "initial" || term) throw failure;
            return [];
          },
          applyConfiguration: async () => {
            assert.fail("Fatal query must not apply a configuration");
          },
        }) as never;
      assert.equal(
        await runCli([], environment.runtime),
        failure instanceof WidgetctlError && failure.code === "OWNERSHIP_LOST"
          ? 1
          : 0,
      );
      assert.deepEqual(environment.calls, ["prepare", "release"]);
      assert.match(environment.stderr(), new RegExp(failure.message));
    }
  }
});

test("operational failures before helper preparation use exit one with structured guidance", async () => {
  for (const action of ["devices", "doctor"] as const) {
    const failure = new Error("Host probe unavailable");
    const environment = setup({
      devices: async () => {
        throw failure;
      },
      doctor: async () => {
        throw failure;
      },
    });
    assert.equal(await runCli([action, "--json"], environment.runtime), 1);
    const result = JSON.parse(environment.stdout());
    assert.equal(result.code, "OPERATION_FAILED");
    assert.equal(result.error, failure.message);
    assert.equal(result.retryable, false);
    assert.ok(result.recovery.length);
    assert.deepEqual(environment.calls, []);
  }
});

test("SIGINT during editor search still exits the session and never applies a draft", async () => {
  const environment = session(["edit", udid, icon, "currency"]);
  const basePrompts = environment.runtime.prompts!;
  environment.runtime.prompts = async (signal) => ({
    ...(await basePrompts(signal)),
    search: async (_message, source) => {
      const query = new AbortController();
      query.abort();
      assert.deepEqual(await source("old", query.signal), []);
      process.emit("SIGINT");
      signal.throwIfAborted();
      throw new Error("Expected session abort");
    },
  });
  environment.controller.installedWidgets = async () =>
    [
      {
        target: {
          container: "app",
          extension: "app.widget",
          kind: "rates",
          size: "small",
          iconIdentifier: icon,
        },
      },
    ] as never;
  environment.controller.getWidget = async () =>
    ({
      describeConfiguration: async () => ({
        configuration: {
          intent: { parameters: { currency: { identifier: "USD" } } },
        },
        fields: [{ key: "currency", label: "Currency", type: "entity" }],
      }),
      configurationChoices: async (
        _key: string,
        _term: string,
        options: { signal: AbortSignal },
      ) => {
        options.signal.throwIfAborted();
        return [];
      },
      applyConfiguration: async () => {
        assert.fail("Interrupted editor must not write");
      },
    }) as never;
  assert.equal(await runCli([], environment.runtime), 130);
  assert.deepEqual(environment.calls, ["prepare", "release"]);
  assert.match(environment.stderr(), /Cancelled/);
});

test("every failed mutation releases even when its error code cannot identify a submitted write", async () => {
  for (const code of ["UNSUPPORTED_RUNTIME", "IDENTITY_MISMATCH"] as const) {
    const environment = session(["configure", udid, icon, "catalog", "$exit"]);
    const basePrompts = environment.runtime.prompts!;
    let confirmations = 0;
    environment.runtime.prompts = async (signal) => ({
      ...(await basePrompts(signal)),
      confirm: async () => {
        confirmations++;
        return true;
      },
    });
    environment.runtime.read = async () => '{"intent":{"parameters":{}}}';
    environment.controller.installedWidgets = async () =>
      [
        {
          target: {
            container: "app",
            extension: "app.widget",
            kind: "rates",
            size: "small",
            iconIdentifier: icon,
          },
        },
      ] as never;
    environment.controller.getWidget = async () =>
      ({
        applyConfiguration: async () => {
          environment.calls.push("apply submitted");
          throw new WidgetctlError("Failure after native submission", { code });
        },
      }) as never;
    assert.equal(await runCli([], environment.runtime), 0);
    assert.deepEqual(environment.calls, [
      "prepare",
      "apply submitted",
      "release",
      "prepare",
      "release",
    ]);
    assert.equal(confirmations, 1);
    assert.match(environment.stderr(), /Failure after native submission/);
  }
});

test("raw terminal prompt interruption exits the session and releases its prepared helper", async () => {
  for (const name of ["ExitPromptError", "AbortPromptError"]) {
    const interruption = new Error("User interrupted an active picker");
    interruption.name = name;
    const environment = session([
      "add",
      udid,
      () => {
        throw interruption;
      },
      "$exit",
    ]);
    const catalog = environment.controller.catalog;
    environment.controller.catalog = async () => {
      const result = await catalog();
      return {
        apps: [
          result.apps[0]!,
          {
            ...result.apps[0]!,
            name: "Another app",
            bundleIdentifier: "another.app",
          },
        ],
      };
    };
    assert.equal(await runCli([], environment.runtime), 130);
    assert.deepEqual(environment.calls, ["prepare", "release"]);
    assert.deepEqual(environment.selections, ["$exit"]);
    assert.match(environment.stderr(), /Cancelled/);
    assert.doesNotMatch(environment.stderr(), /Action cancelled/);
  }
});

test("primary menu is compact and More keeps secondary actions reachable", async () => {
  const menus: string[][] = [];
  const environment = session([
    (choices) => {
      menus.push(choices.map((choice) => choice.name));
      return "$more";
    },
    (choices) => {
      menus.push(choices.map((choice) => choice.name));
      return "$back";
    },
    "$exit",
  ]);
  assert.equal(await runCli(["--device", udid], environment.runtime), 0);
  assert.equal(menus[0]!.length, 6);
  assert.ok(menus[1]!.includes("Widget details"));
  assert.ok(menus[1]!.includes("Diagnostics"));
  assert.match(environment.stdout(), /Phone · iOS 26.0/);
  assert.doesNotMatch(environment.stdout(), /helper|No simulator|208E/);
  assert.deepEqual(environment.calls, []);
});

test("human widget list uses names and locations without preparing a worker", async () => {
  const environment = setup();
  environment.controller.installedWidgets = async () =>
    [1, 2].map((page) => ({
      name: "Rates",
      target: {
        container: "app",
        extension: "app.widget",
        kind: "internal-rates",
        size: "small",
        iconIdentifier: page === 1 ? icon : udid,
      },
      widgetIdentifier: String(page),
      position: { page: page - 1, index: 0 },
    })) as never;
  assert.equal(
    await runCli(["list", "--device", udid], environment.runtime),
    0,
  );
  assert.match(
    environment.stdout(),
    /Example · Rates · Small · Page 1, item 1/,
  );
  assert.match(environment.stdout(), /Page 2, item 1/);
  assert.doesNotMatch(environment.stdout(), /internal-rates|F08E|app.widget/);
  assert.deepEqual(environment.calls, []);
});

test("details are explicit and read only", async () => {
  const environment = session(["$more", "$details", udid, icon, "$exit"]);
  environment.controller.installedWidgets = async () =>
    [
      {
        name: "Rates",
        target: {
          container: "app",
          extension: "app.widget",
          kind: "rates",
          size: "small",
          iconIdentifier: icon,
        },
        widgetIdentifier: "saved",
      },
    ] as never;
  assert.equal(await runCli([], environment.runtime), 0);
  assert.match(environment.stdout(), /Widget: F08E6530/);
  assert.match(environment.stdout(), /Extension: app.widget/);
  assert.deepEqual(environment.calls, []);
});

test("declining combined start consent never boots or prepares", async () => {
  const environment = setup({
    isTTY: true,
    devices: async () => [
      { udid, name: "Phone", runtime: "26.0", state: "shutdown" },
    ],
    boot: async () => assert.fail("must not boot"),
    prompts: async () => ({
      select: async () => udid as never,
      confirm: async () => false,
      input: async () => "",
      editor: async () => "",
    }),
  });
  assert.equal(await runCli(["catalog"], environment.runtime), 130);
  assert.deepEqual(environment.calls, []);
});

test("persistent errors stay concise while full details remain reachable without retry", async () => {
  const message = `Lookup failed ${"technical detail ".repeat(30)}`;
  const environment = session(["catalog", udid, "$more", "$error", "$exit"]);
  let attempts = 0;
  environment.controller.catalog = async () => {
    attempts++;
    throw new WidgetctlError(message, { code: "QUERY_FAILED" });
  };
  assert.equal(await runCli([], environment.runtime), 0);
  assert.equal(attempts, 1);
  assert.match(environment.stderr(), /Last error details/);
  assert.ok(!environment.stderr().includes(message));
  assert.ok(environment.stdout().includes(message));
});

test("friendly catalog labels never block exact widget actions on recoverable metadata failure", async () => {
  const environment = setup({
    isTTY: true,
    prompts: async () => ({
      select: async () => assert.fail("exact widget must not prompt"),
      confirm: async () => true,
      input: async () => "",
      editor: async () => "",
    }),
  });
  environment.controller.catalog = async () => {
    throw new WidgetctlError("Unrelated descriptor invalid", {
      code: "QUERY_FAILED",
    });
  };
  assert.equal(
    await runCli(
      ["remove", "--device", udid, "--widget", icon],
      environment.runtime,
    ),
    0,
  );
  assert.deepEqual(environment.calls, ["prepare", "remove", "release"]);
});

test("friendly name discovery still propagates ownership loss before an exact write", async () => {
  const environment = setup({
    isTTY: true,
    prompts: async () => ({
      select: async () => assert.fail("exact widget must not prompt"),
      confirm: async () => true,
      input: async () => "",
      editor: async () => "",
    }),
  });
  environment.controller.catalog = async () => {
    throw new WidgetctlError("Ownership lost", { code: "OWNERSHIP_LOST" });
  };
  assert.equal(
    await runCli(
      ["remove", "--device", udid, "--widget", icon],
      environment.runtime,
    ),
    1,
  );
  assert.deepEqual(environment.calls, ["prepare", "release"]);
});
