import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evidenceTag,
  publishArgs,
  validateEvidence,
  validateRegistryIntegrity,
  validateVersion,
} from "../scripts/release.js";

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const commit = "a".repeat(40);
const digest = "b".repeat(64);
const report = {
  version: "0.2.0",
  commit,
  tarball: { sha256: digest },
  native: {
    status: "passed",
    rendered: "Edited and restored screenshots inspected",
  },
};

test("release versions are explicit, stable and agree across manifests", () => {
  validateVersion("0.2.0", [{ version: "0.2.0" }]);
  for (const version of ["v0.2.0", "0.2.0-beta.1", "00.2.0", "$(whoami)"])
    assert.throws(() => validateVersion(version, []));
  assert.throws(() => validateVersion("0.2.0", [{ version: "0.1.0" }]));
});

test("evidence can only come from the same repository and version release asset", () => {
  const expected =
    "https://github.com/owner/repo/releases/download/v0.2.0/acceptance.json";
  assert.equal(evidenceTag(expected, "owner/repo", "0.2.0"), "v0.2.0");
  for (const url of [
    expected + "?redirect=1",
    expected.replace("owner", "other"),
    expected.replace("0.2.0", "0.1.0"),
    "http://127.0.0.1/acceptance.json",
  ])
    assert.throws(() => evidenceTag(url, "owner/repo", "0.2.0"));
});

test("native acceptance binds the published bytes to the release commit", () => {
  validateEvidence(report, "0.2.0", commit, digest);
  for (const changed of [
    { ...report, version: "0.1.0" },
    { ...report, commit: "c".repeat(40) },
    { ...report, tarball: { sha256: "d".repeat(64) } },
    { ...report, native: { ...report.native, status: "skipped" } },
    { ...report, native: { status: "passed", rendered: " " } },
    {},
  ])
    assert.throws(() => validateEvidence(changed, "0.2.0", commit, digest));
});

test("public npm integrity must match the exact verified tarball", () => {
  validateRegistryIntegrity("sha512-expected", "sha512-expected");
  assert.throws(() =>
    validateRegistryIntegrity("sha512-other", "sha512-expected"),
  );
});

test("publication arguments always use an absolute local tarball path", () => {
  const args = publishArgs("0.2.0", "/tmp/release-fixture");
  assert.deepEqual(args, [
    "publish",
    "/tmp/release-fixture/release/widgetctl-0.2.0.tgz",
    "--access",
    "public",
    "--provenance",
  ]);
  assert.ok(isAbsolute(args[1]!));
  assert.throws(() => publishArgs("../../other"));
});

test("release preview publishes a tiny local tarball in dry run mode without network or credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "widgetctl-release-preview-"));
  try {
    await mkdir(join(directory, "release"));
    await mkdir(join(directory, ".claude-plugin"));
    const manifest = {
      name: "widgetctl",
      version: "0.2.0",
      files: ["index.js"],
    };
    for (const name of [
      "package.json",
      "plugin.json",
      ".claude-plugin/plugin.json",
    ])
      await writeFile(join(directory, name), JSON.stringify(manifest));
    await writeFile(
      join(directory, "package-lock.json"),
      JSON.stringify({
        version: "0.2.0",
        packages: { "": { version: "0.2.0" } },
      }),
    );
    await writeFile(
      join(directory, "index.js"),
      "export const fixture = true;\n",
    );
    const env = {
      ...process.env,
      npm_config_cache: join(directory, "cache"),
      npm_config_offline: "true",
      npm_config_userconfig: join(directory, "empty-user.npmrc"),
      npm_config_globalconfig: join(directory, "empty-global.npmrc"),
      npm_config_registry: "http://127.0.0.1:9",
      NODE_AUTH_TOKEN: "",
      NPM_TOKEN: "",
    };
    await execute(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", "release"],
      { cwd: directory, env, timeout: 30_000 },
    );
    const script = fileURLToPath(
      new URL("../scripts/release.ts", import.meta.url),
    );
    const preview = await execute(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        script,
        "preview",
        "0.2.0",
        "owner/repo",
        commit,
      ],
      { cwd: directory, env, timeout: 30_000 },
    );
    assert.match(preview.stdout, /\+ widgetctl@0\.2\.0/);
    assert.match(preview.stderr, /dry-run/);
    assert.doesNotMatch(preview.stderr, /git ls-remote|git\+ssh|ERR!/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
