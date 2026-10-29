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
      "docs/release-checklist.md",
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
    const typecheck = (types?: string) =>
      execute(
        process.execPath,
        [
          join(root, "node_modules/typescript/bin/tsc"),
          "-p",
          config,
          ...(types ? ["--types", types] : []),
        ],
        { cwd: directory },
      );
    await typecheck();
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
    await typecheck("node");
    await execute(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "@playwright/test@1.50.0",
      ],
      npmOptions,
    );
    await typecheck("node");
    await execute(
      process.execPath,
      ["--input-type=module", "--eval", "await import('widgetctl/playwright')"],
      { cwd: directory },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
