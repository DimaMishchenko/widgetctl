# Using widgetctl

widgetctl manages individual Home Screen widgets on an explicitly owned iOS simulator. It verifies saved identities and supported configuration readback. Check rendered content separately with your native UI driver.

## Choose a simulator

Use macOS, Node 22.14+, full Xcode, and an installed widget app. Launch the app once so its widget descriptors can register.

```sh
npx widgetctl devices --json
```

Interactive mode shows simulator names, iOS versions and running state. Select a simulator reserved for your session. One confirmation covers booting it if needed and briefly restarting its Home Screen for the helper. Decline to return or press Ctrl-C to exit. Duplicate names gain a distinguishing suffix; routine menus omit UUIDs.

Scripts must pass an already booted UUID using `--device`. To boot one yourself:

```sh
export SIMULATOR_UDID='YOUR_OWNED_SIMULATOR_UUID'
xcrun simctl boot "$SIMULATOR_UDID"
xcrun simctl bootstatus "$SIMULATOR_UDID" -b
```

Skip `boot` if already booted. Reserve one simulator per worker. Locks serialize individual operations; they do not reserve the simulator for your entire suite. Never restart global simulator services to recover a task.

## Guided terminal workflow

```sh
npx widgetctl
```

The main menu offers **Add widget**, **Edit widget**, **Remove widget**, **More**, **Change simulator** and **Exit**. Under **More**, choose **Browse widgets**, **Installed widgets**, **Widget details**, **Import configuration**, **Export configuration** or **Diagnostics**.

Add walks through installed apps, widget kinds and supported sizes. A step with only one choice is skipped. Use arrows for short lists; lists longer than ten entries let you type to search. Back returns to the preceding choice. Existing widgets appear by app, widget name and size. Duplicates show their Home Screen location and, when needed, a short distinguishing suffix. **Widget details** exposes the exact identifiers for troubleshooting or scripts.

The editor stages changes and shows them beside each field:

```text
Edit widget configuration
  City: Prague → London
  Show forecast: On
  Advanced…
  Back
❯ Save changes · 1
```

**Save changes · N** applies the displayed draft immediately. **Back** asks before discarding unsaved changes. Boolean, text and numeric fields use typed prompts. Advertised enum and entity choices retain their complete values; entity lists support multiple selections. Native choices come from the installed app’s query service and receive the staged draft, so dependent choices follow earlier edits. Accepting an existing multiline value preserves it exactly.

**Advanced…** contains raw JSON editing and, for optional fields, explicit null and parameter removal. Null and an absent parameter remain distinct. Keep entity metadata when editing JSON. Unsupported fields stay read only with a reason; unavailable choice discovery explains the limit and offers Advanced where safe.

Guided mode returns to the menu after each action and keeps the selected simulator and helper ready. After a recoverable failure, the helper may need preparation again; session consent remains valid for the selected simulator. **Change simulator** releases the previous helper and starts a new selection. **Exit** and Ctrl-C release it. Widgets remain installed.

Set `NO_COLOR=1` to disable color. Use `WIDGETCTL_NO_EMOJI=1` for plain symbols; `TERM=dumb` also selects this fallback. Narrow terminals shorten labels to fit. Recoverable errors show a short message and next step; **More → Last error details** retains the complete message and recovery guidance.

Explicit CLI commands prepare and release automatically, including failed preparation. `devices` and `list`, plus guided **Widget details**, read existing state without injecting a helper. Preparation and release may restart the selected simulator's Home Screen. Connect drivers after preparation and close them before release. For several operations under one driver connection, use the TypeScript API or Playwright fixture.

## Scripts and agents

Use `--json` for one JSON result on stdout, with `schemaVersion: 1`, `status`, and operation data or an `error`. Failures also include a stable `code`, human-readable `recovery` steps and `retryable`. Match codes, not English messages; a submitted mutation is never automatically retried. See [diagnostics and error codes](errors.md). JSON mode never prompts, even in a terminal. Without a terminal, missing required arguments fail with usage guidance. Plain terminal output is intended for humans.

Opaque diagnostic integers outside JSON's number representation use `{"$bigint":"9223372036854775809"}` to preserve their exact value. Canonical configuration exports still require finite JSON values.

```sh
npx widgetctl catalog --device "$SIMULATOR_UDID" --json
npx widgetctl add --device "$SIMULATOR_UDID" \
  --app 'YOUR_APP_BUNDLE_ID' --kind 'YOUR_CATALOG_KIND' --size medium --json
npx widgetctl list --device "$SIMULATOR_UDID" --json
```

`catalog` groups descriptors under installed app names and bundle identifiers. Use `--extension` when an app has several extensions with the same kind. The requested app, extension, kind and size must resolve to exactly one descriptor. `add` reuses a matching widget or creates one; ambiguity fails instead of choosing an existing duplicate. A verified result proves saved identity and placement, not the currently visible Home Screen page; JSON reports `visibility: "unverified"`.

Capture `iconIdentifier` from `add` or `list`, then target that identity:

```sh
export WIDGET_ICON='YOUR_EXACT_ICON_UUID'
npx widgetctl export --device "$SIMULATOR_UDID" \
  --widget "$WIDGET_ICON" --file widget.json --json
npx widgetctl configure --device "$SIMULATOR_UDID" \
  --widget "$WIDGET_ICON" --file widget.json --json
npx widgetctl remove --device "$SIMULATOR_UDID" \
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

`ensure(target)` adds or reuses a matching widget and returns an exact handle. Presentation is requested asynchronously; use a native driver to verify the exact widget is visible. `position: "top"` refers to its current page, not the first Home Screen page. `getWidget(iconIdentifier)` binds an existing icon without adding or revealing it. A stale exact handle fails rather than selecting a replacement.

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
| `widget.reveal()`                                    | Request presentation; verify saved identity, not visible page |
| `widget.remove()`                                    | Verify removal of the exact saved widget                     |

Only `udid` is required to create a controller. Advanced options include `stateDirectory`, `architecture`, `launchDomain`, and `onResult`. Keep logging callbacks nonthrowing: a logging failure cannot undo an operation.

## First-launch readiness

After launching a newly installed app and preparing your owned session, its descriptors may still be registering. Wait for the exact descriptor before calling `ensure` once:

```ts
const target = {
  container: "com.example.weather",
  extension: "com.example.weather.widgets",
  kind: "Forecast",
  size: "medium" as const,
};
await widgets.waitForWidgetDescriptor(target, { timeoutMs: 30_000 });
const widget = await widgets.ensure(target);
```

Pass an optional `signal: AbortSignal` to cancel the wait. The wait polls successful catalogs missing that exact app/extension/kind/size. Errors and ambiguity fail immediately. It uses the prepared helper without launching apps or recovering a lost session. The deadline includes queued and in-flight catalog work; late success is rejected. Cancellation and timeout drain an active read before cleanup, so settlement can exceed the requested budget.

To verify presentation after placement, use a native UI driver to find the exact widget and observe the relevant Home Screen page. A saved-position check or submitted reveal request does not establish visibility.

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

For independent-app checks and performance measurements, see [contributing](../CONTRIBUTING.md).
