# Distribution

The README is the product’s home. Keep guides, examples, screenshots and install instructions in this repository.

## Channels

| Artifact                                     | Install route                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| Library, CLI and optional Playwright fixture | `npm install --save-dev widgetctl`                                       |
| Standalone CLI                               | `npm install --global widgetctl`                                         |
| Codex or Claude Code plugin                  | This repository’s marketplaces; see [agent setup](agents.md)             |
| Standalone skill                             | Copy `skills/widgetctl` or use `npx skills add DimaMishchenko/widgetctl` |

Choose a project or global CLI install. TypeScript and Playwright imports require a project dependency. `widgetctl/playwright` is an import subpath of `widgetctl`; install `widgetctl @playwright/test` in a Playwright project.

Plugins include the skill, CLI and local MCP server, native worker and bundled dependencies. Standalone skill installs copy both executables but do not register MCP. Choose one skill installation route; no extra npm CLI install is required. Node 22.14+ and Xcode must be present on the Mac. The bundle does not change global PATH or install a project dependency. TypeScript and Playwright imports still need a project dependency.

For reproducible 0.2.0 setup, install `widgetctl@0.2.0`, preserve the lockfile, and pin the Codex marketplace source:

```sh
codex plugin marketplace add DimaMishchenko/widgetctl --ref v0.2.0
```

## Directory submissions

Keep one canonical skill and bundled runtime. Different directories need metadata or account access, not separate implementations. None of the public listings below is claimed as approved.

