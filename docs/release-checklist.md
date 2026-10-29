# First npm release checklist

**Status: implementation verified; npm publication still gated.** The redesigned CLI/API has host, terminal and rendered simulator evidence. Publishing identity, exact release-commit CI and tagged-artifact checks remain open.

This review covers the planned `0.1.0` release. Last checked on 2026-10-29. Refresh this checklist for the exact commit and tarball you intend to publish. A checked box records evidence, not a promise that an untested environment works.

## What is already established

- [x] The repository declares MIT licensing, ESM imports, a CLI, typed core/Playwright entry points, and Node `>=22.14.0`.
- [x] Core usage does not require installing Playwright. The Playwright binding is an optional peer.
- [x] The committed code at `d60938f` passed [Linux/macOS × Node 22/24 CI](https://github.com/DimaMishchenko/widgetctl/actions/runs/40346007474). Its `npm test` includes Playwright lifecycle tests. Native compilation is separate from live simulator coverage.
- [x] Owned arm64 iPhone/iOS 27 verification exercised creation, reuse, placement, replacement, removal, exclusivity, configuration export/apply, rejected wrong targets and preservation of unrelated Home identities.
- [x] A changed configuration produced a visible change; restoration reproduced the original screenshot exactly. This was development verification, not installation of a published npm version.
- [x] Cleanup ran in `finally`, and the disposable verification simulator was deleted. No global simulator services were restarted.

## Current redesign evidence

The two signed fixture apps cover booleans, strings, localized fractional numbers, enums, entities and entity arrays. Live acceptance on iOS 26.0, 27.0 and Duo 27.1 checked suggestions, search, staged dependent queries without mutation, guarded saves, arrays with zero/one/two selections and restoration. The iOS 27.0 and 27.1 runs used a fresh tarball consumer. A real terminal edit selected an entity, entered a fractional number, reviewed the diff, saved, checked rendering and restored the original values.

The native contract harness has 20 checks. Independent default-model and additional Astra high reviews were completed; substantiated findings were fixed and reviewed again. Saved-state assertions and visually inspected captures are separate checks. Transient simulator/helper failures were retained as failed evidence and retried; no global simulator service was restarted.

## Additional diagnostics and session acceptance

- [x] Read-only `doctor` checks host tooling, runtime/device availability, app-registry readability and existing helper state, without repair or injection.
- [x] API and JSON failures expose stable codes and recovery steps; unknown native exception names fail safely without parsing English diagnostics.
- [x] Guided sessions retain their selected simulator, prepare once, and release on exit/change. Failed mutating actions release before another attempt; writes are never retried automatically.
- [x] Real terminal add, list and doctor actions use one preparation and one release. Raw terminal Ctrl-C inside a picker exits 130 after release; explicit Back stays in the session.
- [x] Independent Currency and Apple Reminders outcomes are recorded in [compatibility](compatibility.md). Currency routing and localized-label bugs found there are fixed; legacy Reminders configuration remains explicitly unsupported.
- [x] The [performance runner](performance.md) preserves raw samples and failure status, detects source changes, distinguishes cold/cached/ready setup and handles interruption with cleanup. Native wall-clock budgets remain environment-specific investigation thresholds.

## Finish before publishing

### Package and consumer experience

- [x] The redesigned working tree passed 184 host tests and four Playwright lifecycle tests, including strict packed-consumer types and runnable examples. Exact Node 22.14.0 also passed the complete suite; repeat on the release commit. The clean-consumer package test covers both core and optional Playwright imports/types.
- [ ] Re-run those gates after `npm ci` in a clean checkout of the final release commit.
- [ ] Require green CI for that exact final commit on Linux/macOS and Node 22/24. The earlier green commit does not validate later changes.
- [x] The complete suite, including packed-consumer acceptance, passes on exact Node **22.14.0**. CI now pins that floor. Repeat for the release commit.
- [x] Verify the working-tree tarball installs in a fresh consumer, its CLI runs, and core ESM imports without Playwright. Repeat for the final release artifact if source or dependencies change.
- [x] Compile a strict tarball consumer with `skipLibCheck: false` and no incidental Node types. The leaked internal `node:util` declaration is fixed and covered by the package test.
- [x] Packed-consumer imports and strict types pass with Playwright **1.50.0** and the locked development version. Both are now covered by the package regression test. The four lifecycle scenarios pass with the locked version.
- [x] Verify the working-tree tarball contains native source, declarations, the usage guide, linked documentation and runnable examples. The package test now rejects broken relative documentation links.
- [x] Try the documented GitHub install from a pinned commit in a clean project. Core import and CLI help passed for `d60938f`. Repeat for the final documented commit: Git installs run the source build and differ from registry/tarball installs.
- [x] Review the production dependency audit and tarball file list. `npm audit --omit=dev` reported zero advisories for the checked dependency graph. This is not a full security review; refresh after dependency changes.

### Native release acceptance

- [ ] Install the final release tarball in a fresh consumer, copy its included examples, and run `configuration.ts` on an explicitly owned, already booted simulator. Use the CLI/Playwright example for those interfaces too. The contributor `npm run test:live` uses repository source and does not replace installed-artifact acceptance.
- [ ] Change a real parameter, check its rendered result with a native driver, restore it, and verify unrelated Home entries remain intact. An unchanged configuration round trip alone is insufficient.
- [ ] Record exact artifact version/hash, Xcode, simulator OS/build and architecture in release evidence. Attach a small useful capture and verification summary to the release.
- [x] Keep the support claim limited to verified individual Home Screen widgets on arm64 iPhone simulators running iOS **26.0, 27.0 and Duo 27.1**. To advertise iPad, Intel, another runtime, stacks or Lock Screen support, first add matching implementation and live evidence.
- [ ] Verify ordinary setup and failure cleanup through the same API/CLI/fixture that consumers will run. Prepare before driver connection; close the driver before release.

### Ownership, publishing and version policy

- [ ] Establish npm ownership of the intended package name. The public registry returned `E404` during review; that is not proof that the name can be registered or that this account owns it.
- [ ] Confirm the first version and tag. `package.json` currently says `0.1.0`; there is no published GitHub release in the checked repository.
- [ ] Agree on the pre-1.0 policy and write it into release notes. Recommended: preserve the public API/CLI within `0.1.x`, document breaking changes in minor releases, and state that Apple private APIs may stop working after OS/Xcode changes.
- [ ] Choose and configure the publishing identity. Prefer [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) from GitHub Actions instead of a stored write token. Follow npm's current account/bootstrap requirements for the first package publication.
- [ ] Add a version/tag publishing workflow that validates the version matches the tag, runs the required gates and uses the configured npm publisher identity. Trusted publishing currently requires npm 11.5.1+ and Node 22.14+; those publishing requirements are separate from widgetctl's consumer minimum.
- [ ] Verify provenance for the published public artifact. GitHub Actions trusted publishing can generate it automatically for eligible public repository/package combinations; a local dry run does not prove publisher authentication or provenance.
- [ ] Review release notes with support limits, installation, API/CLI changes, cleanup behavior, and known gaps. No release notes or publishing workflow exist in the reviewed commit.
- [ ] Publish only after the above gates pass. Update README installation to the actual registry version, verify fresh `npm install --save-dev widgetctl@VERSION`, and exercise `npx --no-install widgetctl --help` plus both imports from that installation.
- [ ] Tag the exact released commit, create its GitHub release, and verify the registry version, integrity, source link and provenance match. Record any recovery plan before changing distribution tags or deprecating a bad release.

The existing [npm release issue](https://github.com/DimaMishchenko/widgetctl/issues/1) also tracks switching Currency from its pinned GitHub commit. Treat that as a separate consuming-project rollout after publishing; keep its native E2E verification and lockfile update in that project.

## Remaining product acceptance checks

These checks apply to the redesigned CLI and editor. Check them only after recording evidence for the final artifact:

- [x] Provide two fixture apps with static/configurable widgets and all six supported field types.
- [x] Provide simulator discovery, app/widget/size pickers and an exact installed-widget picker.
- [x] Remove superseded CLI lifecycle commands; worker commands prepare and release automatically; read-only listings skip injection.
- [x] Exercise real terminal Back, cancellation, optional field menus and recoverable query errors.
- [x] Preserve machine JSON strings and untouched multiline text defaults.
- [x] Both fixture apps render edited values and restoration on iOS 26.0, 27.0 and Duo 27.1. Before/edited/restored captures were inspected.
- [x] Verify native entity suggestions, filtered search, staged dependent queries, selected values and arrays against app query results. Unsupported runtimes must retain a recoverable explanation and JSON fallback.
- [x] Editor tests distinguish changing optional fields, clearing to null and removing the key. Native acceptance covers empty, single and multiple entity arrays; arbitrary app-specific null/removal behavior still depends on its intent schema.
- [x] Native stale-configuration rejection preserves newer values, using current identities and an older parameter snapshot.
- [x] Run the development candidate from a fresh packed consumer, retain its hash and inspect rendering. Repeat for the tagged release artifact.
- [x] Expand the runtime matrix only after live verification of each combination. iOS 26.0 removal uses its separately verified private method signature.
- [x] Ship the fixture acceptance walkthrough and capture example, including native query checks and required visual inspection. The Playwright example accepts an app-specific native assertion module; it skips rendered assertions until one is supplied.
- [ ] Add automated release staging/provenance checks once the publishing identity is established.

## Documentation and agent distribution

The [distribution plan](distribution.md) is the source of truth for npm bootstrap, plugin channels, version alignment and rollback. The README is the product home; no separate site is planned.

- [x] README includes a small GIF replayed from a real CLI recording and CLI, TypeScript and Playwright entry points.
- [x] One short, canonical `skills/widgetctl` skill is shared by OpenAI Agent Plugins and the Claude adapter.
- [x] The OpenAI manifest declares local execution; the plugin does not install a CLI or expose a cloud simulator service.
- [x] `npm run pack:plugin` builds a version-matched, reproducible ZIP and SHA-256 checksum without publishing. Tests verify package contents and prevent version drift.
- [ ] Verify Codex and Claude installation from the exact release tag, including invoking the skill with the separately installed CLI. Schema and package checks do not replace host installation.
- [ ] If seeking a public OpenAI listing, complete desktop-only submission checks and publisher review. Repository marketplace availability is a separate channel.

## Release commands to prepare the artifact

Run from a clean checkout of the intended release commit. The first block does not publish:

```sh
npm ci
npm test
npm run test:playwright
npm run test:examples
npm run format:check
npm pack --dry-run
npm pack
```

Use the generated `.tgz` for consumer and native acceptance, not a different rebuild. Check file contents and hashes before the actual publishing step. See [npm's publishing guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/) and [trusted publisher setup](https://docs.npmjs.com/trusted-publishers/) for the account-specific steps.
