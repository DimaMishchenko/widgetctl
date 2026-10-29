# Development

`src/backend*.ts` owns simulator commands, locking, compilation, the native protocol and persisted-state verification. `native/worker.m` owns ABI-checked SpringBoard operations. The typed controller serves the CLI, MCP server and optional Playwright fixture.

Keep app identifiers and test-runner dependencies out of the backend. Configuration is opaque app-owned JSON; preserve unknown fields and complete entities. Validate the exact target before a mutation and verify persisted identity and unrelated Home entries afterward. A submitted private call is not proof of success.

Device locks serialize individual operations, not test runs. Each runner owns one explicit UDID. Commands bind to a worker PID and identity; lock loss fences later operations, though a submitted call may already have completed.

## Checks

```sh
npm ci
npm test
npm run test:playwright
npm run test:examples
npm run test:performance
npm run format:check
```

Host tests cover validation, protocol errors, locking, lifecycle, CLI/MCP and package consumers. `test:examples` checks public-package imports, types and shell syntax. These checks do not establish private API support.

After CLI, MCP, native source, dependency or version changes, run `npm run build:plugin` and include the generated resources under `skills/widgetctl`. Do not edit generated runtime files directly. `npm test` and `npm run pack:plugin` reject stale bundles.

## Native verification

Build and install the [fixture apps](https://github.com/DimaMishchenko/widgetctl/tree/main/test/fixtures/apps) on an explicitly owned, booted simulator. Launch each app once to register its widgets. For a quick smoke test:

```sh
WIDGETCTL_UDID='YOUR_OWNED_BOOTED_SIMULATOR_UUID' \
WIDGETCTL_EXTENSION='YOUR_EXTENSION_BUNDLE_ID' \
WIDGETCTL_KIND='YOUR_WIDGET_KIND' WIDGETCTL_SIZE=small npm run test:live
```

This ensures/reveals a widget, exports and reapplies unchanged configuration, and releases in `finally`; it leaves the widget installed. For full acceptance, run the [two-app fixture example](examples/README.md#reproduce-the-native-acceptance-checks) and inspect before/edited/restored screenshots. Run an independent app check when changing metadata/query support; fixture success alone does not establish compatibility with other apps.

Use an exact installed icon identity and a fresh export as the expected guard for writes. Applying settings may rotate configuration identities: restore original parameters into the **current** exported envelope, guarded by that current export. Never guess entities from display labels. Treat absent fields, null, unsupported representations and empty queries as distinct outcomes.

Preserve unrelated widgets/icons and verify their identities after cleanup. Prepare before connecting native UI drivers; close drivers before release. Release even when preparation fails. Stop only owned helpers/devices; never restart global simulator services. Record OS/build, Xcode, architecture and actual rendered outcomes when extending support.

## Performance

Benchmark on an owned, booted simulator, with one worker:

```sh
SIMULATOR_UDID='YOUR_OWNED_BOOTED_SIMULATOR_UUID' \
BENCHMARK_SAMPLES=5 BENCHMARK_OUTPUT=.local/benchmark npm run benchmark
```

Each invocation retains a unique run directory, raw samples, environment and phase timings. Five samples provide a median and observed maximum; p95 requires at least 20. Cold prepare forces worker compilation but does not clear machine caches. Ready prepare reuses the active worker; cached prepare measures preparation after release. Compare the same host, runtime, app state and source. Investigate every heartbeat or cleanup failure.

Set `WIDGET_ICON_IDENTIFIER` for configuration description, plus `WIDGET_PARAMETER_KEY` and optional `WIDGET_SEARCH` for an entity query. `BENCHMARK_SAVE=1` opts into an unchanged guarded save on that exact icon. This measures the save path; verify rendered changes separately. The script releases in `finally`, retains failed/incomplete reports and rejects source changes during measurement. `npm run test:performance` checks deterministic statistics, cancellation and cleanup without a simulator.

## Demo and release

The README GIF shows real CLI output beside a complete simulator screen. `scripts/render-demo.py` takes a terminal recording and `--empty-simulator`, `--added-simulator`, `--edited-simulator`, `--removed-simulator` captures. Record Add → Edit → Remove on an owned disposable simulator, retain source captures as evidence, inspect key frames, and keep playback below 30 seconds (enforced by the renderer). Python/Pillow and macOS fonts are rendering tools, not runtime dependencies.

Consumer commands live in [usage](docs/usage.md) and [runnable examples](examples/README.md). Follow the single [release workflow](docs/distribution.md#publish-a-new-version) for final-artifact acceptance, publication and recovery.
