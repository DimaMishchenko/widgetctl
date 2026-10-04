# widgetctl

Fast, programmatic Home Screen widget setup for iOS Simulator tests. Use the TypeScript API, CLI or Playwright fixtures. No AI, global installation or app code changes required.

Requires **macOS, Node 22.12+, Xcode**, an installed app with widgets, and an explicitly owned, already booted iOS simulator.

## Install

Until the [npm release](https://github.com/DimaMishchenko/widgetctl/issues/1), install from GitHub:

```sh
npm install --save-dev github:DimaMishchenko/widgetctl
```

Commit the lockfile; pin a commit SHA in `package.json` for reproducible setup.

## TypeScript

```ts
import { createWidgetController } from 'widgetctl';

const widgets = createWidgetController({ udid: process.env.SIMULATOR_UDID! });
try {
  await widgets.prepare(); // Before connecting your UI driver.
  const widget = await widgets.ensure({
    extension: 'com.example.app.widgets',
    kind: 'ExampleWidget',
    size: 'medium',
  }, { position: 'top' });

  const parameters = await widget.parameters();
  await widget.updateConfiguration(parameters => {
    parameters.amount = '42';
  });
  // Use your UI driver to assert the rendered data and interactions.
} finally {
  await widgets.release();
}
```

`ensure` reuses an existing widget by default. Pass `replace: true` for fresh identities, or `exclusive: true` to remove other widgets of the **same extension**. Handles support `reveal()`, `remove()`, `parameters()`, `exportConfiguration()` and `applyConfiguration()`. `release()` unloads the helper and leaves widgets installed.

Configuration parameters are the widget's full canonical AppIntent dictionary. Their shape is app-specific; preserve entity metadata and unknown fields. Exported envelopes bind to one current device/widget instance. Re-export after native edits; use the returned envelope after applying a change.

## CLI

```sh
npx widgetctl prepare --device "$UDID"
npx widgetctl ensure --device "$UDID" \
  --extension com.example.app.widgets --kind ExampleWidget --size medium
npx widgetctl export --device "$UDID" \
  --extension com.example.app.widgets --kind ExampleWidget --size medium --file widget.json
npx widgetctl release --device "$UDID"
```

Run `npx widgetctl --help` for configuration, removal and targeting options. Commands return JSON with status, timings and errors. Exit codes: **0** success, **1** operation failure, **2** invalid input or unverified persisted outcome.

## Playwright

Install `@playwright/test` alongside widgetctl, then use its optional binding:

```ts
import { test, expect } from 'widgetctl/playwright';

test.use({ widgetctlOptions: { udid: process.env.SIMULATOR_UDID! } });

test('widget data', async ({ widgets }) => {
  const widget = await widgets.ensure({
    extension: 'com.example.app.widgets', kind: 'ExampleWidget', size: 'small',
  });
  expect((await widget.exportConfiguration()).intent.parameters).toBeDefined();
});
```

Set `workers: 1` in `playwright.config.ts` for **one worker per simulator**. The fixture prepares once per worker, before test fixtures connect UI drivers, and releases in teardown. To combine with your existing fixtures, extend your base test with `widgetFixtures` from `widgetctl/playwright`. Playwright's browser APIs do not themselves drive native widget UI; bring your native driver for rendering and interaction assertions. Other runners can use the same TypeScript API in setup/teardown hooks.

## Support

Experimental private SpringBoard APIs, validated on **arm64 iPhone / iOS 27**. Other runtimes, iPad, Intel and Lock Screen widgets are unverified. Cold preparation may restart only the selected simulator's SpringBoard; warm commands reuse the compiled worker and live session. Prepare before establishing automation handles.

The helper verifies persisted identities and configuration readback. Rendering, native Edit Widget controls and app behavior require separate tests. Unsupported APIs and ambiguous targets fail explicitly. No physical devices or global simulator services are modified.

## Development

```sh
npm ci
npm test
npm run test:playwright
```

Host tests run without a simulator. See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture and native verification.
