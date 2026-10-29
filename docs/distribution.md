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

Plugins and standalone skills supply instructions, not the CLI or a remote simulator service. Choose one skill installation route; plugin installation does not also require copying the skill. All execution needs a local Mac with Xcode and an explicitly reserved simulator.

For reproducible 0.1.0 setup, install `widgetctl@0.1.0`, preserve the lockfile, and pin the Codex marketplace source:

```sh
codex plugin marketplace add DimaMishchenko/widgetctl --ref v0.1.0
```

The public OpenAI plugin directory is **not yet published**. Repository marketplace installation is a separate channel. A public listing requires a verified publisher identity, package validation, submission and approval; follow the [submission guide](https://developers.openai.com/plugins/deploy/submission) and [desktop-only requirements](https://developers.openai.com/plugins/deploy/desktop-only). Do not claim cloud execution without a local Mac executor.

## Maintainer release process

One repository, one version: keep `package.json`, `plugin.json` and the Claude compatibility manifest aligned. The root manifest uses [Agent Plugins 1.0 packaging](https://developers.openai.com/plugins/build/plugins); the Claude adapter points to the same skill.

1. Choose the final clean commit and complete the [release checklist](release-checklist.md), including CI, packed-consumer imports/types and native rendered verification of the same tarball.
2. Build both deliverables:

   ```sh
   npm ci
   npm test
   npm run test:playwright
   npm run test:examples
   npm run format:check
   npm pack
   npm run pack:plugin
   ```

   Retain the npm tarball and `.local/release/widgetctl-plugin-VERSION.zip` with SHA-256 hashes. Inspect the plugin ZIP: only the skill, manifests, referenced icon assets and license belong in it, with `plugin.json` at the root.

3. Confirm npm publisher access and publish the reviewed tarball. Use an approved publishing route; configure [trusted publishing](https://docs.npmjs.com/trusted-publishers/) against the actual release workflow when available. Verify fresh registry installation, CLI execution, both imports and the actual provenance result. Local packing alone proves neither publishing permission nor provenance.
4. Create the matching `vVERSION` tag and GitHub release from that commit. Attach the verified tarball, plugin ZIP, hashes and concise release notes with the supported Xcode/simulator matrix and private-API limitations.
5. Verify marketplace installation from the matching tag and update version pins. Public-directory submission remains a separate process through the verified publisher’s account.

Keep releases maintainer-triggered until publishing identities and native acceptance are established. A later automated release workflow must gate publishing on version/tag agreement, successful final-commit CI, reviewed native evidence and a protected approval environment. Limit `id-token: write` to the publish job.

## Version and recovery policy

Before 1.0, preserve API/CLI behavior within `0.1.x`; document breaking changes in a minor release. Keep plugin versions aligned with the CLI they were tested against, and document mismatches rather than silently downloading another version.

For a bad release, stop rollout, document affected versions and publish a fixed patch. If needed, deprecate the affected npm version and move the registry tag to the last verified version. Update the plugin marketplace to a known-good version. Avoid rewriting published Git tags. Plugin uninstall and npm uninstall are separate operations.

## Demo maintenance

The README GIF shows the recorded CLI beside an entire, uncropped simulator screen. `scripts/render-demo.py` requires a terminal recording plus four full-screen captures: `--empty-simulator empty.png --added-simulator added.png --edited-simulator edited.png --removed-simulator removed.png`. Crop/detail-only modes are intentionally unsupported. The current GIF shows Add → Edit → Remove in 19.2 seconds, with a hard 30-second playback limit in the renderer. Simulator state changes only after each successful action; draft edits and removal confirmation keep the previous screenshot. The montage uses real CLI output and simulator captures with pauses trimmed for playback; no additional labels are drawn around the two panels.

Re-record on a disposable simulator when the interface changes. Preserve source recordings and captures as release evidence, inspect key frames, and keep the GIF below 2 MB when possible. Rendering requires Python with Pillow and macOS system fonts; Pillow is not a widgetctl runtime dependency.
