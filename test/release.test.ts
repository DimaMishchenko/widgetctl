import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evidenceTag,
  validateEvidence,
  validateRegistryIntegrity,
  validateVersion,
} from "../scripts/release.js";

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
