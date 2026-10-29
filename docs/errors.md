# Diagnose problems

Start with a read-only check:

```sh
npx widgetctl doctor
export SIMULATOR_UDID='YOUR_OWNED_BOOTED_SIMULATOR_UUID'
npx widgetctl doctor --device "$SIMULATOR_UDID" --json
```

Replace the UUID placeholder before running the device-specific command. Doctor checks macOS, full Xcode, the simulator SDK/compiler, available runtimes and devices. With an exact device it checks boot state, whether the application registry can be read, and existing helper metadata. It never boots, injects, restarts, repairs, acquires a session lock or deletes files. Its suggested commands are guidance for you to review.

A passing check establishes only what its message says. A readable app registry does not prove a widget descriptor is registered. A lock file may remain after normal release; file presence does not mean a worker is busy. A missing helper heartbeat is normal before preparation. Warnings preserve these limits; `healthy: true` means no failed checks, not guaranteed compatibility with every private API or widget. Doctor exits 0 with no failures, 1 when checks fail, and 2 for invalid CLI arguments.

Launch the containing app once before catalog discovery. Keep one owner per simulator. Never restart global simulator services or delete someone else’s locks to recover one operation.

# Handle errors in scripts

JSON failures keep `schemaVersion: 1`, `status: "failed"` and an `error` string, and add stable codes:

```json
{
  "schemaVersion": 1,
  "status": "failed",
  "code": "STALE_CONFIGURATION",
  "error": "The widget changed since editing began",
  "recovery": ["Export the current widget again and review your changes against that snapshot before saving."],
  "retryable": false
}
```

The API throws `WidgetctlError` with the same `code`, `recovery` and `retryable` fields plus its optional backend `result`. `classifyError(error)` produces the same structured fields for logging. Backend results may contain private canonical values; do not publish them indiscriminately.

Match `code`, not message text. `retryable: true` is reserved for failed read-only provider queries; it is not an instruction to retry writes. A timed-out or unverified mutation may already have completed. Inspect current state before deciding what to do next.

| Code | Next step |
| --- | --- |
| `INVALID_INPUT` | Check arguments or the complete canonical configuration. |
| `UNSUPPORTED_HOST`, `UNSUPPORTED_RUNTIME` | Run doctor and select an appropriate macOS/Xcode/iOS environment. |
| `DEVICE_NOT_FOUND`, `DEVICE_NOT_BOOTED` | Refresh device discovery; boot only your owned device if needed. |
| `DEVICE_BUSY` | Wait for the owner. Keep its lock files intact. |
| `APP_NOT_REGISTERED` | Launch the containing app, then refresh the catalog. |
| `WIDGET_NOT_FOUND`, `AMBIGUOUS_TARGET` | Refresh installed widgets and choose an exact identity. |
| `STALE_CONFIGURATION`, `IDENTITY_MISMATCH` | Export again and review against the current exact instance. |
| `UNSUPPORTED_CONFIGURATION` | Keep unsupported fields unchanged; record the app/runtime limit. |
| `UNSUPPORTED_CHOICES` | Narrow the search or use an understood canonical JSON value. |
| `QUERY_TIMEOUT`, `QUERY_FAILED` | Retry the read-only query when responsive or retain the existing value. |
| `HELPER_UNAVAILABLE`, `OWNERSHIP_LOST`, `UNSAFE_STATE` | End the session and diagnose ownership/helper state. |
| `COMMAND_TIMEOUT`, `VERIFICATION_FAILED`, `CALLBACK_FAILED` | Inspect saved state; do not blindly resubmit the mutation. |
| `CLEANUP_FAILED` | Keep ownership until helper cleanup is resolved. |
| `CANCELLED` | Cleanup runs; an already submitted write can still finish. |
| `IO_ERROR` | Check file paths, permissions and disk space. |
| `OPERATION_FAILED` | Inspect doctor and the operation result; this is the fallback for unclassified failures. |

Guided mode offers the JSON choice fallback only for supported recoverable query errors. Ownership, stale-state and unknown errors stop that edit. Failed mutating actions release their helper before another action; later attempts ask for preparation again. No submitted write is retried automatically.

A `DESCRIPTOR_TIMEOUT` means the exact descriptor did not register within the read budget. The error identifies the target, simulator, elapsed time and last successful catalog summary. Confirm the containing app launched and the target matches its catalog. It does not trigger app relaunch, helper recovery or another placement.
