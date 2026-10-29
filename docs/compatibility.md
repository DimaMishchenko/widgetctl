# Independent app compatibility

Fixture tests establish deterministic contracts. Independently developed apps are a separate acceptance check, and a successful catalog call alone does not establish configuration or rendered-outcome support.

The 2026-10-29 experiment used an exclusively owned iPhone 18 Pro simulator on iOS 27.0, arm64, with Xcode 27.1. Currency and Routine were installed from existing local simulator **app bundles only**. Their source and original simulator data were not changed or copied. Containers were launched before querying descriptors.

Currency registered five widgets (Currency Calculator, Know Your Cash, Pocket Rate, Mental Math, Currency board). Its compiler metadata independently supplies dynamic currency entities, optional arrays and an optional calculator-instance entity. Routine's available local build contained a test plugin but no WidgetKit extension, so it supplies no widget compatibility evidence. Apple system widgets were also discovered, but their discovery is not evidence that their configuration intents are supported.

Initial results are retained in `.local/next-review/independent-results.json`, with catalog, bundle-provenance brief and PNG captures alongside it. CurrencyBoard and CurrencyCash both succeeded through ensure, canonical export, metadata description and real rendering. The board rendered EUR 1, USD 1,12, GBP 0,84 and CZK 24,39 with native `en_UA` decimal-comma formatting. Board's optional `currencies` was absent; Cash's optional `instance` was present. Both states were preserved in canonical exports.

All tested dynamic entity queries (Board base/currencies and Cash base/comparison/instance) initially failed with `LNContextErrorDomain` code 2002, `LNPerformActionErrorCodeActionNotFound`. No entity write or arbitrary fallback was attempted after those failures. This led to the routing fix described below. Currency's intent metadata exists only in the widget extension, not in its container. This is an independently found routing/compatibility case that the fixtures did not establish.

The initial field and enum labels exposed resource keys such as `baseParameter`, `currenciesParameter` and `selectedList` despite installed English/Ukrainian/Russian `Widgets.strings` resources. The label resolver now reads the exact installed extension's explicit localized string table, falls back to the compiler default then resource key, and keeps canonical values untouched. Offline verification against those real installed files resolved `en_UA` labels to Base/Amount/Currency list and Custom list/Default; `uk_UA` resolved Список валют and Вибрані валюти while falling back to compiler English defaults for missing Ukrainian entries. Results are in `.local/next-review/localized-label-results.json`. Tests also cover binary tables, missing resources and traversal/symlink rejection. No device language was changed. Native integration now passes the actual simulator locale to the resolver, and Currency’s live field labels read Base/Amount/Currency list/Currencies and Base/Comparison/Calculator.

Both temporary widgets were removed by exact IDs. Installed-widget snapshots before and after matched exactly. The separate benchmark also exercised three successful unchanged expected-guarded saves on a task-created board; these establish save-path timing, not rendered value-change acceptance.

## Verified after the fixes

Apple returned Currency action metadata through its container-app lookup, while that metadata’s `effectiveBundleIdentifier` named the widget extension. Routing now uses this validated effective identifier; only the exact container or extension is accepted.

| Case | Observed result |
| --- | --- |
| Currency board base/currency arrays | Refined USD search returns three canonical choices; empty lists exceeding 128 choices report `UNSUPPORTED_CHOICES` and can be refined. |
| Know Your Cash base/comparison | Refined USD search returns one choice. A real USD change renders, and restoring CZK reproduces the original visible values. |
| Optional calculator instance | No saved calculators produces an empty result. Clearing the optional field and restoring it preserves the original intent. |
| Stale expected parameters | Both widgets reject with `STALE_CONFIGURATION`, without changing saved values. |
| Apple Reminders | Medium widget renders “No Reminders”; configuration export reports `UNSUPPORTED_CONFIGURATION` for its legacy intent representation. |
| Fresh Garden fixture regression | Suggestions return three, filtered search one, and a staged dependency narrows to one without saving. |

The native contract harness covers aggregated metadata routing, allowed app/extension targets and foreign-bundle rejection. Live smoke passes. Before/after installed-widget identities match, and all temporary probe widgets were removed. Raw local evidence is under `.local/next-review/native-routing-*.json` with `routing-*.png` captures.

Applying configuration can rotate its instance identifier. For restoration, export the current envelope and put the original parameters into that envelope; guard the save with the current export. Reusing an old complete envelope correctly reports `IDENTITY_MISMATCH`.

## Repeating the check

Use an explicitly owned simulator. Install an unchanged independent app bundle with `xcrun simctl install "$SIMULATOR_UDID" /path/to/App.app`, then launch its container. Use `catalog()` to discover actual kind and family identifiers. Snapshot `installedWidgets()` before creating anything. Export the canonical configuration, call `describeConfiguration()`, and query supported entity fields with both an empty search and a targeted search. Preserve the expected canonical configuration for every write.

Keep absent optional fields distinct from explicit null and present values. Treat unsupported metadata, legacy SiriKit intents, empty results and query failures as recorded outcomes; do not invent choices or infer a valid entity from a display label. For localization, compare metadata resource keys separately from resolved native entity labels. Capture the rendered widget after a successful change and restoration. Finally restore original parameters, remove only exact widget IDs created by the check, and release the controller even after setup failure.
