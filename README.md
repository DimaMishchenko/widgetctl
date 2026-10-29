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

Choose an action, explicitly select your simulator, and confirm ownership before its UI restarts. Search installed apps, widget kinds and sizes, or choose an existing widget by exact identity and Home position. Each command prepares and releases its helper automatically, including failures and cancellation.

The editor stages parameter changes, shows a diff, and asks before saving. Advertised enum/entity choices retain their complete values. Optional fields offer explicit null or removal while preserving the difference between null and an absent parameter. Unsupported fields remain read only; unavailable choice discovery offers an explicit JSON fallback with its reason. Keep entity metadata when editing JSON.

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

[Usage guide](docs/usage.md) · [Runnable examples](examples/README.md) · [Release checklist](docs/release-checklist.md) · [Contributing](CONTRIBUTING.md)
