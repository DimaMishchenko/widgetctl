# Distribution

The README is the product’s home. Keep guides, examples, screenshots and install instructions in this repository; no separate site is needed.

## What ships

| Artifact                | Purpose                                              | Current route                                        |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `widgetctl` npm package | TypeScript library, CLI, optional Playwright fixture | GitHub dependency until the first npm release        |
| Agent plugin            | Short skill and host metadata                        | This repository’s Codex and Claude Code marketplaces |
| Standalone skill        | Instructions for other skill-compatible local agents | Copy `skills/widgetctl`                              |

One repository, one version. `package.json`, `plugin.json` and the Claude compatibility manifest must agree. Plugins contain agent instructions, not an npm installation or a remote simulator service. They need a local Mac execution environment with Xcode and an explicitly reserved simulator.

## Available now

Install the library and CLI together:

```sh
npm install --save-dev github:DimaMishchenko/widgetctl
npx widgetctl --help
```

Pin a reviewed commit for CI. Add the agent plugin separately using [agent setup](agents.md). Do not advertise an npm installation command or public plugin-directory listing before those artifacts are actually published.

## First release

1. Confirm npm package ownership, publisher identity and the first version. The current `0.1.0` is a candidate, not a published release.
2. Choose a clean commit. Run the [release checklist](release-checklist.md), including Linux/macOS × Node 22.14/24 CI, packed-consumer imports/types, and native verification of that same tarball.
3. Build the two deliverables from that commit:

   ```sh
   npm ci
   npm test
   npm run test:playwright
   npm run test:examples
   npm run format:check
   npm pack
   npm run pack:plugin
   ```

   Retain the npm tarball and `.local/release/widgetctl-plugin-VERSION.zip` with their SHA-256 hashes. Inspect the plugin ZIP; it must contain only the skill, manifests and license, with `plugin.json` at the archive root.

4. Resolve first-package bootstrap with the npm owner before choosing publishing credentials. [npm trust requires an existing package](https://docs.npmjs.com/cli/v11/commands/npm-trust/); do not assume a new package can immediately publish with OIDC. npm’s [staging flow](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/) can create a public placeholder for a new package. Treat that as a publishing action needing explicit release approval. For subsequent releases, configure [trusted publishing](https://docs.npmjs.com/trusted-publishers/) against an actual, reviewed GitHub workflow and publisher identity. A local `npm pack` does not prove publishing permissions or provenance.
5. Publish the reviewed npm tarball through the approved bootstrap/publishing route. Verify fresh registry installation and the actual provenance result; do not claim provenance for a local authenticated publish that did not generate it. Then create the matching `vVERSION` Git tag and GitHub release. Attach the already verified tarball, plugin ZIP, hashes and concise release notes. This plan does not publish anything automatically.
6. Update README installation to the real npm version. Verify its CLI, both imports and native behavior before recommending it. Re-test Codex/Claude marketplace installation from the same tag, then document the pinned plugin version.

Keep the first release maintainer-triggered while publishing identities and native acceptance are being established. Once package ownership and a working trusted publisher are established, use a gated release workflow: require a version/tag match, successful final-commit CI, reviewed native evidence and a protected approval environment. Give `id-token: write` only to the publish job; avoid stored npm write tokens.

## Plugin channels

The repo marketplaces are the initial channel. Users can track the main branch during development or pin a verified tag/commit. Keep the plugin’s version aligned with the CLI it was tested against, and document mismatches rather than silently downloading another tool version.

The root manifest uses [Agent Plugins 1.0 packaging supported by OpenAI](https://developers.openai.com/plugins/build/plugins). A small Claude adapter points to the same skill. No MCP endpoint, lifecycle hook, connector, credentials or background installer is needed.

A public OpenAI directory listing is a later channel, not a prerequisite. Widgetctl needs desktop execution; follow the [desktop-only submission requirements](https://developers.openai.com/plugins/deploy/desktop-only) and [submission process](https://developers.openai.com/plugins/deploy/submission). Verify publisher identity, package validation, review materials and actual local execution before submission. Do not claim availability in cloud ChatGPT sessions that lack a local Mac executor. Marketplace registration and schema validation are not public-directory approval.

## Version and recovery policy

Before 1.0, preserve API/CLI behavior within `0.1.x`; document breaking changes in a minor release. Record the supported Xcode/simulator matrix and private-API limitations with every release.

For a bad release, stop rollout, document the affected versions, and publish a fixed patch. If needed, deprecate the affected npm version and move the registry tag to the last verified version. Update the plugin marketplace to a known-good version. Avoid rewriting published Git tags. Plugin uninstall and npm uninstall are separate operations.

## What the maintainer needs to provide

| Channel | Needed before release |
| --- | --- |
| npm library and CLI | npm account with 2FA, permission to publish the chosen name, and approval of the first version; configure a trusted publisher after bootstrap |
| GitHub-based skills and plugins | Public repository and a reviewed version/tag; no separate server or registry account |
| skills.sh discovery | Optional: the same public skill repository works with `npx skills add DimaMishchenko/widgetctl`; see the [skills CLI](https://skills.sh/docs/cli) |
| OpenAI public plugin directory | Optional: verified publisher identity, submission access and review; follow the [submission guide](https://developers.openai.com/plugins/deploy/submission) |

Use `widgetctl` if npm grants the publishing name; otherwise choose a scoped name such as `@YOUR_NPM_ACCOUNT/widgetctl` and update installation instructions. A registry 404 is not proof that a name can be registered. Do not share passwords, npm tokens or 2FA codes in a chat; complete account login using the client’s own authentication flow.

## Demo maintenance

The README GIF shows the recorded CLI beside an entire, uncropped simulator screen. `scripts/render-demo.py` requires a terminal recording plus four full-screen captures: `--empty-simulator empty.png --added-simulator added.png --edited-simulator edited.png --removed-simulator removed.png`. Crop/detail-only modes are intentionally unsupported. The current GIF shows Add → Edit → Remove in 19.2 seconds, with a hard 30-second playback limit in the renderer. Simulator state changes only after each successful action; draft edits and removal confirmation keep the previous screenshot. Separately recorded native captures are labelled as such, so the GIF does not claim to be a synchronized screen recording.

Re-record on a disposable simulator when the interface changes. Preserve source recordings and captures as release evidence, inspect key frames, and keep the GIF below 2 MB when possible. Rendering requires Python with Pillow and macOS system fonts; Pillow is not a widgetctl runtime dependency.
