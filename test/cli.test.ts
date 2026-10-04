import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const cli = new URL("../dist/cli.js", import.meta.url);
function invoke(...args: string[]) {
  return spawnSync(process.execPath, [cli.pathname, ...args], {
    encoding: "utf8",
  });
}
test("CLI help and version do not connect to a simulator", () => {
  const help = invoke("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /prepare[\s\S]*configure/);
  assert.equal(invoke("--version").stdout.trim(), "0.1.0");
});
test("CLI rejects missing ownership, unknown options and irrelevant mutation flags", () => {
  for (const args of [
    ["prepare"],
    [
      "inspect",
      "--device",
      "208E6530-2FE7-45F7-9947-E3976A766E41",
      "--widget",
      "invalid",
    ],
    [
      "prepare",
      "--device",
      "208E6530-2FE7-45F7-9947-E3976A766E41",
      "--launch-domain",
      "invalid",
    ],
    ["unknown"],
    ["prepare", "--device", "owned", "--replace"],
    [
      "ensure",
      "--device",
      "owned",
      "--extension",
      "example",
      "--kind",
      "kind",
      "--size",
      "extraLarge",
    ],
    ["release", "--device", "owned", "--file", "unexpected.json"],
    ["prepare", "--device", "owned", "--unknown"],
    [
      "export",
      "--device",
      "owned",
      "--extension",
      "example",
      "--kind",
      "kind",
      "--size",
      "small",
    ],
  ]) {
    const result = invoke(...args);
    assert.equal(result.status, 2, args.join(" "));
    assert.equal(JSON.parse(result.stdout).schemaVersion, 1);
    assert.equal(JSON.parse(result.stdout).status, "failed");
    assert.ok(JSON.parse(result.stdout).error);
  }
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
    const invalid = spawnSync(
      process.execPath,
      [executable, "prepare", "--device", "invalid"],
      { encoding: "utf8" },
    );
    assert.equal(invalid.status, 2);
    assert.equal(JSON.parse(invalid.stdout).status, "failed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
