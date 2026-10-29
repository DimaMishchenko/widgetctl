import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
test("packed package ships linked docs and supports core and optional Playwright consumers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "widgetctl-package-"));
  const npmOptions = {
    cwd: directory,
    timeout: 120000,
    env: { ...process.env, npm_config_cache: join(directory, "cache") },
  };
  try {
    const { stdout } = await execute(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
      { ...npmOptions, cwd: root },
    );
    const packed = JSON.parse(stdout)[0];
    const files = packed.files.map((file: { path: string }) => file.path);
    for (const expected of [
      "LICENSE",
      "plugin.json",
      ".agents/plugins/marketplace.json",
      ".claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
      "skills/widgetctl/SKILL.md",
      "skills/widgetctl/agents/openai.yaml",
      "docs/assets/usage.gif",
      "docs/agents.md",
      "docs/distribution.md",
      "native/worker.m",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/cli.js",
      "dist/playwright.js",
      "CONTRIBUTING.md",
      "docs/usage.md",
      "examples/README.md",
      "examples/basic.ts",
      "examples/discover.ts",
      "examples/verify-fixtures.ts",
      "examples/configuration.ts",
      "examples/cli.sh",
      "examples/playwright/playwright.config.ts",
      "examples/playwright/widget.spec.ts",
    ])
      assert.ok(files.includes(expected), expected);
    for (const document of files.filter((file: string) =>
      file.endsWith(".md"),
    )) {
      const content = await readFile(join(root, document), "utf8");
      for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1]!.split("#")[0]!;
        if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
        const destination = posix.normalize(
          posix.join(dirname(document), target),
        );
        assert.ok(
          files.includes(destination),
          `${document} links to unpackaged ${destination}`,
        );
      }
    }
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
        "--no-audit",
        "--no-fund",
        join(directory, packed.filename),
      ],
      npmOptions,
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
    const globalPrefix = join(directory, "global");
    await execute(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        globalPrefix,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(directory, packed.filename),
      ],
      npmOptions,
    );
    const globalCli = await execute(
      join(globalPrefix, "bin", "widgetctl"),
      ["--help"],
      { cwd: directory },
    );
    assert.match(globalCli.stdout, /iOS Simulator widget testing helper/);
    const consumer = join(directory, "consumer.ts");
    const config = join(directory, "tsconfig.json");
    await writeFile(
      config,
      JSON.stringify({
        compilerOptions: {
          target: "ES2023",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: [],
        },
        files: ["consumer.ts"],
      }),
    );
    await writeFile(
      consumer,
      `import { createWidgetController, type WidgetConfiguration } from 'widgetctl';
const widgets = createWidgetController({ udid: '00000000-0000-0000-0000-000000000000' });
async function check(): Promise<WidgetConfiguration> {
  await widgets.prepare();
  const widget = await widgets.ensure({ extension: 'example.widgets', kind: 'Example', size: 'small' });
  return widget.exportConfiguration();
}
void check;
`,
    );
    const typecheck = async (
      stage: string,
      types?: string,
      compiler = join(root, "node_modules/typescript/bin/tsc"),
    ) => {
      try {
        await execute(
          process.execPath,
          [compiler, "-p", config, ...(types ? ["--types", types] : [])],
          { cwd: directory },
        );
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string };
        console.error(
          `Consumer typecheck failed (${stage}):\n${failure.stdout ?? ""}${failure.stderr ?? ""}`,
        );
        throw error;
      }
    };
    await typecheck("core");
    const installedVersion = async (name: string) =>
      (
        JSON.parse(
          await readFile(
            join(root, "node_modules", name, "package.json"),
            "utf8",
          ),
        ) as { version: string }
      ).version;
    await execute(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `@playwright/test@${await installedVersion("@playwright/test")}`,
        `@types/node@${await installedVersion("@types/node")}`,
      ],
      npmOptions,
    );
    const playwright = await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { test, expect, widgetFixtures } from 'widgetctl/playwright'; console.log(typeof test, typeof expect, typeof widgetFixtures);`,
      ],
      { cwd: directory },
    );
    assert.equal(playwright.stdout.trim(), "function function object");
    await writeFile(
      consumer,
      `import { test as base } from '@playwright/test';
import { test, expect, widgetFixtures, type WidgetWorkerFixtures } from 'widgetctl/playwright';
test.use({ widgetctlOptions: { udid: '00000000-0000-0000-0000-000000000000' } });
test('configuration', async ({ widgets }) => {
  const widget = await widgets.ensure({ extension: 'example.widgets', kind: 'Example', size: 'small' });
  expect((await widget.exportConfiguration()).intent.parameters).toBeDefined();
});
const combined = base.extend<{}, WidgetWorkerFixtures>(widgetFixtures);
combined.use({ widgetctlOptions: { udid: '00000000-0000-0000-0000-000000000000' } });
`,
    );
    await typecheck("current Playwright", "node");
    await execute(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "@playwright/test@1.50.0",
        "typescript@5.9.3",
        "@types/node@22.19.0",
      ],
      npmOptions,
    );
    const legacyCompiler = join(directory, "node_modules/typescript/bin/tsc");
    const legacyVersion = await execute(process.execPath, [
      legacyCompiler,
      "--version",
    ]);
    assert.equal(legacyVersion.stdout.trim(), "Version 5.9.3");
    await typecheck(
      "Playwright 1.50 with TypeScript 5.9",
      "node",
      legacyCompiler,
    );
    await execute(
      process.execPath,
      ["--input-type=module", "--eval", "await import('widgetctl/playwright')"],
      { cwd: directory },
    );
    const events = join(directory, "legacy-events.jsonl");
    await writeFile(
      join(directory, "playwright.config.cjs"),
      `module.exports = { testDir: '.', testMatch: 'legacy.spec.cjs', workers: 1, reporter: 'line' };`,
    );
    await writeFile(
      join(directory, "legacy.spec.cjs"),
      `const { test: base, expect } = require('@playwright/test');
const { createWidgetFixtures } = require(${JSON.stringify(join(directory, "node_modules/widgetctl/dist/playwright-fixtures.js"))});
const { appendFileSync } = require('node:fs');
const event = (mode) => appendFileSync(${JSON.stringify(events)}, JSON.stringify(mode) + '\\n');
const test = base.extend(createWidgetFixtures(options => ({
  udid: options.udid,
  prepare: async () => { event('prepare'); return { status: 'ready' }; },
  release: async () => { event('release'); return { status: 'unloaded' }; },
}))).extend({ driver: async ({}, use) => {
  event('driver-connect'); await use({}); event('driver-close');
} });
test.use({ widgetctlOptions: { udid: 'explicit-owned-device' } });
test('legacy worker lifecycle', async ({ driver, widgets }) => {
  event('test'); expect(widgets.udid).toBe('explicit-owned-device'); expect(driver).toEqual({});
});
`,
    );
    await execute(
      process.execPath,
      [
        join(directory, "node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        join(directory, "playwright.config.cjs"),
      ],
      { cwd: directory, timeout: 30000 },
    );
    assert.deepEqual(
      (await readFile(events, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
      ["prepare", "driver-connect", "test", "driver-close", "release"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
