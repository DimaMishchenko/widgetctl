# Runnable consumer examples

Use these from your own Node project on macOS with Node 22.14+, Xcode, an installed widget app, and an already booted simulator that you exclusively own. These examples do not boot devices or install apps. Runtime support follows the repository's support matrix.

Install the package, then copy this directory to `examples/widgetctl` in that project:

```sh
npm install --save-dev widgetctl typescript@5.9.3 tsx @types/node@22.19.0
```

The examples use the tested TypeScript 5.9.3 and Node type definitions 22.19.0 toolchain. Use `widgetctl@0.2.1` and commit your lockfile for reproducibility. The installed package includes this directory. Copy it with `mkdir -p examples && cp -R node_modules/widgetctl/examples examples/widgetctl`. You can also copy it from the repository. For a project without a `package.json`, run `npm init -y` first, and use `npm pkg set type=module` for these ESM TypeScript examples.

Set real inputs from your installed app and owned simulator:

```sh
export SIMULATOR_UDID='YOUR_OWNED_BOOTED_SIMULATOR_UUID'
export WIDGET_EXTENSION='YOUR_INSTALLED_WIDGET_EXTENSION_BUNDLE_ID'
export WIDGET_KIND='YOUR_WIDGET_KIND'
export WIDGET_SIZE='medium'
export CONFIGURATION_FILE="$PWD/widget-configuration.json"
```

Replace every uppercase placeholder before running. Optional `WIDGET_CONTAINER` specifies the app bundle identifier; `WIDGET_ICON` selects one exact existing widget icon UUID. Without `WIDGET_ICON`, `ensure` reuses a matching widget or creates one, and ambiguous targets fail. The examples omit `exclusive` and `replace` so they preserve other widgets and identities. They leave the ensured widget installed; `release` only unloads the helper.

## Discover installed widgets

With only `SIMULATOR_UDID` set, run `npx tsx examples/widgetctl/discover.ts` to print devices, the catalog and installed widget identities. Set `WIDGET_ICON` to describe one existing widget. Add `CONFIGURATION_PARAMETER` and optional `CONFIGURATION_SEARCH` to query its native entity choices. This example does not add or change widgets.

## TypeScript and CLI

Run from your consumer project's root:

```sh
npx tsx examples/widgetctl/basic.ts
npx tsx examples/widgetctl/configuration.ts
bash examples/widgetctl/cli.sh
```

`basic.ts` exports the complete configuration to `CONFIGURATION_FILE`. `configuration.ts` applies a fresh export and verifies persisted readback. `cli.sh` adds or reuses a catalog widget, captures its exact icon UUID, exports, and reapplies that same file. CLI commands that need a helper prepare and release automatically, including preparation failures. `devices` and `list` only read existing state. If `WIDGET_ICON` is supplied, the script exports that existing icon without adding one. TypeScript uses `finally` for release. Connect any native UI driver only after preparation finishes.

Configuration export/apply requires a supported AppIntent widget. Keep the complete exported envelope, including intent identifiers, entity metadata and unknown fields. Exports describe the current widget on the current simulator; export again after native edits and use the envelope returned by apply. Treat exported files as app data and keep them out of version control when they contain personal values.

For an optional parameter change, inspect your export first, then set both variables and rerun `configuration.ts`:

```sh
export WIDGET_PARAMETER='EXISTING_PARAMETER_KEY'
export WIDGET_VALUE_JSON='COMPLETE_JSON_VALUE_FOR_THAT_PARAMETER'
npx tsx examples/widgetctl/configuration.ts
```

The value must be valid JSON with your widget's actual schema. Copy and edit the existing complete value, preserving nested entity metadata. The example refuses to introduce an absent key. `updateConfiguration` edits only the parameters dictionary while preserving the canonical intent envelope. The changed value remains applied. Interactive users can run `npx widgetctl edit --device "$SIMULATOR_UDID" --widget "$WIDGET_ICON"` to stage typed changes and review a diff before saving. Unsupported fields stay read only; unavailable choice discovery has an explicit JSON fallback. Entity query support depends on the installed app and runtime. Omit both variables for an unchanged round trip.

## Playwright

`widgetctl/playwright` is included in `widgetctl`; it is not a separate npm package. Install the runner alongside widgetctl, then use the included configuration:

```sh
npm install --save-dev widgetctl @playwright/test
npx playwright test --config examples/widgetctl/playwright/playwright.config.ts
```

The fixture prepares before tests and releases in teardown, including setup failures. `workers: 1` enforces one worker for this simulator. Use separate invocations with different owned UDIDs for parallel devices.

The first test verifies persisted configuration. It does not prove that the widget rendered correctly. The second test is explicitly skipped until you provide a native UI assertion module:

```sh
export NATIVE_ASSERTION_MODULE="$PWD/test/native-widget-assertions.mjs"
npx playwright test --config examples/widgetctl/playwright/playwright.config.ts
```

Your module must export async `assertWidgetRendered({ udid, iconIdentifier })`. It must connect its native driver to that exact UDID after invocation, locate the selected widget, assert app-specific visible content or interactions, throw on failure, and close its driver in `finally`. Its assertions determine rendered coverage; a function that returns without checking UI proves nothing. Playwright's browser `page` fixture cannot drive the native Home Screen. No native driver dependency or app-specific assertion is supplied here.

## Check without a simulator

After installing the optional Playwright dependency, typecheck all copied examples and check Bash syntax from the consumer root without running any simulator operations:

```sh
npx tsc -p examples/widgetctl/tsconfig.json
bash -n examples/widgetctl/cli.sh
```

Typechecking and shell parsing do not verify native runtime support, configuration compatibility, or rendered results.

## Reproduce the native acceptance checks

Build and install both signed fixture apps from [the repository fixture project](https://github.com/DimaMishchenko/widgetctl/tree/main/test/fixtures/apps) on your owned, booted simulator, and launch each app once. Use the fixture source from the same commit as your installed package. The project needs Xcode and xcbeautify; no signing account is required.

Then run the included package example:

```sh
SIMULATOR_UDID='YOUR_OWNED_BOOTED_SIMULATOR_UUID' \
VERIFICATION_OUTPUT="$PWD/widgetctl-verification" \
npx tsx examples/widgetctl/verify-fixtures.ts
```

It checks both apps, real entity suggestions/search, staged dependent queries, all editable field types, arrays with zero/one/two selections, stale saves, exact readback and restoration. It restores configurations after attempted edits and removes only widgets it created. Each invocation writes to a fresh timestamped directory under `VERIFICATION_OUTPUT`. It publishes `proof.json` only after assertions and cleanup succeed; failed runs produce `failure.json` with all operation and cleanup errors. Ctrl-C stops further checks, then attempts restoration and release before exiting. An active native operation may finish before cleanup starts.

Inspect the before/edited/restored PNGs before claiming a rendered pass; canonical readback alone is insufficient. `SIMULATOR_DISPLAY` selects a screenshot display on devices with multiple screens. Screenshot commands time out after 30 seconds. Existing fixture widgets may move to the first position on their Home page so the captures can show them.
