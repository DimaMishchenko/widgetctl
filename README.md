![Add and edit a widget with widgetctl](docs/assets/usage.gif)

# widgetctl

**Set up iOS Simulator widgets without clicking through the widget gallery.**

Pick an app, widget and size in your terminal. Edit its settings, reproduce a test setup, or automate it from TypeScript and Playwright.

[![Tests](https://github.com/DimaMishchenko/widgetctl/actions/workflows/test.yml/badge.svg)](https://github.com/DimaMishchenko/widgetctl/actions/workflows/test.yml) [![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install

Requires **macOS, Node 22.14+ and full Xcode**. Install your app on a simulator and open it once so its widgets can register.

Until the first npm release, install from GitHub:

```sh
npm install --save-dev github:DimaMishchenko/widgetctl
```

Pin `github:DimaMishchenko/widgetctl#COMMIT_SHA` in automated tests. [Release and distribution plan →](docs/distribution.md)

## CLI

```sh
npx --no-install widgetctl
```

Choose your simulator, then **Add widget** or **Edit widget**. The pickers show installed apps, widget names and supported sizes. Settings stay in a draft until you choose **Save changes**. **More** holds details, import/export and diagnostics.

For scripts and agents, use explicit arguments and `--json`:

```sh
npx --no-install widgetctl devices --json
npx --no-install widgetctl catalog --device "$SIMULATOR_UDID" --json
npx --no-install widgetctl add --device "$SIMULATOR_UDID" \
  --app com.example.weather --kind Forecast --size medium --json
```

Set `SIMULATOR_UDID` to your reserved, booted simulator and replace the example app/kind with values from `catalog`. JSON mode never prompts. [CLI and configuration guide →](docs/usage.md)

## TypeScript

Use identifiers from your app’s catalog:

```ts
import { createWidgetController } from "widgetctl";

const widgets = createWidgetController({ udid: process.env.SIMULATOR_UDID! });
try {
  await widgets.prepare();
  const widget = await widgets.ensure({
    extension: "com.example.weather.widgets",
    kind: "Forecast",
    size: "medium",
  });
  console.log(widget.iconIdentifier);
} finally {
  await widgets.release();
}
```

`ensure` reuses a matching widget. Handles can export, describe and apply supported configurations, or remove that exact widget. [API examples →](examples/README.md)

## Playwright

Install the optional test runner with `npm install --save-dev @playwright/test`. The fixture prepares and releases widgetctl for you.

```ts
import { test, expect } from "widgetctl/playwright";

test("forecast widget is configured", async ({ widgets }) => {
  const widget = await widgets.ensure({
    extension: "com.example.weather.widgets",
    kind: "Forecast",
    size: "medium",
  });
  const settings = await widget.exportConfiguration();
  const applied = await widget.applyConfiguration(settings);
  expect(await widget.exportConfiguration()).toEqual(applied);
});
```

Set `workers: 1` and `use.widgetctlOptions.udid` in your [Playwright config](examples/playwright/playwright.config.ts). This checks saved configuration; use a native UI driver to assert rendered content. A browser `page` cannot control the Home Screen.

## Agent skill and plugins

The short [widgetctl skill](skills/widgetctl/SKILL.md) teaches agents when to use the tool, JSON discovery, safe configuration edits and simulator ownership.

Add this repository as a Codex marketplace:

```sh
codex plugin marketplace add DimaMishchenko/widgetctl
```

Then install **widgetctl** from that marketplace in the desktop Plugins directory. The plugin supplies instructions; install the CLI in your project separately using the command above. [Codex, Claude Code and skill-only setup →](docs/agents.md)

## Support

Experimental; uses Apple private APIs. Live coverage includes arm64 iPhone simulators on **iOS 26.0, 27.0 and Duo 27.1**. Other runtimes, iPad and Intel are unverified. Physical devices, stacks and Lock Screen widgets are unsupported.

Reserve one simulator per worker. Preparation and release may restart its Home Screen. Always release in `finally`, and connect native UI drivers after preparation.

[Usage](docs/usage.md) · [Examples](examples/README.md) · [Troubleshooting](docs/errors.md) · [Compatibility](docs/compatibility.md) · [Performance](docs/performance.md) · [Contributing](CONTRIBUTING.md)
