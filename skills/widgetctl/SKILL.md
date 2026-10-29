---
name: widgetctl
description: Add, find and configure individual iOS Simulator Home Screen widgets for tests using the local widgetctl CLI, TypeScript API or Playwright fixture.
---

# widgetctl

Use widgetctl for deterministic widget setup, exact identities and saved configuration readback. Use a native UI driver for visible content and interaction assertions; Playwright's browser page cannot control the Home Screen. Stacks, Lock Screen widgets and physical devices are unsupported.

## Start

Requires macOS, Node 22.14+, full Xcode and an installed widget app. Launch the containing app once before catalog discovery. The plugin and standalone skill include a self-contained CLI; no separate npm install is needed for agent CLI operations.

Resolve this skill's directory and set `WIDGETCTL` to the absolute path of `scripts/widgetctl.mjs` inside it. Run `node "$WIDGETCTL" --help` and `node "$WIDGETCTL" doctor --json`. The bundled CLI requires Node 22.14+ but installs no packages and changes no global PATH. Use it for the commands below. For TypeScript or Playwright imports in a project, install `widgetctl` (and `@playwright/test` for the fixture) as project dev dependencies and preserve the lockfile.

Reserve one simulator per worker and use its explicit, already booted UDID. Preparation and release can restart that simulator's Home Screen. Connect native UI drivers after preparation and close them before release. Never restart global simulator services or remove another owner's locks.

## Choose the interface

For individual operations, use CLI commands with `--json` (no prompts). Examples below use the bundled CLI. Discover actual values rather than guessing bundle IDs, kinds, sizes or widget identities:

```sh
node "$WIDGETCTL" devices --json
node "$WIDGETCTL" catalog --device "$SIMULATOR_UDID" --json
node "$WIDGETCTL" add --device "$SIMULATOR_UDID" \
  --app "$APP_BUNDLE_ID" --kind "$WIDGET_KIND" --size medium --json
node "$WIDGETCTL" list --device "$SIMULATOR_UDID" --json
```

CLI operations prepare and release automatically. For repeated operations under one native driver connection, prefer the TypeScript lifecycle or the `widgetctl/playwright` fixture. Keep `prepare()` inside `try` so even setup failures release:

```ts
import { createWidgetController } from "widgetctl";

const widgets = createWidgetController({ udid: process.env.SIMULATOR_UDID! });
try {
  await widgets.prepare();
  console.log(await widgets.catalog());
} finally {
  await widgets.release();
}
```

## Configure and verify

- Capture `iconIdentifier` from add/list; target that exact icon for export, configure and remove. Add reuses a matching widget. Use `--replace` or `--exclusive` only when the task calls for replacing identities or removing other widgets.
- CLI automation uses `export --widget "$WIDGET_ICON" --file widget.json`, edits the complete envelope, then `configure` with the same arguments; include `--device` and `--json`. `edit` is interactive only. Export fresh before each later change because saving can rotate instance identities.
- Preserve unknown fields, entity metadata, absent versus null parameters and native numeric representations. Use API `describeConfiguration()` and `configurationChoices()` to discover editable fields and canonical choices; never invent an entity from its display label. Prefer `updateConfiguration()` or `applyConfiguration(draft, { expected: original })` for guarded API edits.
- Inspect JSON `code`, `recovery` and current saved state after errors. A failed or timed-out write may already have completed; do not blindly resubmit it. Report unsupported runtime/configuration results as such.
- Verify saved readback and rendered app-specific content separately. Keep requested persistent changes. For temporary test setup, remove only test-created exact icons and restore test-edited values during cleanup.

For API signatures, Playwright fixture wiring and configuration limits, read the installed package's `docs/usage.md` and `examples/`, or the [upstream usage guide](https://github.com/DimaMishchenko/widgetctl/blob/main/docs/usage.md) matching the installed revision.
