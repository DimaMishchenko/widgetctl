---
name: widgetctl
description: Add, find and configure individual iOS Simulator Home Screen widgets for tests using the local widgetctl CLI, TypeScript API or Playwright fixture.
---

# widgetctl

Use widgetctl for deterministic widget setup, exact identities and saved configuration readback. Use a native UI driver for visible content and interaction assertions; Playwright's browser page cannot control the Home Screen. Stacks, Lock Screen widgets and physical devices are unsupported.

## Start

Requires macOS, Node 22.14+, full Xcode and an installed widget app. Launch the containing app once before catalog discovery. The plugin supplies this skill, not the executable.

For a project install use `npx widgetctl --help`; for a global install use `widgetctl --help`. If absent and setup is requested, run `npm install --save-dev widgetctl` and preserve the lockfile. Use `widgetctl@0.1.0` for a reproducible release install. A standalone global CLI install is also supported; TypeScript and Playwright imports need a project dependency. Run `npx widgetctl doctor --json` to check the host without changing it.

Reserve one simulator per worker and use its explicit, already booted UDID. Preparation and release can restart that simulator's Home Screen. Connect native UI drivers after preparation and close them before release. Never restart global simulator services or remove another owner's locks.

## Choose the interface

For individual operations, use CLI commands with `--json` (no prompts). Examples below use the project-local CLI; use `widgetctl` instead of `npx widgetctl` after a global install. Discover actual values rather than guessing bundle IDs, kinds, sizes or widget identities:

```sh
npx widgetctl devices --json
npx widgetctl catalog --device "$SIMULATOR_UDID" --json
npx widgetctl add --device "$SIMULATOR_UDID" \
  --app "$APP_BUNDLE_ID" --kind "$WIDGET_KIND" --size medium --json
npx widgetctl list --device "$SIMULATOR_UDID" --json
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