| Channel | What to submit | Publisher action |
| --- | --- | --- |
| OpenAI directory | Release plugin ZIP with skill, CLI and local MCP | Request local-MCP allowlisting for the submitting organization; then create a new initial MCP package draft and submit for review. |
| Anthropic directory | Public GitHub plugin with skill, CLI and MCP | Submit through [claude.ai/directory/manage](https://claude.ai/directory/manage) using an eligible paid account. |
| skills.sh | Public `skills/widgetctl` folder, including its bundled CLI | No submission form; real `npx skills add DimaMishchenko/widgetctl --skill widgetctl` installs with telemetry make it discoverable. |
| SkillsMP | Public GitHub skill folder | Check indexing; if missing, request discovery through the site's published contact route. |
| Tessl | Complete skill folder and generated Tessl metadata | Sign in, choose a workspace, import the skill, dry-run checks, then publish publicly. |

**OpenAI:** verified publisher identity alone does not enable local MCP submissions. Find your organization ID in Platform settings, send it to your OpenAI representative and ask for local-MCP submission allowlisting. If you have no OpenAI representative, ask OpenAI Support how to reach the partner submission team; the documentation offers no public self-service allowlist form or guarantee of acceptance. Wait for confirmation. The [desktop-only guide](https://developers.openai.com/plugins/deploy/desktop-only) describes uploading the ZIP through **Create plugin → Skills only**, with root `mcp.json` included. Adding MCP to an existing skills-only submission is currently unsupported, so use a new initial package rather than converting the earlier blocked draft. Complete review and publish after approval. The existing skills-only draft remains unpublished. Repository marketplace installs work independently of directory approval.

**Anthropic (optional):** a paid publisher account is needed for directory submission, not to keep the compatible GitHub marketplace package. Without one, skip the directory and retain the adapter so existing Claude users can install from GitHub. To submit later, run `claude plugin validate . --strict`, then test a clean marketplace installation on a Mac with Xcode. The [publishing guide](https://code.claude.com/docs/en/plugins/publish) links to the portal and paid-account requirements. Pro/Max can submit for their own account; Team/Enterprise require the appropriate owner or directory permission. Local simulator execution requires a compatible local Mac host; do not advertise cloud execution. Anthropic's directory and its `claude-plugins-official` marketplace have separate submission routes.

**skills.sh / SkillsMP:** the [skills.sh FAQ](https://skills.sh/docs/faq) explains automatic discovery from installations. Do not manufacture counts or treat telemetry-disabled QA installs as listing proof. [SkillsMP](https://skillsmp.com/about) independently indexes public GitHub skills and publishes `support@skillsmp.com` for discovery questions. Neither index approval nor a manual SkillsMP submission has been confirmed. Install the whole skill folder so the CLI and native worker remain available.

**Tessl:** after installing the [Tessl CLI](https://docs.tessl.io/reference/cli-commands), work from a copy of the complete skill folder so generated metadata does not alter the canonical package:

```sh
tessl login
cp -R skills/widgetctl /tmp/widgetctl-tessl
cd /tmp/widgetctl-tessl
tessl skill import --workspace YOUR_WORKSPACE --public .
tessl skill lint .
tessl skill publish --dry-run .
tessl skill publish .
```

Use a new staging folder if `/tmp/widgetctl-tessl` already exists. Replace `YOUR_WORKSPACE` with a workspace you own. The current CLI creates `.tessl-plugin/plugin.json`; review its name, version and visibility before publication. Check that the packed skill retains `scripts/`, `native/` and licenses. This publishes the skill and bundled CLI; MCP registration is a separate client setup. No Tessl listing is claimed until authenticated publication succeeds.

See [agent installation](agents.md) and [local MCP setup](mcp.md). Additional directory review and account steps remain manual; the GitHub release workflow publishes npm and release artifacts.

## Publish a new version

Use **Actions → Release → Run workflow** on `main`. The workflow defaults to a dry run. It tests Linux/macOS on Node 22.14/24, builds the npm tarball and plugin ZIP, and retains them as the `release-artifacts` download. Publishing uses npm's trusted publisher bound to this repository and `release.yml`; no npm write token is stored in GitHub.

1. Keep the same version in `package.json`, both version entries in `package-lock.json`, `plugin.json` and `.claude-plugin/plugin.json`. Add `docs/releases/VERSION.md`, update documented version pins, then commit and push. Run `npm run build:plugin` after CLI, MCP, native source, dependency or version changes and commit its generated skill resources. `npm test` rejects stale bundles. Keep the source commit unchanged during release acceptance.
2. Run **Release** with that version and **dry_run = true**. Download its `release-artifacts`. Install that exact tarball in a fresh project and run its included [fixture verification example](../examples/README.md#reproduce-the-native-acceptance-checks) on an owned simulator. Inspect the before/edited/restored screenshots for both apps and complete the [release checklist](release-checklist.md). The dry run alone does not establish native acceptance.
3. Create a draft GitHub release named `vVERSION` targeting that exact commit. Upload an `acceptance.json` recording the inspected artifact. It must contain these fields:

   ```json
   {
     "version": "VERSION",
     "commit": "FULL_40_CHARACTER_COMMIT_SHA",
     "tarball": { "sha256": "SHA256_OF_THE_TESTED_TARBALL" },
     "native": {
       "status": "passed",
       "rendered": "Describe the rendered checks and restoration you actually inspected."
     }
   }
   ```

   Keep the full native proof and screenshots with the draft too. Obtain the tarball hash with `shasum -a 256 widgetctl-VERSION.tgz`. Do not mark an uninspected or failing run as passed.
4. Run **Release** again with **dry_run = false** and `native_evidence_url` set to `https://github.com/DimaMishchenko/widgetctl/releases/download/vVERSION/acceptance.json`. Replace `VERSION` in every input. The workflow reads draft assets through GitHub authentication, verifies version, source commit and exact artifact hash, then publishes npm with provenance and the matching GitHub release. It waits for npm processing and compares public integrity before making the GitHub release public.

A newer `main` commit, conflicting tag, existing npm version or mismatched native report stops publication. Keep final acceptance tied to the same commit. Existing tags are never moved, and published releases are never overwritten. Only the publish job receives OIDC and repository write permission. The registry may take several minutes to expose a newly accepted package.

If npm succeeds but propagation times out or the final GitHub step fails, **do not republish or bump the version**. Download the retained `release-artifacts`, compare `npm view widgetctl@VERSION dist.integrity` with that tarball's SHA-512 integrity, and confirm its version and commit against `acceptance.json`. Once they match, finish the existing draft with `gh release edit vVERSION --draft=false --latest --notes-file docs/releases/VERSION.md`. A normal rerun rejects an already published npm version to prevent ambiguous recovery. If integrity differs, stop and investigate instead of publishing the draft.

The first `0.1.0` release used authenticated local npm publication and has no GitHub Actions provenance. Subsequent releases use this workflow. New npm trusted publisher configurations must complete their first successful publish within two days; see [npm's requirements](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).

## Version and recovery policy

Before 1.0, preserve API/CLI behavior within each `0.x` minor version; document breaking changes in a minor release. Keep plugin versions aligned with the CLI they were tested against, and document mismatches rather than silently downloading another version.

For a bad release, stop rollout, document affected versions and publish a fixed patch. If needed, deprecate the affected npm version and move the registry tag to the last verified version. Update the plugin marketplace to a known-good version. Avoid rewriting published Git tags. Plugin uninstall and npm uninstall are separate operations.

## Demo maintenance

The README GIF shows the recorded CLI beside an entire, uncropped simulator screen. `scripts/render-demo.py` requires a terminal recording plus four full-screen captures: `--empty-simulator empty.png --added-simulator added.png --edited-simulator edited.png --removed-simulator removed.png`. Crop/detail-only modes are intentionally unsupported. The current GIF shows Add → Edit → Remove in 19.2 seconds, with a hard 30-second playback limit in the renderer. Simulator state changes only after each successful action; draft edits and removal confirmation keep the previous screenshot. The montage uses real CLI output and simulator captures with pauses trimmed for playback; no additional labels are drawn around the two panels.

Re-record on a disposable simulator when the interface changes. Preserve source recordings and captures as release evidence, inspect key frames, and keep the GIF below 2 MB when possible. Rendering requires Python with Pillow and macOS system fonts; Pillow is not a widgetctl runtime dependency.
