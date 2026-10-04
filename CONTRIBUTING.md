# Development

`src/backend*.ts` owns simulator commands, locking, compilation, the native protocol and persisted-state verification. `native/worker.m` owns ABI-checked SpringBoard operations. The controller exposes typed widget handles; the CLI and optional Playwright fixture use those same operations.

Keep app identifiers and test-runner dependencies out of the backend. JSON configuration is opaque app-owned data; do not discard unknown fields or synthesize incomplete entities. Every mutation must validate its exact target first, then verify persisted identity and preservation of unrelated Home entries. A submitted private call is not proof of success.

Run `npm test` and `npm run test:playwright`. Tests cover host state validation, protocol errors, locking, controller lifecycle and CLI/package behavior. They do not prove private APIs work on a simulator.

For native verification, install your fixture app on an owned booted simulator, then run:

```sh
WIDGETCTL_UDID=<uuid> WIDGETCTL_EXTENSION=<bundle-id> \
WIDGETCTL_KIND=<kind> WIDGETCTL_SIZE=small npm run test:live
```

The live smoke check ensures/reveals a widget, exports and reapplies its complete configuration, and unloads in `finally`. It leaves the widget installed. Separately verify visible data with your native UI driver. Record OS/Xcode/architecture and timings when adding runtime support. Stop only owned helpers; never restart global simulator services.
