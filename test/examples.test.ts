import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const script = new URL("../examples/cli.sh", import.meta.url).pathname;
for (const existing of [false, true]) {
  test(`CLI example ${existing ? "targets an existing icon" : "captures the added exact icon"} with automatic lifecycle`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "widgetctl-example-"));
    const log = join(directory, "calls.jsonl");
    try {
      await writeFile(
        join(directory, "npx"),
        `#!/usr/bin/env node\nimport('node:fs').then(fs => { const args = process.argv.slice(2); fs.appendFileSync(process.env.EXAMPLE_LOG, JSON.stringify(args)+'\\n'); console.log(JSON.stringify({ schemaVersion: 1, status: args[1] === 'add' ? 'verified' : 'configuration_applied', iconIdentifier: 'exact-icon' })); });\n`,
        { mode: 0o700 },
      );
      await execute("bash", [script], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          EXAMPLE_LOG: log,
          SIMULATOR_UDID: "owned-device",
          CONFIGURATION_FILE: join(directory, "widget.json"),
          WIDGET_EXTENSION: existing ? "" : "app.widget",
          WIDGET_KIND: existing ? "" : "rates",
          WIDGET_SIZE: existing ? "" : "medium",
          WIDGET_ICON: existing ? "existing-icon" : "",
        },
      });
      const calls = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      assert.deepEqual(
        calls.map((args) => args[1]),
        existing ? ["export", "configure"] : ["add", "export", "configure"],
      );
      for (const args of calls) {
        assert.ok(args.includes("--json"));
        if (args[1] !== "add")
          assert.equal(
            args[args.indexOf("--widget") + 1],
            existing ? "existing-icon" : "exact-icon",
          );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
