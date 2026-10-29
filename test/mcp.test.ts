import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  InMemoryTransport,
  PROTOCOL_VERSION_META_KEY,
  CLIENT_INFO_META_KEY,
  CLIENT_CAPABILITIES_META_KEY,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { createMcpServer, type McpDependencies } from "../src/mcp.js";
import { WidgetctlError } from "../src/errors.js";
import type {
  WidgetController,
  WidgetHandle,
  WidgetConfiguration,
} from "../src/controller.js";

const udid = "11111111-1111-4111-8111-111111111111";
const iconIdentifier = "22222222-2222-4222-8222-222222222222";
const target = {
  extension: "example.widgets",
  container: "example",
  kind: "Example",
  size: "small" as const,
  iconIdentifier,
};
const configuration: WidgetConfiguration = {
  schemaVersion: 1,
  ...target,
  intent: {
    intentClass: "INAppIntent",
    appBundleIdentifier: "example",
    extensionBundleIdentifier: "example.widgets",
    appIntentIdentifier: "Settings",
    parameters: { value: 3 },
  },
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fake(
  events: string[],
  overrides: Partial<WidgetController> = {},
  handleOverrides: Partial<WidgetHandle> = {},
): WidgetController {
  const backend = async (name: string) => {
    events.push(name);
    return { status: name };
  };
  const handle: WidgetHandle = {
    target,
    iconIdentifier,
    reveal: () => backend("reveal"),
    parameters: async () => configuration.intent.parameters,
    updateConfiguration: async () => configuration,
    describeConfiguration: async () => {
      events.push("describe");
      return { schemaVersion: 1, fields: [] } as never;
    },
    configurationChoices: async () => {
      events.push("choices");
      return [{ label: "three", value: 3 }];
    },
    exportConfiguration: async () => {
      events.push("export");
      return configuration;
    },
    applyConfiguration: async (value, options) => {
      events.push("apply");
      assert.deepEqual(options?.expected, configuration);
      return value;
    },
    remove: () => backend("remove"),
    ...handleOverrides,
  };
  return {
    udid,
    prepare: () => backend("prepare"),
    release: () => backend("release"),
    catalog: async () => {
      events.push("catalog");
      return { apps: [] };
    },
    installedWidgets: async () => {
      events.push("installed");
      return [{ target, widgetIdentifier: "widget" }];
    },
    getWidget: async (icon) => {
      events.push("getWidget");
      assert.equal(icon, iconIdentifier);
      return handle;
    },
    inspect: () => backend("inspect"),
    ensure: async () => {
      events.push("ensure");
      return handle;
    },
    exportConfiguration: async () => configuration,
    applyConfiguration: async () => configuration,
    ...overrides,
  };
}
async function connected(overrides: Partial<McpDependencies> = {}) {
  const app = createMcpServer(overrides);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await app.server.connect(serverTransport);
  const client = new Client({ name: "widgetctl-test", version: "1" });
  await client.connect(clientTransport);
  return {
    ...app,
    client,
    async close() {
      await app.shutdown();
      await client.close();
      await app.server.close();
    },
  };
}
function payload(result: Awaited<ReturnType<Client["callTool"]>>) {
  return result.structuredContent as {
    ok: boolean;
    data?: unknown;
    error?: { code: string; recovery: string[] };
  };
}

test("stdio SDK client lists concrete tools without accessing simulator tooling", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/mcp.js"],
    env: { PATH: "" },
    stderr: "pipe",
  });
  let diagnostics = "";
  transport.stderr?.on("data", (data) => (diagnostics += data));
  const client = new Client(
    { name: "stdio-test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await client.connect(transport);
    assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");
    const { tools } = await client.listTools();
    assert.equal(tools.length, 11);
    const apply = tools.find(
      (tool) => tool.name === "widgetctl_configuration_apply",
    )!;
    assert.equal(apply.inputSchema.additionalProperties, false);
    assert.deepEqual(apply.inputSchema.required, [
      "udid",
      "iconIdentifier",
      "configuration",
      "expected",
    ]);
    assert.equal(apply.annotations?.destructiveHint, true);
    assert.match(JSON.stringify(apply.inputSchema.properties), /schemaVersion/);
    assert.equal(diagnostics, "");
    const invalid = await client.callTool({
      name: "widgetctl_remove",
      arguments: { udid: "booted", iconIdentifier },
    });
    assert.equal(invalid.isError, true);
    assert.equal(payload(invalid).error?.code, "INVALID_INPUT");
  } finally {
    await client.close();
  }
});

