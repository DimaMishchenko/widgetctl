# Using widgetctl

widgetctl manages individual Home Screen widgets on an explicitly owned iOS simulator. It verifies saved identities and supported configuration readback. Check rendered content separately with your native UI driver.

## Choose a simulator

Use macOS, Node 22.14+, full Xcode, and an installed widget app. Launch the app once so its widget descriptors can register.

```sh
npx --no-install widgetctl devices --json
```

Interactive mode shows the runtime, state and UUID of every available iOS simulator. Select your own device explicitly. A shutdown device boots only after confirmation; preparation asks for ownership and UI restart consent. Decline or press Ctrl-C to cancel.

Scripts must pass an already booted UUID using `--device`. To boot one yourself:

```sh
export SIMULATOR_UDID='YOUR_OWNED_SIMULATOR_UUID'
xcrun simctl boot "$SIMULATOR_UDID"
xcrun simctl bootstatus "$SIMULATOR_UDID" -b
```

Skip `boot` if already booted. Reserve one simulator per worker. Locks serialize individual operations; they do not reserve the simulator for your entire suite. Never restart global simulator services to recover a task.

## Guided terminal workflow

```sh
npx --no-install widgetctl
```

Choose Add/reveal, Edit, Remove, Export, or Apply from file. Search app and widget lists by typing. Add selects only installed catalog descriptors and their supported sizes. Back returns from sizes to widget kinds and from kinds to apps. Existing-widget actions show the exact icon UUID, kind, size, page and item position.

The editor keeps a draft until you choose Review and save, inspect the parameter diff, and confirm. Declining save returns to the draft; discard leaves the widget unchanged. Boolean, text and numeric fields have typed prompts. Optional fields also offer explicit null or removal; the draft and diff preserve their different meanings. Accepting an existing multiline value preserves it exactly. Enum and entity choices use full JSON values; entity lists can select several choices. Unsupported fields are read only and show a reason. When a runtime cannot enumerate choices, widgetctl explains the limit and offers an explicit JSON editor. Native choices come from the installed app’s query service; searches also receive the staged draft, so dependent choices follow earlier edits.

CLI commands that need a helper prepare and release it, including failed preparation. `devices` and `list` read existing state without injecting a helper or restarting the Home UI. Preparation and release may restart the selected simulator's Home UI. Widgets remain installed. Connect drivers after preparation and close them before release. For several operations under one driver connection, use the TypeScript API or Playwright fixture.

## Scripts and agents

Use `--json` for one JSON result on stdout, with `schemaVersion: 1`, `status`, and operation data or an `error`. JSON mode never prompts, even in a terminal. Without a terminal, missing required arguments fail with usage guidance. Plain terminal output is intended for humans.

```sh
npx --no-install widgetctl catalog --device "$SIMULATOR_UDID" --json
npx --no-install widgetctl add --device "$SIMULATOR_UDID" \
  --app 'YOUR_APP_BUNDLE_ID' --kind 'YOUR_CATALOG_KIND' --size medium --json
npx --no-install widgetctl list --device "$SIMULATOR_UDID" --json
```

`catalog` groups descriptors under installed app names and bundle identifiers. Use `--extension` when an app has several extensions with the same kind. The requested app, extension, kind and size must resolve to exactly one descriptor. `add` reuses a matching widget or creates one; ambiguity fails instead of choosing an existing duplicate.

Capture `iconIdentifier` from `add` or `list`, then target that identity:

```sh
export WIDGET_ICON='YOUR_EXACT_ICON_UUID'
npx --no-install widgetctl export --device "$SIMULATOR_UDID" \
  --widget "$WIDGET_ICON" --file widget.json --json
npx --no-install widgetctl configure --device "$SIMULATOR_UDID" \
  --widget "$WIDGET_ICON" --file widget.json --json
npx --no-install widgetctl remove --device "$SIMULATOR_UDID" \
  --widget "$WIDGET_ICON" --json
```

`edit` requires an interactive terminal. Automation exports, changes the complete file, and applies it with `configure`. Export again before subsequent edits: applying configuration can change instance identities, making an older file stale.

For `add`, `--position top` moves the widget first on its current page. `--replace` creates fresh identities. `--exclusive` removes other widgets of the same extension, including other kinds and sizes. Use these only when your test needs them. Multi-step mutations are not transactions; earlier verified removals can remain if a later step fails.

CLI exit codes are `0` success, `1` operation failure, `2` invalid input or duplicate/unverified outcome, and `130` cancellation. If helper release fails after cancellation, the command reports failure and the cleanup diagnosis instead of claiming successful cancellation. A mutation already submitted may finish before cancellation cleanup runs. Preserve structured failure output before retrying.

## TypeScript lifecycle and exact handles

