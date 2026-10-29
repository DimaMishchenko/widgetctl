# Local MCP

Widgetctl exposes the same widget controller through a local stdio MCP server. It runs on your Mac with Node 22.14+, full Xcode and a booted iOS Simulator. There is no hosted endpoint or widgetctl account.

## Connect

Installing the plugin registers its bundled server. No additional npm installation is needed. Avoid registering a second copy under another name.

For another MCP client, install the npm package globally:

```sh
npm install --global widgetctl
widgetctl-mcp --version
```

Add this to a client that accepts `mcpServers` JSON:

```json
{
  "mcpServers": {
    "widgetctl": {
      "command": "widgetctl-mcp",
      "args": []
    }
  }
}
```

The client must inherit the PATH containing Node and the npm global bin directory. GUI apps may need an absolute command path. Run `command -v widgetctl-mcp` in your terminal to find it. Client configuration formats vary; use the client's documented local stdio settings.

For a standalone skill install, use `command: "node"` and `args: ["/absolute/path/to/widgetctl/scripts/mcp.mjs"]`, replacing the path with the installed skill directory. Copy the whole skill folder, including `package.json`, `native/` and `licenses/`. A skill installer copies the runtime but does not register MCP for you.

Start the server through the MCP client. Running `widgetctl-mcp` by itself waits for protocol messages; stdout is reserved for JSON-RPC. `--help` and `--version` are terminal commands.

## Tools

Every simulator tool requires an explicit `udid` UUID. `widgetctl_devices` lists devices without booting one. Reserve a simulator for your task; the server never chooses one automatically.

| Tool | Arguments beyond `udid` | Result data |
| --- | --- | --- |
| `widgetctl_devices` | No arguments; no `udid` | Available simulators |
| `widgetctl_apps` | None | Installed apps |
| `widgetctl_doctor` | None | Readiness checks |
| `widgetctl_catalog` | None | Apps, widget kinds and supported sizes |
| `widgetctl_installed` | None | Installed widget targets and icon identities |
| `widgetctl_ensure` | `target: {container, extension, kind, size}`, optional `position: "top"` | Exact icon identity and target |
| `widgetctl_configuration_describe` | `iconIdentifier` | Editable fields and types |
| `widgetctl_configuration_export` | `iconIdentifier` | Complete saved configuration |
| `widgetctl_configuration_choices` | `iconIdentifier`, `key`; optional `search`, `configuration`, `expected` | Canonical entity choices |
| `widgetctl_configuration_apply` | `iconIdentifier`, edited `configuration`, original `expected` | Canonical saved configuration |
| `widgetctl_remove` | `iconIdentifier` | Exact-instance removal result |

`size` is `small`, `medium` or `large`, restricted to the widget's catalog support. Use `tools/list` for the actual JSON schemas. Extra arguments are rejected. Discovery tools do not install or launch apps; open the containing app once before catalog discovery.

## Add, edit and remove

1. Call `widgetctl_devices`, reserve an available simulator and boot it with your existing simulator tooling if needed.
2. Call `widgetctl_catalog` with that UDID. Use the returned app/extension/kind/size values in `widgetctl_ensure`; record its `iconIdentifier`.
3. Call `widgetctl_configuration_describe` and `widgetctl_configuration_export` for that exact icon. Keep the original export unchanged and edit a copy. Query entity fields through `widgetctl_configuration_choices` instead of guessing identifiers.
4. Call `widgetctl_configuration_apply` with the draft and the unchanged original as `expected`. A stale original fails instead of overwriting a newer save. Use the returned canonical configuration and refresh exact identities from `widgetctl_installed` after saving.
5. Verify saved values and inspect visible content using a native simulator driver or screenshot. When temporary testing is finished, restore original values and remove only the exact icons you created.

Successful tool responses include text JSON and matching `structuredContent`:

```json
{"ok":true,"data":{"iconIdentifier":"RETURNED_UUID","target":{}}}
```

This example abbreviates `target`; real responses contain the complete target. Tool errors set `isError: true` and return `{"ok":false,"error":{"code":"...","message":"...","recovery":[],"retryable":false}}`. Follow the reported recovery. A failed, timed-out or cancelled write may already have completed; inspect current state before deciding what to do next.

## Lifecycle and limits

Requests are serialized. Each controller operation prepares its helper and releases it in `finally`, including setup failures. Closing the client or sending SIGINT/SIGTERM stops queued work and waits for active cleanup. Cancellation is checked before the next operation; an already-started native write is allowed to finish and release safely.

Preparation and release may restart that simulator's Home Screen. Use the TypeScript API or Playwright fixture to keep one prepared lifecycle across multiple operations with an attached native UI driver. One simulator must have only one owner at a time, including other CLI, MCP or API processes.

MCP tools preserve unrelated widgets and do not offer broad replacement or exclusive removal flags. Configuration and local app data are returned to the MCP client under its permissions and privacy settings. See [privacy](privacy.md), [runtime limits](../README.md#support) and [troubleshooting](errors.md).