test("MCP help, version and unknown arguments exit without simulator access", async () => {
  const run = promisify(execFile);
  const help = await run(process.execPath, ["dist/mcp.js", "--help"], {
    env: { PATH: "" },
  });
  assert.match(help.stdout, /Usage: widgetctl-mcp/);
  assert.equal(help.stderr, "");
  const version = await run(process.execPath, ["dist/mcp.js", "--version"], {
    env: { PATH: "" },
  });
  assert.equal(version.stdout.trim(), "0.2.0");
  await assert.rejects(
    run(process.execPath, ["dist/mcp.js", "--device", udid], {
      env: { PATH: "" },
    }),
    (error: unknown) => {
      const failure = error as { stdout: string; stderr: string };
      assert.equal(failure.stdout, "");
      assert.match(failure.stderr, /INVALID_INPUT/);
      return true;
    },
  );
});

test("strict schemas reject extra arguments, missing expected and nonfinite JSON before creating controllers", async () => {
  let calls = 0;
  const app = await connected({
    createController: () => {
      calls++;
      throw Error("unexpected simulator access");
    },
  });
  try {
    for (const [name, args] of [
      ["widgetctl_devices", { unexpected: true }],
      ["widgetctl_remove", { udid, iconIdentifier, exclusive: true }],
      ["widgetctl_ensure", { udid, target, replace: true }],
      [
        "widgetctl_configuration_apply",
        { udid, iconIdentifier, configuration },
      ],
      [
        "widgetctl_configuration_apply",
        {
          udid,
          iconIdentifier,
          configuration: {
            ...configuration,
            intent: {
              ...configuration.intent,
              parameters: { value: Infinity },
            },
          },
          expected: configuration,
        },
      ],
    ] as const) {
      const result = await app.client.callTool({ name, arguments: args });
      assert.equal(result.isError, true);
      assert.equal(payload(result).error?.code, "INVALID_INPUT");
    }
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});

test("tools use direct controller handles and release for every prepared operation", async () => {
  const events: string[] = [];
  const app = await connected({
    createController: ({ udid: requested }) => {
      assert.equal(requested, udid);
      return fake(events);
    },
    listSimulators: async () => [],
    listApplications: async () => [],
    doctor: async () => ({ schemaVersion: 1, healthy: true, checks: [] }),
  });
  try {
    for (const name of [
      "catalog",
      "installed",
      "configuration_describe",
      "configuration_export",
      "configuration_choices",
      "configuration_apply",
      "remove",
      "ensure",
    ]) {
      const args =
        name === "ensure"
          ? {
              udid,
              target: {
                extension: target.extension,
                container: target.container,
                kind: target.kind,
                size: target.size,
              },
            }
          : {
              udid,
              ...(name.startsWith("configuration_") || name === "remove"
                ? { iconIdentifier }
                : {}),
              ...(name === "configuration_choices" ? { key: "value" } : {}),
              ...(name === "configuration_apply"
                ? { configuration, expected: configuration }
                : {}),
            };
      const response = await app.client.callTool({
        name: `widgetctl_${name}`,
        arguments: args,
      });
      assert.equal(response.isError, undefined, JSON.stringify(response));
      assert.equal(payload(response).ok, true);
    }
    assert.equal(events.filter((event) => event === "prepare").length, 8);
    assert.equal(events.filter((event) => event === "release").length, 8);
    assert.equal(events.filter((event) => event === "getWidget").length, 5);
    for (const name of ["devices", "apps", "doctor"])
      assert.equal(
        payload(
          await app.client.callTool({
            name: `widgetctl_${name}`,
            arguments: name === "devices" ? {} : { udid },
          }),
        ).ok,
        true,
      );
    assert.equal(events.filter((event) => event === "prepare").length, 8);
  } finally {
    await app.close();
  }
});

test("prepare and operation failures release; cleanup failures have a stable actionable code", async () => {
  for (const phase of ["prepare", "catalog", "release"] as const) {
    const events: string[] = [];
    const app = await connected({
      createController: () =>
        fake(events, {
          [phase]: async () => {
            events.push(phase);
            throw new WidgetctlError("busy", { code: "DEVICE_BUSY" });
          },
        }),
    });
    try {
      const response = await app.client.callTool({
        name: "widgetctl_catalog",
        arguments: { udid },
      });
      assert.equal(response.isError, true);
      assert.equal(
        payload(response).error?.code,
        phase === "release" ? "CLEANUP_FAILED" : "DEVICE_BUSY",
      );
      assert.ok(payload(response).error!.recovery.length > 0);
      assert.equal(events.at(-1), "release");
    } finally {
      await app.close();
    }
  }
});

test("requests serialize through cleanup even across simulator UDIDs", async () => {
  const entered = deferred(),
    finish = deferred(),
    events: string[] = [];
  let count = 0;
  const app = await connected({
    createController: () =>
      fake(
        events,
        ++count === 1
          ? {
              release: async () => {
                events.push("release-start");
                entered.resolve();
                await finish.promise;
                events.push("release-end");
                return { status: "unloaded" };
              },
            }
          : {},
      ),
  });
  try {
    const first = app.client.callTool({
      name: "widgetctl_catalog",
      arguments: { udid },
    });
    await entered.promise;
    const second = app.client.callTool({
      name: "widgetctl_catalog",
      arguments: { udid: "33333333-3333-4333-8333-333333333333" },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(count, 1);
    finish.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(events, [
      "prepare",
      "catalog",
      "release-start",
      "release-end",
      "prepare",
      "catalog",
      "release",
    ]);
  } finally {
    finish.resolve();
    await app.close();
  }
});

test("cancellation after prepare prevents mutations and still releases", async () => {
  const entered = deferred(),
    finish = deferred(),
    released = deferred(),
    events: string[] = [];
  const app = await connected({
    createController: () =>
      fake(events, {
        prepare: async () => {
          events.push("prepare");
          entered.resolve();
          await finish.promise;
          return { status: "ready" };
        },
        release: async () => {
          events.push("release");
          released.resolve();
          return { status: "unloaded" };
        },
      }),
  });
  const cancellation = new AbortController();
  try {
    const pending = app.client.callTool(
      { name: "widgetctl_remove", arguments: { udid, iconIdentifier } },
      { signal: cancellation.signal },
    );
    const rejected = assert.rejects(pending);
    await entered.promise;
    cancellation.abort();
    await new Promise((resolve) => setImmediate(resolve));
    finish.resolve();
    await rejected;
    await released.promise;
    assert.deepEqual(events, ["prepare", "release"]);
  } finally {
    finish.resolve();
    await app.close();
  }
});

test("shutdown drains active mutations and cleanup, rejects queued work and new requests", async () => {
  const entered = deferred(),
    finish = deferred(),
    releaseEntered = deferred(),
    releaseFinish = deferred(),
    events: string[] = [];
  let calls = 0;
  const app = await connected({
    createController: () => {
      calls++;
      return fake(
        events,
        {
          release: async () => {
            events.push("release");
            releaseEntered.resolve();
            await releaseFinish.promise;
            return { status: "unloaded" };
          },
        },
        {
          remove: async () => {
            events.push("remove");
            entered.resolve();
            await finish.promise;
            return { status: "removed" };
          },
        },
      );
    },
  });
  try {
    const active = app.client.callTool({
      name: "widgetctl_remove",
      arguments: { udid, iconIdentifier },
    });
    await entered.promise;
    const queued = app.client.callTool({
      name: "widgetctl_catalog",
      arguments: { udid },
    });
    await new Promise((resolve) => setImmediate(resolve));
    let drained = false;
    const shutdown = app.shutdown().then(() => {
      drained = true;
    });
    finish.resolve();
    await releaseEntered.promise;
    assert.equal(drained, false);
    releaseFinish.resolve();
    await shutdown;
    assert.equal(calls, 1);
    assert.equal(payload(await active).ok, true);
    assert.equal(payload(await queued).error?.code, "CANCELLED");
    assert.equal(
      payload(
        await app.client.callTool({
          name: "widgetctl_catalog",
          arguments: { udid },
        }),
      ).error?.code,
      "CANCELLED",
    );
    assert.deepEqual(events, ["prepare", "getWidget", "remove", "release"]);
  } finally {
    finish.resolve();
    releaseFinish.resolve();
    await app.close();
  }
});

test("configuration protocol preserves unknown envelope and nested parameter fields", async () => {
  const original = {
    ...configuration,
    futureMetadata: { preserved: [1, false, null, { key: "value" }] },
    intent: {
      ...configuration.intent,
      parameters: {
        ...configuration.intent.parameters,
        entity: { identifier: "one", opaque: { token: ["x"] } },
      },
    },
  };
  const edited = structuredClone(original);
  edited.intent.parameters.value = 4;
  let applied = false;
  const app = await connected({
    createController: () =>
      fake(
        [],
        {},
        {
          exportConfiguration: async () => original,
          applyConfiguration: async (value, options) => {
            assert.deepEqual(options?.expected, original);
            assert.deepEqual(value, edited);
            applied = true;
            return value;
          },
        },
      ),
  });
  try {
    const exported = payload(
      await app.client.callTool({
        name: "widgetctl_configuration_export",
        arguments: { udid, iconIdentifier },
      }),
    );
    assert.deepEqual(exported.data, original);
    const response = await app.client.callTool({
      name: "widgetctl_configuration_apply",
      arguments: {
        udid,
        iconIdentifier,
        configuration: edited,
        expected: exported.data,
      },
    });
    assert.equal(payload(response).ok, true);
    assert.deepEqual(payload(response).data, edited);
    assert.equal(applied, true);
  } finally {
    await app.close();
  }
});

test("stale configuration apply surfaces conflict and preserves cleanup", async () => {
  const events: string[] = [];
  const app = await connected({
    createController: () =>
      fake(
        events,
        {},
        {
          applyConfiguration: async () => {
            throw new WidgetctlError("Configuration changed since export", {
              code: "STALE_CONFIGURATION",
            });
          },
        },
      ),
  });
  try {
    const response = await app.client.callTool({
      name: "widgetctl_configuration_apply",
      arguments: {
        udid,
        iconIdentifier,
        configuration,
        expected: configuration,
      },
    });
    assert.equal(response.isError, true);
    assert.equal(payload(response).error?.code, "STALE_CONFIGURATION");
    assert.deepEqual(events, ["prepare", "getWidget", "release"]);
  } finally {
    await app.close();
  }
});

test("stdio EOF and signals drain active mutation and release before process exit", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const temporary = await mkdtemp(join(tmpdir(), "widgetctl-mcp-lifetime-"));
  try {
    for (const ending of ["EOF", "SIGINT", "SIGTERM"] as const) {
      const evidence = join(temporary, `${ending}.jsonl`);
      const source = join(temporary, `${ending}.mjs`);
      await writeFile(
        source,
        `import {runMcp} from ${JSON.stringify(pathToFileURL(resolve("dist/mcp.js")).href)};
import {appendFileSync} from 'node:fs';
const log = (event) => appendFileSync(${JSON.stringify(evidence)}, JSON.stringify(event)+'\\n');
const delay = () => new Promise((resolve) => setTimeout(resolve, 100));
await runMcp([], {createController: () => ({
prepare: async () => {log('prepare'); return {status:'ready'};},
getWidget: async () => ({remove: async () => { log('mutation-start'); process.stderr.write('mutation-start\\n'); await delay(); log('mutation-end'); return {status:'removed'};}}),
release: async () => {log('release-start'); await delay(); log('release-end'); return {status:'unloaded'};}
})});`,
      );
      const child = spawn(process.execPath, [source], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exited = once(child, "exit");
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      const started = deferred();
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.includes("mutation-start")) started.resolve();
      });
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5000);
      try {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-11-25",
              capabilities: {},
              clientInfo: { name: "lifetime", version: "1" },
            },
          }) + "\n",
        );
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }) + "\n",
        );
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "widgetctl_remove",
              arguments: { udid, iconIdentifier },
            },
          }) + "\n",
        );
        await Promise.race([
          started.promise,
          exited.then(() => {
            throw Error(`Child exited before mutation: ${stderr}`);
          }),
        ]);
        if (ending === "EOF") child.stdin.end();
        else child.kill(ending);
        const [code, signal] = await exited;
        assert.equal(code, 0, `${ending}: ${stderr}`);
        assert.equal(signal, null);
        const events = (await readFile(evidence, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.deepEqual(events, [
          "prepare",
          "mutation-start",
          "mutation-end",
          "release-start",
          "release-end",
        ]);
        for (const line of stdout.trim().split("\n"))
          assert.equal(JSON.parse(line).jsonrpc, "2.0");
      } finally {
        clearTimeout(timeout);
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test(
  "modern discovery probe may fall back to legacy initialize on the same stdio connection",
  { timeout: 5000 },
  async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/mcp.js"],
      env: { PATH: "" },
      stderr: "pipe",
    });
    const waiting = new Map<number, (message: JSONRPCMessage) => void>();
    transport.onmessage = (message) => {
      if ("id" in message && typeof message.id === "number")
        waiting.get(message.id)?.(message);
    };
    async function request(
      id: number,
      method: string,
      params?: Record<string, unknown>,
    ) {
      const response = new Promise<JSONRPCMessage>((resolve) =>
        waiting.set(id, resolve),
      );
      await transport.send({
        jsonrpc: "2.0",
        id,
        method,
        ...(params ? { params } : {}),
      });
      return response;
    }
    try {
      await transport.start();
      const probe = await request(1, "server/discover", {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
          [CLIENT_INFO_META_KEY]: { name: "fallback-test", version: "1" },
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      });
      assert.ok("result" in probe, JSON.stringify(probe));
      const initialized = await request(2, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "fallback-test", version: "1" },
      });
      assert.ok("result" in initialized, JSON.stringify(initialized));
      await transport.send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      const listed = await request(3, "tools/list");
      assert.ok("result" in listed);
      assert.equal((listed.result.tools as unknown[]).length, 11);
    } finally {
      await transport.close();
    }
  },
);