```ts
import { createWidgetController } from "widgetctl";

const widgets = createWidgetController({ udid: process.env.SIMULATOR_UDID! });
try {
  await widgets.prepare();
  console.log(await widgets.catalog());
  const installed = await widgets.installedWidgets();
  if (installed.length) {
    const widget = await widgets.getWidget(
      installed[0]!.target.iconIdentifier!,
    );
    console.log(await widget.describeConfiguration());
  }
} finally {
  await widgets.release();
}
```

`ensure(target)` adds or reuses a matching widget and returns an exact handle. `getWidget(iconIdentifier)` binds an existing icon without adding or revealing it. A stale exact handle fails rather than selecting a replacement.

| Call                                                 | Result                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `widgets.catalog()`                                  | Installed app names, descriptors and supported sizes         |
| `widgets.installedWidgets()`                         | Exact targets and Home positions                             |
| `widgets.getWidget(iconIdentifier)`                  | Handle for an existing icon                                  |
| `widgets.ensure(target, options?)`                   | Add/reuse and verify an exact handle                         |
| `widget.describeConfiguration()`                     | Current complete configuration and typed field descriptions  |
| `widget.configurationChoices(key, search?, options?)`          | Available complete choices, or an explicit unsupported error |
| `widget.parameters()`                                | Detached current parameters                                  |
| `widget.exportConfiguration()`                       | Complete configuration envelope                              |
| `widget.applyConfiguration(envelope, { expected }?)` | Apply, optionally requiring an unchanged original snapshot   |
| `widget.updateConfiguration(mutator)`                | Fresh export, parameter mutation and verified apply          |
| `widget.reveal()` / `widget.remove()`                | Exact verified operation                                     |

Only `udid` is required to create a controller. Advanced options include `stateDirectory`, `architecture`, `launchDomain`, and `onResult`. Keep logging callbacks nonthrowing: a logging failure cannot undo an operation.

## Configuration limits

Export/apply supports the worker's concrete `INAppIntent` representation. A static or legacy widget may be addable while configuration export is unsupported. An export describes the current exact widget on the current simulator; it is not a template for another device or replacement icon.

Numeric controls use the simulator’s format. You can enter `7.5` in the CLI; on a simulator with a comma decimal separator it saves the native string `"7,5"`. `describeConfiguration()` reports `numberFormat` and marks these fields with `numberEncoding: "decimal-string"`. Raw JSON/API callers must keep that native representation. Do not convert every numeric-looking string into a JavaScript number. Missing format metadata leaves numeric fields read only.

Keep the full envelope, app/intent identifiers, nested entity metadata and unknown fields. Change only parameters whose schema you understand. Values must be finite, plain JSON; accessors, dates, `undefined`, cycles and sparse arrays reject. Keep private exported values out of public issues and version control.

The interactive editor uses the original snapshot as a concurrency guard when saving. API callers can do the same:

```ts
const original = await widget.exportConfiguration();
const draft = structuredClone(original);
await widget.applyConfiguration(draft, { expected: original });
```

For choices that depend on other edited fields, pass the full staged configuration and its original snapshot. A signal can cancel obsolete queued searches; an already running native query finishes under its timeout before cleanup.

```ts
const abortController = new AbortController();
const choices = await widget.configurationChoices("featuredPlant", "fern", {
  configuration: draft,
  expected: original,
  signal: abortController.signal,
});
```

Parameter keys are limited to 256 characters and search terms to 512. Native option lists are bounded; refine the search when suggestions exceed the limit.

An external edit after export rejects guarded apply. Re-export and review before retrying. Parameter mutators may be async, but cannot invoke operations on the same controller; those calls reject to prevent deadlock.

## Playwright and rendered checks

Use [the runnable fixture examples](../examples/README.md#playwright) with `workers: 1`. The worker fixture prepares and releases automatically, including setup failures. Make native driver fixtures depend explicitly on `widgets`, and close them in teardown before the helper is released.

Playwright's browser `page` cannot operate the Home Screen. Persisted readback proves saved setup; a native driver must assert app-specific visible content and interactions. The supplied Playwright rendered example skips until you provide a real assertion module. The [fixture acceptance example](../examples/verify-fixtures.ts) separately checks both fixture apps, native queries, dependencies, configuration types, stale edits and restoration; it saves captures for rendered inspection.

## Failures and support

The API rejects with `WidgetctlError`; inspect its message and optional full `result`. For missing descriptors, check the catalog after launching the containing app. For identity mismatches, export the current exact widget again. For unsupported families, selectors, entity queries or runtime metadata, preserve the diagnosis and report the actual unsupported runtime. A successful build does not establish runtime compatibility.

Live verification covers two fixture apps on arm64 iPhone simulators with iOS 26.0, 27.0 and Duo 27.1, using Xcode 27.1. Other runtimes, Intel and iPad are unverified. Individual Home Screen widgets are supported; stacks, Lock Screen widgets and physical devices are outside scope.
