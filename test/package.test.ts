import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
test("packed package installs without optional Playwright and exposes API, CLI and native source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "widgetctl-package-"));
  try {
    const { stdout } = await execute(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
      { cwd: root, timeout: 30000 },
    );
    const packed = JSON.parse(stdout)[0];
    const files = packed.files.map((file: { path: string }) => file.path);
    for (const expected of [
      "LICENSE",
      "native/worker.m",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/cli.js",
      "dist/playwright.js",
    ])
      assert.ok(files.includes(expected), expected);
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await execute(
      "npm",
      [
        "install",
        "--omit=dev",
        "--ignore-scripts",
        "--offline",
        join(directory, packed.filename),
      ],
      { cwd: directory, timeout: 60000 },
    );
    const imported = await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { createWidgetController } from 'widgetctl'; import { createRequire } from 'node:module'; console.log(typeof createWidgetController); try { createRequire(import.meta.url).resolve('@playwright/test'); process.exitCode=1; } catch(error) { if(error.code!=='MODULE_NOT_FOUND') throw error; }`,
      ],
      { cwd: directory },
    );
    assert.equal(imported.stdout.trim(), "function");
    const cli = await execute(
      process.execPath,
      [join(directory, "node_modules/.bin/widgetctl"), "--help"],
      { cwd: directory },
    );
    assert.match(cli.stdout, /iOS Simulator widget testing helper/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
