# Development

`src/backend*.ts` owns simulator commands, locking, compilation, the native protocol and persisted-state verification. `native/worker.m` owns ABI-checked SpringBoard operations. The controller exposes typed widget handles; the CLI and optional Playwright fixture use those same operations.

Keep app identifiers and test-runner dependencies out of the backend. JSON configuration is opaque app-owned data; do not discard unknown fields or synthesize incomplete entities. Every mutation must validate its exact target first, then verify persisted identity and preservation of unrelated Home entries. A submitted private call is not proof of success.

Device locks serialize individual operations, not entire test runs. Each runner must own its simulator. Commands bind to one worker PID, identity and UDID. Lock loss fences later operations and fails explicitly; an already submitted native call may have completed.

Run `npm test` and `npm run test:playwright`. Tests cover host state validation, protocol errors, locking, controller lifecycle and CLI/package behavior. They do not prove private APIs work on a simulator.

For native verification, install your fixture app on an owned booted simulator, then run:

```sh
WIDGETCTL_UDID=<uuid> WIDGETCTL_EXTENSION=<bundle-id> \
WIDGETCTL_KIND=<kind> WIDGETCTL_SIZE=small npm run test:live
```

The live smoke check ensures/reveals a widget, exports and reapplies its unchanged complete configuration, and unloads in `finally`. It leaves the widget installed. Separately change a parameter and verify its visible result, then restore it. Record OS/Xcode/architecture and timings when adding runtime support. Stop only owned helpers; never restart global simulator services.
