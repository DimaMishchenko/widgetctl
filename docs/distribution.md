# Distribution and releases

## Install channels

| Use | Install |
| --- | --- |
| Project CLI and TypeScript API | `npm install --save-dev widgetctl` |
| Global CLI and MCP executable | `npm install --global widgetctl` |
| Playwright fixture | `npm install --save-dev widgetctl @playwright/test` |
| Codex / Claude Code plugin or standalone skill | [Agent setup](agents.md) |

`widgetctl/playwright` is a package import, not a separate npm dependency. Plugins and standalone skills include the runtime; they do not add project dependencies. For reproducibility, pin `widgetctl@0.2.1`, retain your lockfile, and pin plugin sources to `v0.2.1`.

## Directories

Keep one canonical skill and runtime. Directory publication is separate from npm and GitHub releases.

| Directory | Status and next action |
| --- | --- |
| [Tessl](https://tessl.io/registry/skills/github/DimaMishchenko/widgetctl/widgetctl) | Public listing; installation is documented in [agent setup](agents.md#standalone-skill). Update through the GitHub source route. |
| OpenAI | Blocked on local-MCP submission allowlisting. Ask OpenAI Support to route the verified publisher's organization ID to the partner submission team. |
| Anthropic | Directory submission skipped without an eligible paid publisher account. The GitHub marketplace adapter remains available. |
| [skills.sh](https://skills.sh/docs/faq) | Discovery follows real skill installs. No confirmed listing; do not manufacture telemetry or install counts. |
| [SkillsMP](https://skillsmp.com/about) | Independently indexes GitHub skills; indexing is unconfirmed. Its published contact route can be used for discovery questions. |

For OpenAI, publisher verification does not enable local MCP submission. After allowlisting, follow the [desktop-only submission guide](https://developers.openai.com/plugins/deploy/desktop-only) with a **new initial package** containing root `mcp.json`. An existing skills-only submission cannot currently be converted to MCP. Upload the tested plugin ZIP and complete review. Repository marketplace installation does not require directory approval.

Anthropic submission can be revisited through its [publishing guide](https://code.claude.com/docs/en/plugins/publish). First validate the adapter with `claude plugin validate . --strict` and test a clean installation on a local Mac with Xcode. Manifest validation alone does not prove client installation.

## Publish a new version

Use **Actions → Release → Run workflow** on `main`. Keep the source commit unchanged through final acceptance. The workflow tests Linux/macOS on Node 22.14/24, builds npm and plugin artifacts, and uses npm trusted publishing with provenance. No npm write token is stored in GitHub.

1. Align `package.json`, both version entries in `package-lock.json`, `plugin.json` and `.claude-plugin/plugin.json`. Add `docs/releases/VERSION.md` and update documentation pins. Run `npm run build:plugin` after CLI, MCP, native source, dependency or version changes and include the generated skill resources. Independently review changes and release notes, then merge through the required PR checks.
2. Run **Release** for that version with **dry_run = true**. Download `release-artifacts`. Record the exact commit and checksums. Inspect the package file list and production dependency audit. The plugin ZIP must retain its icons, complete skill/runtime, both MCP configurations and licenses.
3. Install the exact tarball in a fresh project. Check CLI help, core ESM imports without Playwright, strict TypeScript types, the optional Playwright import and an isolated global CLI install. Test the extracted plugin through an isolated client; manifest validation alone is insufficient.
4. Run the included [fixture acceptance example](../examples/README.md#reproduce-the-native-acceptance-checks) on an owned simulator with both signed fixture apps. Inspect before/edited/restored screenshots, native choices, stale guards and exact readback. Exercise add/edit/restore/remove through both installed MCP servers (npm and extracted plugin), and check clean shutdown. Confirm cleanup after setup failures and preservation of unrelated widget identities. Record Xcode, runtime/build and architecture; report unsupported outcomes honestly.
5. Create a draft GitHub release named `vVERSION` targeting the exact tested commit. Attach native proof/screenshots and an `acceptance.json` with the following fields. Obtain the hash with `shasum -a 256 widgetctl-VERSION.tgz`.

   ```json
   {
     "version": "VERSION",
     "commit": "FULL_40_CHARACTER_COMMIT_SHA",
     "tarball": { "sha256": "SHA256_OF_THE_TESTED_TARBALL" },
     "native": {
       "status": "passed",
       "rendered": "Describe the rendered checks and restoration actually inspected."
     }
   }
   ```

6. Run **Release** with **dry_run = false** and `native_evidence_url` set to `https://github.com/DimaMishchenko/widgetctl/releases/download/vVERSION/acceptance.json`. The workflow reads draft assets with GitHub authentication, verifies version/commit/artifact hash, creates the immutable tag, publishes npm, compares public integrity, and makes the GitHub release public. A dry run or successful compilation alone does not establish native acceptance.

A newer `main` commit, conflicting tag, existing npm version or mismatched acceptance report stops publication. Published tags and releases are never overwritten. The registry may take several minutes to expose the package. After publication, install `widgetctl@VERSION` from npm in a fresh project and verify CLI help, both imports, integrity and provenance. Test marketplace installation pinned to the new release tag.

### Interrupted publication

If npm succeeds but propagation or the final GitHub step fails, **do not republish or bump the version**. Download the retained artifacts. Compare `npm view widgetctl@VERSION dist.integrity` with the tested tarball's SHA-512 integrity and confirm its version/commit against `acceptance.json`. If they match, finish the existing draft:

```sh
gh release edit vVERSION --draft=false --latest --notes-file docs/releases/VERSION.md
```

A normal rerun rejects an existing npm version. If integrity differs, investigate before publishing the draft. The first `0.1.0` release used local authenticated npm publication without Actions provenance; subsequent releases use the workflow. New trusted publisher configurations must publish successfully within two days; see [npm's requirements](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).

## Compatibility and recovery policy

Before 1.0, preserve API/CLI behavior within each `0.x` minor and document breaking changes in a minor release. Keep plugin versions aligned with their tested CLI. Runtime coverage and unsupported platforms are listed in [README Support](../README.md#support).

For a bad release, stop rollout and publish a fixed patch. Deprecate affected npm versions or move the registry tag to the last verified version when needed; update marketplace sources accordingly. Keep published Git tags immutable. Plugin uninstall and npm uninstall are separate operations.
