import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
for (const scenario of [
  "success",
  "test-failure",
  "prepare-failure",
  "collision",
] as const) {
  test(`real Playwright worker lifecycle: ${scenario}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "widgetctl-playwright-"));
    const events = join(dir, "events.jsonl");
    try {
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ type: "module" }),
      );
      await writeFile(
        join(dir, "playwright.config.cjs"),
        `module.exports={testDir:'.',testMatch:'fixture.spec.ts',workers:${scenario === "collision" ? 2 : 1},reporter:'line'};`,
      );
      await writeFile(
        join(dir, "fixture.spec.ts"),
        `
import { test as base } from ${JSON.stringify(resolve(root, "node_modules/@playwright/test/index.mjs"))};
import { createWidgetFixtures } from ${JSON.stringify(resolve(root, "dist/playwright-fixtures.js"))};
import { appendFileSync } from 'node:fs';
const event = (mode: string) => appendFileSync(${JSON.stringify(events)}, JSON.stringify(mode)+'\\n');
const fixtures = createWidgetFixtures(options => ({udid:options.udid,prepare:async()=>{event('prepare');${scenario === "prepare-failure" ? "throw Error('prepare rejected');" : "return {status:'ready',timings:{}};"}},release:async()=>{event('release');return {status:'unloaded',timings:{}};}} as any));
const test=base.extend(fixtures).extend({driver:async({},use)=>{event('driver-connect');await use({});event('driver-close');}});
test.use({widgetctlOptions:{udid:'EXPLICIT'}});
test('host lifecycle',async({driver,widgets})=>{event('test');${scenario === "test-failure" ? "throw Error('body failed');" : ""}});
`,
      );
      let code = 0;
      let output = "";
      try {
        const result = await exec(
          process.execPath,
          [
            resolve(root, "node_modules/@playwright/test/cli.js"),
            "test",
            "--config",
            join(dir, "playwright.config.cjs"),
          ],
          { cwd: root, timeout: 30000 },
        );
        output = result.stdout + result.stderr;
      } catch (error: any) {
        code = error.code;
        output = error.stdout + error.stderr;
      }
      assert.equal(code === 0, scenario === "success", output);
      const recorded = await readFile(events, "utf8")
        .then((v) =>
          v
            .trim()
            .split("\n")
            .map((v) => JSON.parse(v)),
        )
        .catch(() => []);
      assert.deepEqual(
        recorded,
        scenario === "collision"
          ? []
          : scenario === "prepare-failure"
            ? ["prepare", "release"]
            : ["prepare", "driver-connect", "test", "driver-close", "release"],
        output,
      );
      if (scenario === "collision")
        assert.match(output, /workers: 1 per simulator UDID/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
