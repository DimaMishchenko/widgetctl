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

Plugins and standalone skills include a ready-to-run CLI, native worker and bundled production dependencies. Choose one skill installation route; no extra npm CLI install is required. Node 22.14+ and Xcode must be present on the Mac. The bundle does not change global PATH or install a project dependency. TypeScript and Playwright imports still need a project dependency.

For reproducible 0.1.2 setup, install `widgetctl@0.1.2`, preserve the lockfile, and pin the Codex marketplace source:

```sh
codex plugin marketplace add DimaMishchenko/widgetctl --ref v0.1.2
```

The public OpenAI plugin directory is **not yet published**. A draft was uploaded on 2026-10-29, but the portal reports that it is not accepting more skills-only submissions. The 0.1.2 manifest supplies the requested support, privacy and license URLs; provider acceptance is still required. Repository marketplace installation is a separate channel. A public listing requires a verified publisher identity, package validation, submission and approval; follow the [submission guide](https://developers.openai.com/plugins/deploy/submission) and [desktop-only requirements](https://developers.openai.com/plugins/deploy/desktop-only). Do not claim cloud execution without a local Mac executor.

## Publish a new version

Use **Actions → Release → Run workflow** on `main`. The workflow defaults to a dry run. It tests Linux/macOS on Node 22.14/24, builds the npm tarball and plugin ZIP, and retains them as the `release-artifacts` download. Publishing uses npm's trusted publisher bound to this repository and `release.yml`; no npm write token is stored in GitHub.

1. Keep the same version in `package.json`, both version entries in `package-lock.json`, `plugin.json` and `.claude-plugin/plugin.json`. Add `docs/releases/VERSION.md`, update documented version pins, then commit and push. Run `npm run build:plugin` after CLI, native source, dependency or version changes and commit its generated skill resources. `npm test` rejects stale bundles. Keep the source commit unchanged during release acceptance.
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

Before 1.0, preserve API/CLI behavior within `0.1.x`; document breaking changes in a minor release. Keep plugin versions aligned with the CLI they were tested against, and document mismatches rather than silently downloading another version.

For a bad release, stop rollout, document affected versions and publish a fixed patch. If needed, deprecate the affected npm version and move the registry tag to the last verified version. Update the plugin marketplace to a known-good version. Avoid rewriting published Git tags. Plugin uninstall and npm uninstall are separate operations.

## Demo maintenance

The README GIF shows the recorded CLI beside an entire, uncropped simulator screen. `scripts/render-demo.py` requires a terminal recording plus four full-screen captures: `--empty-simulator empty.png --added-simulator added.png --edited-simulator edited.png --removed-simulator removed.png`. Crop/detail-only modes are intentionally unsupported. The current GIF shows Add → Edit → Remove in 19.2 seconds, with a hard 30-second playback limit in the renderer. Simulator state changes only after each successful action; draft edits and removal confirmation keep the previous screenshot. The montage uses real CLI output and simulator captures with pauses trimmed for playback; no additional labels are drawn around the two panels.

Re-record on a disposable simulator when the interface changes. Preserve source recordings and captures as release evidence, inspect key frames, and keep the GIF below 2 MB when possible. Rendering requires Python with Pillow and macOS system fonts; Pillow is not a widgetctl runtime dependency.
