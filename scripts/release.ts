import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export function validateVersion(
  version: string,
  manifests: { version: string }[],
) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  for (const manifest of manifests) assert.equal(manifest.version, version);
}

export function publishArgs(version: string, directory = process.cwd()) {
  validateVersion(version, []);
  return [
    "publish",
    resolve(directory, "release", `widgetctl-${version}.tgz`),
    "--access",
    "public",
    "--provenance",
  ];
}

export function evidenceTag(url: string, repository: string, version: string) {
  const expected = `https://github.com/${repository}/releases/download/v${version}/acceptance.json`;
  assert.equal(url, expected, `Evidence URL must be ${expected}`);
  return `v${version}`;
}

export function validateEvidence(
  report: unknown,
  version: string,
  commit: string,
  sha256: string,
) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.match(sha256, /^[a-f0-9]{64}$/);
  assert.ok(report && typeof report === "object");
  const evidence = report as {
    version?: string;
    commit?: string;
    tarball?: { sha256?: string };
    native?: { status?: string; rendered?: string };
  };
  assert.equal(evidence.version, version);
  assert.equal(evidence.commit, commit);
  assert.equal(evidence.tarball?.sha256, sha256);
  assert.equal(evidence.native?.status, "passed");
  assert.ok(
    typeof evidence.native?.rendered === "string" &&
      evidence.native.rendered.trim().length > 0,
    "Native acceptance must describe the inspected rendered outcome",
  );
}

function ghJson(endpoint: string) {
  return JSON.parse(
    execFileSync("gh", ["api", endpoint], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    }),
  );
}

export function validateRegistryIntegrity(actual: string, expected: string) {
  assert.equal(
    actual,
    expected,
    "Published npm bytes do not match the verified tarball",
  );
}

async function main() {
  const [command, version, repository, commit, url] = process.argv.slice(2);
  assert.ok(version && repository && commit);
  validateVersion(
    version,
    [
      "package.json",
      "package-lock.json",
      "plugin.json",
      ".claude-plugin/plugin.json",
    ].map((file) => JSON.parse(readFileSync(file, "utf8"))),
  );
  validateVersion(version, [
    JSON.parse(readFileSync("package-lock.json", "utf8")).packages[""],
  ]);
  if (command === "preview" || command === "publish") {
    const args = publishArgs(version);
    if (command === "preview") args.push("--dry-run");
    execFileSync("npm", args, {
      stdio: "inherit",
      timeout: 180_000,
      killSignal: "SIGKILL",
    });
    return;
  }
  if (command === "source") {
    const repo = ghJson(`repos/${repository}`);
    const head = ghJson(
      `repos/${repository}/commits/${encodeURIComponent(repo.default_branch)}`,
    );
    assert.equal(process.env.GITHUB_REF, `refs/heads/${repo.default_branch}`);
    assert.equal(
      head.sha,
      commit,
      "Release must use current default-branch HEAD",
    );
    if (process.env.RELEASE_DRY_RUN === "true") return;
    evidenceTag(process.env.EVIDENCE_URL ?? "", repository, version);
    const published = spawnSync(
      "npm",
      ["view", `widgetctl@${version}`, "version", "--json"],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.ok(!published.error, "Could not check npm version availability");
    assert.notEqual(
      published.status,
      0,
      "This version is already published to npm",
    );
    let registryError;
    try {
      registryError = JSON.parse(published.stdout).error;
    } catch {
      throw new Error("Could not verify npm version availability");
    }
    assert.equal(registryError?.code, "E404", "npm availability check failed");
    try {
      const tag = execFileSync(
        "git",
        ["rev-parse", `refs/tags/v${version}^{commit}`],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      assert.equal(
        tag,
        commit,
        "Existing release tag targets a different commit",
      );
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 128
      ))
        throw error;
    }
    return;
  }
  if (command === "registry") {
    const expected = `sha512-${createHash("sha512")
      .update(readFileSync(`release/widgetctl-${version}.tgz`))
      .digest("base64")}`;
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const result = spawnSync(
        "npm",
        [
          "view",
          `widgetctl@${version}`,
          "dist.integrity",
          "--json",
          "--registry=https://registry.npmjs.org",
        ],
        {
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      if (result.status === 0 && !result.error) {
        validateRegistryIntegrity(JSON.parse(result.stdout), expected);
        console.log(
          `npm widgetctl@${version} is public with the verified tarball integrity`,
        );
        return;
      }
      console.log("Waiting for npm publication to become public...");
      await delay(Math.min(30_000, Math.max(0, deadline - Date.now())));
    }
    throw new Error(
      "npm publication did not become public within 20 minutes; inspect the registry before retrying or publishing the GitHub release",
    );
  }
  assert.equal(command, "evidence");
  const tag = evidenceTag(url, repository, version);
  const metadata = JSON.parse(
    execFileSync(
      "gh",
      [
        "release",
        "view",
        tag,
        "--repo",
        repository,
        "--json",
        "databaseId,isDraft",
      ],
      {
        encoding: "utf8",
        maxBuffer: 65_536,
        timeout: 30_000,
      },
    ),
  );
  const release = ghJson(`repos/${repository}/releases/${metadata.databaseId}`);
  assert.equal(
    release.draft,
    true,
    "Native evidence must be staged on a draft release",
  );
  const assets = release.assets.filter(
    (asset: { name: string }) => asset.name === "acceptance.json",
  );
  assert.equal(
    assets.length,
    1,
    "Draft release must contain one acceptance.json",
  );
  assert.ok(
    assets[0].size > 0 && assets[0].size <= 65_536,
    "Evidence exceeds 64 KiB",
  );
  const report = execFileSync(
    "gh",
    [
      "api",
      `repos/${repository}/releases/assets/${assets[0].id}`,
      "-H",
      "Accept: application/octet-stream",
    ],
    { maxBuffer: 65_536, timeout: 30_000 },
  );
  const tarball = `release/widgetctl-${version}.tgz`;
  const digest = createHash("sha256")
    .update(readFileSync(tarball))
    .digest("hex");
  validateEvidence(
    JSON.parse(report.toString("utf8")),
    version,
    commit,
    digest,
  );
  writeFileSync("release/acceptance.json", report);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
