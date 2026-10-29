# Agent setup

Run widgetctl on a local Mac with Node 22.14+, full Xcode and an iOS Simulator. Cloud-only sessions need a local Mac executor.

Plugins bundle the skill, CLI, local MCP server, native worker and dependency licenses. No separate npm installation is needed for agent CLI use. They do not change your global PATH or add dependencies to your project. Standalone skill installs include both executables but require [separate MCP registration](mcp.md#connect).

## Codex

```sh
codex plugin marketplace add DimaMishchenko/widgetctl
```

In the desktop app, open **Plugins**, select the **widgetctl** marketplace and install **widgetctl**. Start a new session to load the skill. This uses the documented [repository marketplace format](https://developers.openai.com/plugins/build/plugins).

Pin a release with `codex plugin marketplace add DimaMishchenko/widgetctl --ref v0.2.1`; use an absolute checkout path instead of the repository name to test local changes.

## Claude Code

```text
/plugin marketplace add DimaMishchenko/widgetctl
/plugin install widgetctl@widgetctl
```

The [Claude adapter](https://code.claude.com/docs/en/plugins-reference) uses the same skill and bundled MCP server. Its manifests are checked locally; a clean Claude Code installation on a Mac with Xcode still needs verification.

## Standalone skill

The [skills CLI](https://github.com/vercel-labs/skills) requires Node 22.20+:

```sh
npx skills add DimaMishchenko/widgetctl --skill widgetctl
```

The skill also has a public [Tessl listing](https://tessl.io/registry/skills/github/DimaMishchenko/widgetctl/widgetctl). Tessl installs the complete skill and runtime bundle from GitHub:

```sh
npx tessl i github:DimaMishchenko/widgetctl --skill widgetctl
```

For manual installation, copy the complete `skills/widgetctl` directory into your agent's documented skill location (`.agents/skills/widgetctl` for a Codex project). Keep `scripts/`, `native/`, `package.json` and licenses together. Choose one installation route.

## Use it

```text
Use the widgetctl skill on the simulator reserved for this task. Find my
Weather app's widgets, add a medium Forecast widget, inspect its settings,
and verify saved configuration. Use my native UI driver to check rendering.
```

The [skill](../skills/widgetctl/SKILL.md) instructs agents to discover real identifiers, target an explicitly owned UDID, preserve complete configuration, and release helpers after failures. MCP tools and explicit JSON CLI commands prepare and release per operation. Use TypeScript or Playwright for a persistent helper while a native UI driver is connected.

MCP tools can return private app configuration to the agent. The client controls permissions and data handling; see [privacy](privacy.md). There is no remote server, widgetctl account or credential.

Human CLI use is available through `npm install --global widgetctl`. TypeScript imports need `npm install --save-dev widgetctl`; Playwright also needs `@playwright/test`. Bundled agent executables do not add these project dependencies.

GitHub marketplace installs work independently of public directory approval. See [distribution status](distribution.md#directories).
