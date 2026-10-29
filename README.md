# widgetctl

Add, find and configure Home Screen widgets on iOS Simulator from a terminal, TypeScript, or Playwright. widgetctl verifies saved state; use your native UI driver to verify what the widget renders.

Experimental. Live coverage includes arm64 iPhone simulators on iOS 26.0, 27.0 and Duo 27.1, including native entity suggestions, search and dependent choices. Other runtimes, iPad and Intel are unverified. Stacks, Lock Screen widgets and physical devices are unsupported.

## Install

Requires macOS, Node 22.14+, full Xcode, and an installed widget app. Launch the app once so its widgets can register. Reserve one simulator per test worker.

The package is not published on npm yet:

```sh
npm install --save-dev github:DimaMishchenko/widgetctl
```

Pin a reviewed commit with `github:DimaMishchenko/widgetctl#COMMIT_SHA` and commit your lockfile for reproducible tests.

## Use the terminal

```sh
npx --no-install widgetctl
```

Choose **Add widget**, **Edit widget**, or **Remove widget**. **More** contains browsing, installed widgets, details, import/export and diagnostics. Select your simulator and approve the session, including booting it if needed and briefly restarting its Home Screen. The session keeps that simulator ready; **Change simulator**, **Exit**, or Ctrl-C releases the helper.

The editor shows current values and pending changes inline. **Save changes · N** applies the draft; **Back** asks before discarding unsaved changes. **Advanced…** offers raw JSON, explicit null and parameter removal. Use arrow keys for short lists and type to search longer lists. Set `NO_COLOR=1` to disable color or `WIDGETCTL_NO_EMOJI=1` for plain symbols.

Check your setup without changing it:

```sh
npx --no-install widgetctl doctor
```

## Use scripts and agents

Replace placeholders with values returned by `devices`, `catalog` and `list`. Supply `--json` for one structured result and no prompts. `--device` claims an explicitly owned, already booted simulator; preparation and release may restart its UI.

```sh
npx --no-install widgetctl devices --json
export SIMULATOR_UDID='YOUR_OWNED_BOOTED_SIMULATOR_UUID'
npx --no-install widgetctl catalog --device "$SIMULATOR_UDID" --json
npx --no-install widgetctl add --device "$SIMULATOR_UDID" \
  --app 'YOUR_APP_BUNDLE_ID' --kind 'YOUR_CATALOG_KIND' --size medium --json
npx --no-install widgetctl list --device "$SIMULATOR_UDID" --json
npx --no-install widgetctl export --device "$SIMULATOR_UDID" \
  --widget 'YOUR_EXACT_ICON_UUID' --file widget.json --json
```

Apply an edited complete export with `configure`, or remove an exact icon with `remove`. Run `widgetctl --help` for all options. Connect UI drivers only after preparation; use the TypeScript or Playwright lifecycle when a driver must remain connected across operations.

## Use TypeScript

```ts
import { createWidgetController } from "widgetctl";

const widgets = createWidgetController({ udid: process.env.SIMULATOR_UDID! });
try {
  await widgets.prepare();
  const catalog = await widgets.catalog();
  console.log(catalog);
  const widget = await widgets.ensure({
    extension: process.env.WIDGET_EXTENSION!,
    kind: process.env.WIDGET_KIND!,
    size: "medium",
  });
  console.log(widget.iconIdentifier);
} finally {
  await widgets.release();
}
```

[Usage guide](docs/usage.md) · [Runnable examples](examples/README.md) · [Diagnostics and errors](docs/errors.md) · [Compatibility](docs/compatibility.md) · [Performance](docs/performance.md) · [Release checklist](docs/release-checklist.md) · [Contributing](CONTRIBUTING.md)
