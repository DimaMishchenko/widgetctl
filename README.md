![Add, edit and remove a widget with widgetctl](docs/assets/usage.gif)

# widgetctl

**Set up iOS Simulator widgets without clicking through the widget gallery.**

- 🎯 Pick installed apps, widgets and sizes in your terminal
- ⚙️ Edit widget settings with typed controls and native choices
- 🤖 Give agents a skill and local MCP tools
- 🧪 Automate setup with TypeScript and Playwright
- 💾 Export and restore saved configuration

[![Tests](https://github.com/DimaMishchenko/widgetctl/actions/workflows/test.yml/badge.svg)](https://github.com/DimaMishchenko/widgetctl/actions/workflows/test.yml) [![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Requires **macOS, Node 22.14+ and full Xcode**. Install your app on a simulator and open it once so its widgets can register.

## Install

In your project:

```sh
npm install --save-dev widgetctl
npx widgetctl
```

Or install globally:

```sh
npm install --global widgetctl
widgetctl
```

## Agents

The plugin bundles the **skill, CLI and local MCP server**. Add the Codex marketplace, then install **widgetctl** from it in the desktop Plugins directory:

```sh
codex plugin marketplace add DimaMishchenko/widgetctl
```

For Claude Code:

```text
/plugin marketplace add DimaMishchenko/widgetctl
/plugin install widgetctl@widgetctl
```

For a standalone skill, use `npx skills add DimaMishchenko/widgetctl --skill widgetctl` (Node 22.20+). No separate npm installation is needed for the bundled CLI. [Agent setup and Tessl listing →](docs/agents.md)

## CLI

Choose a simulator, then **Add widget**, **Edit widget** or **Remove widget**. Pickers show app names, widgets and supported sizes. Review staged settings and choose **Save changes**. **More** includes import/export and diagnostics.

For scripts, set `SIMULATOR_UDID` to your owned, booted simulator and use app/kind values from `catalog`:

```sh
npx widgetctl catalog --device "$SIMULATOR_UDID" --json
npx widgetctl add --device "$SIMULATOR_UDID" \
  --app com.example.weather --kind Forecast --size medium --json
```

JSON mode never prompts. [CLI and configuration guide →](docs/usage.md)

## TypeScript

Use your installed widget's identifiers from the catalog:

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
  console.log(await widget.exportConfiguration());
} finally {
  await widgets.release();
}
```

`ensure` reuses a matching widget. Handles can describe, export and apply supported settings, or remove that exact widget. [Runnable API examples →](examples/README.md)

## Playwright

Install `npm install --save-dev widgetctl @playwright/test`, then use the exported fixture:

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

Set `workers: 1` and `use.widgetctlOptions.udid` in your [Playwright config](examples/playwright/playwright.config.ts). The fixture prepares and releases automatically. Saved configuration checks need a native UI driver alongside them to verify rendering. [Playwright examples →](examples/README.md#playwright)

## Local MCP

Plugins register the bundled server. For another MCP client, install globally and register `widgetctl-mcp` as a local stdio command. No account or hosted server is needed. [Configuration and tools →](docs/mcp.md)

## Support

Experimental; uses Apple private APIs. Live coverage includes arm64 iPhone simulators on **iOS 26.0, 27.0 and Duo 27.1**. Other runtimes, iPad and Intel are unverified. Physical devices, stacks and Lock Screen widgets are unsupported.

Own one simulator per worker. Preparation and release may restart its Home Screen. Release in `finally` and connect native UI drivers after preparation. For reproducible installs, pin `widgetctl@0.2.1` and keep your lockfile.

[Usage](docs/usage.md) · [Troubleshooting](docs/errors.md) · [Releases](docs/distribution.md) · [Privacy](docs/privacy.md) · [Contributing](CONTRIBUTING.md)
