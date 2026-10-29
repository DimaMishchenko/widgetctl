# Release checklist

Use this checklist for every version. Record results, exact commit, artifact hashes and environment in the GitHub release assets. Historical development tests do not replace testing the final artifact.

## Prepare

- [ ] Match versions in `package.json`, `plugin.json` and `.claude-plugin/plugin.json`.
- [ ] Keep README, skill and examples runnable with registry installation. Install `widgetctl` and `@playwright/test` for Playwright; `widgetctl/playwright` is an import path.
- [ ] Review changes and release notes independently, including support limits and cleanup behavior.
- [ ] From a clean checkout, run `npm ci`, `npm test`, `npm run test:playwright`, `npm run test:examples`, `npm run test:performance` and `npm run format:check`.
- [ ] Require green final-commit Linux/macOS CI on Node 22.14 and 24. Native compilation alone does not establish live support.
- [ ] Inspect the production dependency audit and package file list. Build `npm pack` and `npm run pack:plugin`; retain SHA-256 checksums. The plugin ZIP must include its referenced icons, complete skill directory, bundled CLI and MCP server, both MCP configurations, native worker and dependency licenses, without local evidence or development dependencies.

## Test the final tarball

- [ ] Install it in a fresh project. Check CLI help, core ESM imports without Playwright, strict TypeScript types and the optional Playwright import. Check an isolated global CLI installation too.
- [ ] Connect an MCP client to the installed `widgetctl-mcp` and extracted plugin server. Verify initialize/tools/list, structured errors, strict argument validation, cancellation and clean shutdown. Run add/edit/stale-guard/restore/remove through MCP on both fixture apps; inspect the rendered results.
- [ ] Copy its included examples. Run configuration and CLI/Playwright operations on an explicitly owned, booted simulator with signed fixture apps. Prepare before attaching native UI drivers and close drivers before release.
- [ ] Use both fixture apps to check actual queries, edits, stale guards, arrays and restoration. Inspect before/edited/restored screenshots; persisted values alone do not prove rendering.
- [ ] Verify failed setup and normal teardown release the helper. Preserve unrelated widget identities. Delete only task-owned disposable simulators and helpers; never restart global services.
- [ ] Record the artifact hash, Xcode, simulator OS/build and architecture. Attach useful captures and the acceptance report to the release.

## Publish and verify

- [ ] Verify the npm publishing account and version availability. Publish the tested tarball, then compare registry integrity with that artifact.
- [ ] Install `widgetctl@VERSION` from the registry in a fresh project. Exercise CLI help and both imports; retain the lockfile as evidence.
- [ ] Tag the exact tested commit as `vVERSION`, push it, and publish a GitHub release with npm tarball, plugin ZIP, checksums, notes and acceptance evidence.
- [ ] Test marketplace discovery/installation at the release tag in an isolated Codex client. Record Claude installation separately; schema validation is not an end-to-end client test.
- [ ] Use the manual [Release workflow](distribution.md#publish-a-new-version) with the final native acceptance report. Verify npm provenance and integrity after publication; do not store npm write tokens in the repository. A local authenticated publish does not generate GitHub Actions provenance.
- [ ] If publishing to the public OpenAI directory, complete [publisher verification and submission review](https://developers.openai.com/plugins/deploy/submission). A GitHub marketplace release is available independently of that listing.

## Support and recovery

Live development coverage includes individual Home Screen widgets on arm64 iPhone simulators running iOS 26.0, 27.0 and Duo 27.1. Record the exact runtime retested for each release. iPad and Intel remain unverified; physical devices, stacks and Lock Screen widgets are unsupported. Apple private API changes can break compatibility after an OS or Xcode update.

Preserve public behavior within each `0.x` minor version; document breaking changes in minor versions before 1.0. For a bad release, publish a fixed patch and, when necessary, deprecate the bad npm version or move its distribution tag to the last verified version. Keep published Git tags immutable. Plugin uninstall and npm uninstall are separate operations.

The [Currency rollout issue](https://github.com/DimaMishchenko/widgetctl/issues/1) remains a separate consuming-project update with its own native verification.
