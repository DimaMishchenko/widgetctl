import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, mkdir, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pluginRuntime } from "../scripts/build-plugin.js";
const execute = promisify(execFile);
const handshake = async (server: string, cwd: string) => {
  const { stdout, stderr } = await execute(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import { spawn } from "node:child_process";
      import { createInterface } from "node:readline";
      const child = spawn(process.execPath, [process.argv[1]], {
        cwd: process.argv[2],
        env: { ...process.env, PATH: "", NODE_PATH: "", NODE_OPTIONS: "" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const pending = new Map();
      let errors = "";
      child.stderr.on("data", (chunk) => errors += chunk);
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          const message = JSON.parse(line);
          const request = pending.get(message.id);
          if (request) { pending.delete(message.id); request.resolve(message); }
        } catch (error) {
          for (const request of pending.values()) request.reject(error);
        }
      });
      child.on("error", (error) => {
        for (const request of pending.values()) request.reject(error);
      });
      child.on("exit", (code) => {
        for (const request of pending.values()) request.reject(new Error("Server exited " + code + ": " + errors));
      });
      const send = (message) => child.stdin.write(JSON.stringify(message) + "\\n");
      const request = (id, method, params) => new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ jsonrpc: "2.0", id, method, params });
      });
      const timer = setTimeout(() => { child.kill(); process.exitCode = 1; }, 15000);
      try {
        const initialized = await request(1, "initialize", {
          protocolVersion: "2025-11-25", capabilities: {},
          clientInfo: { name: "widgetctl-package-test", version: "1.0.0" },
        });
        assert.equal(initialized.error, undefined);
        assert.ok(initialized.result.capabilities.tools);
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        const listed = await request(2, "tools/list", {});
        assert.equal(listed.error, undefined);
        assert.ok(listed.result.tools.length > 0);
        assert.ok(listed.result.tools.every((tool) => tool.name && tool.inputSchema.type === "object"));
        process.stdout.write(JSON.stringify({ server: initialized.result.serverInfo, tools: listed.result.tools }));
        assert.equal(errors, "");
      } finally {
        clearTimeout(timer);
        child.kill();
        lines.close();
      }
    `,
      server,
      cwd,
    ],
    {
      cwd,
      timeout: 20000,
      env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
    },
  );
  assert.equal(stderr, "");
  const protocol = JSON.parse(stdout);
  assert.equal(protocol.server.name, "widgetctl");
  assert.deepEqual(
    protocol.tools.map((tool: { name: string }) => tool.name).sort(),
    [
      "widgetctl_apps",
      "widgetctl_catalog",
      "widgetctl_configuration_apply",
      "widgetctl_configuration_choices",
      "widgetctl_configuration_describe",
      "widgetctl_configuration_export",
      "widgetctl_devices",
      "widgetctl_doctor",
      "widgetctl_ensure",
      "widgetctl_installed",
      "widgetctl_remove",
    ],
  );
  return protocol;
};
const root = new URL("..", import.meta.url);
const json = async (file: string) =>
  JSON.parse(await readFile(new URL(file, root), "utf8"));

test("plugin identities and desktop requirement agree across install channels", async () => {
  const [pkg, portable, claude, codexMarket, claudeMarket] = await Promise.all([
    json("package.json"),
    json("plugin.json"),
    json(".claude-plugin/plugin.json"),
    json(".agents/plugins/marketplace.json"),
    json(".claude-plugin/marketplace.json"),
  ]);
  for (const manifest of [portable, claude]) {
    assert.equal(manifest.name, pkg.name);
    assert.equal(manifest.version, pkg.version);
  }
  assert.equal(portable.extensions["com.openai"].requires_local_executor, true);
  const ui = portable.extensions["com.openai"].interface;
  assert.ok(ui.shortDescription.length <= 30);
  for (const key of ["logo", "composerIcon"]) {
    assert.equal(ui[key], "./assets/plugin-icon.svg");
    assert.match(
      await readFile(new URL(ui[key], root), "utf8"),
      /viewBox="0 0 128 128"/,
    );
  }
  for (const [file, variable] of [
    ["mcp.json", "PLUGIN_ROOT"],
    [".mcp.json", "CLAUDE_PLUGIN_ROOT"],
  ]) {
    const config = await json(file!);
    assert.deepEqual(Object.keys(config.mcpServers), ["widgetctl"]);
    assert.equal(config.mcpServers.widgetctl.type, "stdio");
    assert.equal(config.mcpServers.widgetctl.command, "node");
    assert.deepEqual(config.mcpServers.widgetctl.args, [
      "${" + variable + "}/skills/widgetctl/scripts/mcp.mjs",
    ]);
    assert.equal(config.mcpServers.widgetctl.env, undefined);
    if (file === "mcp.json")
      assert.equal(config.mcpServers.widgetctl.cwd, "${PLUGIN_ROOT}");
  }
  assert.equal(codexMarket.plugins[0].source.path, "./");
  assert.equal(claudeMarket.plugins[0].source, "./");
  assert.equal(codexMarket.plugins[0].name, pkg.name);
  assert.equal(claudeMarket.plugins[0].name, pkg.name);
  assert.equal(codexMarket.plugins[0].policy.installation, "AVAILABLE");
});

test("plugin ZIP is reproducible and includes the standalone runtime without development files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "widgetctl-plugin-"));
  try {
    const script = new URL("scripts/package-plugin.py", root).pathname;
    const { stdout } = await execute("python3", [
      script,
      "--output",
      directory,
    ]);
    const archive = stdout.trim();
    const first = await readFile(archive);
    await execute("python3", [script, "--output", directory]);
    assert.deepEqual(await readFile(archive), first);
    const { stdout: inspected } = await execute("python3", [
      "-c",
      `import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n print(json.dumps({"files":z.namelist(),"skill":z.read("skills/widgetctl/SKILL.md").decode(),"manifest":json.loads(z.read("plugin.json"))}))`,
      archive,
    ]);
    const bundle = JSON.parse(inspected);
    const runtime = await pluginRuntime();
    assert.deepEqual(
      bundle.files.sort(),
      [
        ".agents/plugins/marketplace.json",
        ".claude-plugin/marketplace.json",
        ".claude-plugin/plugin.json",
        "LICENSE",
        "assets/plugin-icon.svg",
        "assets/plugin-icon.png",
        "plugin.json",
        "mcp.json",
        ".mcp.json",
        "skills/widgetctl/SKILL.md",
        "skills/widgetctl/agents/openai.yaml",
        ...[...runtime.keys()].map((name) => `skills/widgetctl/${name}`),
      ].sort(),
    );
    for (const name of bundle.files)
      assert.ok(!/(node_modules|__pycache__|\.local|\.cache)/.test(name));
    assert.equal(
      bundle.skill,
      await readFile(new URL("skills/widgetctl/SKILL.md", root), "utf8"),
    );
    assert.equal(
      bundle.manifest.extensions["com.openai"].requires_local_executor,
      true,
    );
    const extracted = join(directory, "extracted");
    await execute("python3", [
      "-c",
      "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
      archive,
      extracted,
    ]);
    for (const [file, variable] of [
      ["mcp.json", "PLUGIN_ROOT"],
      [".mcp.json", "CLAUDE_PLUGIN_ROOT"],
    ]) {
      const config = JSON.parse(await readFile(join(extracted, file!), "utf8"));
      const script = config.mcpServers.widgetctl.args[0].replace(
        "${" + variable + "}",
        extracted,
      );
      assert.ok((await readFile(script)).length > 0);
      const protocol = await handshake(script, directory);
      assert.equal(
        protocol.server.version,
        (await json("package.json")).version,
      );
    }
    const standalone = join(directory, "standalone-skill");
    await cp(join(extracted, "skills/widgetctl"), standalone, {
      recursive: true,
    });
    const pkg = await json("package.json");
    for (const location of [join(extracted, "skills/widgetctl"), standalone]) {
      const protocol = await handshake(
        join(location, "scripts/mcp.mjs"),
        directory,
      );
      assert.equal(protocol.server.version, pkg.version);
      const cli = join(location, "scripts/widgetctl.mjs");
      const options = {
        cwd: directory,
        env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
        timeout: 30_000,
      };
      const version = await execute(
        process.execPath,
        [cli, "--version"],
        options,
      );
      assert.equal(version.stdout.trim(), pkg.version);
      const help = await execute(process.execPath, [cli, "--help"], options);
      assert.match(help.stdout, /iOS Simulator widget testing helper/);
      let diagnosis;
      try {
        diagnosis = await execute(
          process.execPath,
          [cli, "doctor", "--json"],
          options,
        );
      } catch (error) {
        const failure = error as {
          code: number;
          stdout: string;
          stderr: string;
        };
        assert.equal(failure.code, 1);
        diagnosis = failure;
      }
      const report = JSON.parse(diagnosis.stdout);
      assert.equal(report.schemaVersion, 1);
      assert.ok(Array.isArray(report.checks));
      assert.doesNotMatch(
        diagnosis.stderr,
        /ERR_MODULE_NOT_FOUND|Cannot find module/,
      );
    }
    const { createHash } = await import("node:crypto");
    assert.ok(
      (await readFile(`${archive}.sha256`, "utf8")).startsWith(
        createHash("sha256").update(first).digest("hex"),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tracked plugin runtime matches a fresh deterministic build including licenses and native source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "widgetctl-plugin-build-"));
  try {
    const expected = await pluginRuntime();
    assert.ok(
      [...expected.keys()].some(
        (name) => name.includes("bplist-parser") && name.endsWith("LICENSE"),
      ),
    );
    for (const dependency of [
      "@modelcontextprotocol__core@",
      "@modelcontextprotocol__server@",
      "zod@",
    ])
      assert.ok(
        [...expected.keys()].some(
          (name) =>
            name.startsWith(`licenses/${dependency}`) && /LICENSE/i.test(name),
        ),
      );
    for (const [name, bytes] of expected) {
      const generated = join(directory, name);
      await mkdir(dirname(generated), { recursive: true });
      await writeFile(generated, bytes);
      assert.ok(
        (await readFile(new URL(`skills/widgetctl/${name}`, root))).equals(
          await readFile(generated),
        ),
        `Stale generated ${name}; run npm run build:plugin`,
      );
    }
    const second = await pluginRuntime();
    assert.deepEqual([...second.keys()], [...expected.keys()]);
    for (const [name, bytes] of expected)
      assert.ok(
        Buffer.from(bytes).equals(Buffer.from(second.get(name)!)),
        `Nondeterministic ${name}`,
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
