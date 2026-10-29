import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
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
  assert.equal(codexMarket.plugins[0].source.path, "./");
  assert.equal(claudeMarket.plugins[0].source, "./");
  assert.equal(codexMarket.plugins[0].name, pkg.name);
  assert.equal(claudeMarket.plugins[0].name, pkg.name);
  assert.equal(codexMarket.plugins[0].policy.installation, "AVAILABLE");
});

test("plugin ZIP is reproducible, self-contained and excludes the CLI and local evidence", async () => {
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
    assert.deepEqual(
      bundle.files.sort(),
      [
        ".agents/plugins/marketplace.json",
        ".claude-plugin/marketplace.json",
        ".claude-plugin/plugin.json",
        "LICENSE",
        "plugin.json",
        "skills/widgetctl/SKILL.md",
        "skills/widgetctl/agents/openai.yaml",
      ].sort(),
    );
    assert.equal(
      bundle.skill,
      await readFile(new URL("skills/widgetctl/SKILL.md", root), "utf8"),
    );
    assert.equal(
      bundle.manifest.extensions["com.openai"].requires_local_executor,
      true,
    );
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
