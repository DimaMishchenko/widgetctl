# Performance measurements

From the repository checkout (with development dependencies installed), run on an explicitly owned, already booted simulator, with one controller worker at a time:

```sh
SIMULATOR_UDID='YOUR_OWNED_BOOTED_SIMULATOR_UUID' \
BENCHMARK_SAMPLES=5 \
BENCHMARK_OUTPUT=.local/benchmark \
npm run benchmark
```

Each invocation prints a fresh `BENCHMARK_OUTPUT/<run-UUID>/results.json` progress path before preflight. Existing run reports are preserved. The report includes host CPU/OS/architecture, Xcode and Node versions, simulator runtime, exact timing definitions, successful raw samples, median and observed maximum. A p95 is included only with at least 20 successful samples. Five samples are an exploratory baseline; their maximum is not a p95 estimate. Counts are bounded to 1–100. Per-operation backend phase timings (seconds) are retained separately from public-call wall time. Failed operations are recorded separately, and an incomplete run remains marked incomplete. Failures retain stable `classifyError` codes and safe error names, without messages, parameter values or native error payloads. A primary failure and a cleanup failure are recorded separately.

Each cold prepare uses a newly created state directory, forcing a fresh worker compile. This is **not** a machine-cold measurement: compiler, SDK and filesystem caches remain intact. Ready prepare uses the active worker. Cached prepare follows release using that sample's compiled-worker cache. Catalog runs with a ready worker. Release itself is not included in those timings. All metadata subprocesses have a 15-second deadline and run before controller setup. The script releases the active worker in `finally`, including failed setup, and retains its state directory inside the unique run folder for diagnosis. SIGINT requests cancellation at checkpoints: the active operation finishes before release. Cancellation exits 130 only when cleanup succeeds; cleanup failure exits 1 and remains explicit in the report. Force-kill and host termination cannot run cleanup.

To measure a real widget, set `WIDGET_ICON_IDENTIFIER` to an exact existing widget ID. This adds configuration description timing. Add `WIDGET_PARAMETER_KEY` and optionally `WIDGET_SEARCH` for a real entity query. Canonical draft and expected guards are supplied. A failed query ends the run; it is never reported as a successful latency sample.

Save timing is opt-in. Set `BENCHMARK_SAVE=1` with that exact widget ID to measure an **unchanged** canonical apply guarded by the exported original configuration. No parameter values change, no widget is created or removed, and submitted writes are never retried. This measures the full native save/verification path without choosing arbitrary application data. Independently verify rendered changes and restoration with an app-specific acceptance check.

## Baseline and budgets

The completed 2026-10-29 stable-source run used Apple M2 Pro / 16 GiB, macOS kernel 25.6.0, Node 26.3.0, Xcode 27.1 (27A9275), and an owned iPhone 18 Pro / iOS 27.0 (24A434) simulator with independently developed CurrencyCash. Every operation completed five samples; there were no failures. The source fingerprint was `12db28c8d99cfb3d601b1cbc956377b8a089fc988a9db06bcef008484202abc4`.

| Operation | Successful n | Median | Observed maximum |
| --- | ---: | ---: | ---: |
| Cold prepare | 5 | 10.85 s | 11.20 s |
| Ready prepare | 5 | 1.08 s | 2.43 s |
| Cached prepare after release | 5 | 12.61 s | 13.71 s |
| Catalog | 5 | 1.58 s | 1.61 s |
| Describe configuration | 5 | 1.40 s | 1.58 s |
| Currency base query, USD search | 5 | 1.89 s | 2.22 s |
| Unchanged guarded save | 5 | 1.70 s | 1.85 s |

Five samples establish a small observed baseline, not a reliable p95. Raw samples, backend phase timings and build metadata are retained in `.local/next-review/benchmark-final/9242bae8-7ba5-4275-93ed-d90a5e31884c/results.json`. A previous mixed-build run timed out waiting for a helper heartbeat; it remains failed exploratory evidence and is excluded from this baseline. The runner now rejects source changes during measurement.

The compiled cache did not make re-injection faster in this run. Restart/readiness costs dominate setup. Keeping a helper ready avoids a median 11.53 seconds compared with releasing and preparing again; this supports the persistent guided-session design. It is not a claim that every operation is 12 times faster.

Use these same-environment investigation budgets:

| Median timing | Absolute review threshold |
| --- | ---: |
| Cold or cached prepare | 20 s |
| Ready prepare | 3 s |
| Catalog or describe | 3 s |
| Entity query | 4 s |
| Guarded save | 3 s |

Investigate a median that exceeds **both twice its matching baseline and its absolute threshold**, and investigate every heartbeat/cleanup failure. These are review triggers, not cross-machine CI timeouts or provider guarantees. Repeat with the same hardware/runtime, comparable app/provider state and sufficient samples before enforcing an automated latency gate.

Treat simulator startup, compilation, SpringBoard injection and native entity-provider timing as environment-dependent. Compare regressions on the same host/runtime/build and sample definitions. Do not turn one machine's native wall-clock sample into a universal CI timeout. For deterministic host-only work, keep functional tests separate from live latency budgets; mocked operations do not measure native performance.

`npm run test:performance` typechecks the contributor script and checks statistics, cancellation, failure manifests and cleanup using injected operations. CI runs this deterministic gate; it does not run simulator benchmarks.
