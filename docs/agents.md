# Use widgetctl with an agent

Widgetctl runs on a local Mac with Node 22.14+, full Xcode and an iOS Simulator. The plugin includes a local CLI, not a remote simulator service. Cloud-only sessions without a local Mac executor cannot run it.

## Install the plugin or skill

The plugin and standalone skill include a ready-to-run CLI, its native worker and runtime dependencies. No separate npm install is needed for agent CLI use. They require Node 22.14+ and Xcode already available on the Mac; they do not change your global PATH or install anything in your project.

### Codex

Register this repository as a marketplace:

```sh
codex plugin marketplace add DimaMishchenko/widgetctl
```

In the desktop app, open **Plugins**, choose the **widgetctl** marketplace and install **widgetctl**. Start a new session so the skill is available. This uses OpenAI’s documented [repository marketplace format](https://developers.openai.com/plugins/build/plugins).

On Codex CLI versions exposing `codex plugin add`, you can instead install with:

```sh
codex plugin add widgetctl@widgetctl
```

Check `codex plugin --help` if your client differs. For the reproducible 0.1.2 plugin source, use `codex plugin marketplace add DimaMishchenko/widgetctl --ref v0.1.2`. Register a local checkout with `codex plugin marketplace add /absolute/path/to/widgetctl` when testing unpublished changes.

### Claude Code

In Claude Code, run:

```text
/plugin marketplace add DimaMishchenko/widgetctl
/plugin install widgetctl@widgetctl
```

The [Claude adapter](https://code.claude.com/docs/en/plugins-reference) discovers the same `skills/widgetctl` directory. It adds no hooks or MCP servers. Manifest structure is validated against the documented format; end-to-end Claude installation still needs a test on a machine with Claude Code installed.

### Standalone skill

The optional [skills CLI](https://github.com/vercel-labs/skills) (Node 22.20+) can install the skill directly from this public repository:

```sh
npx skills add DimaMishchenko/widgetctl
```

This copies the same skill and bundled CLI. It is an alternative to plugin installation.

For an agent that supports local `SKILL.md` skills, copy `skills/widgetctl` from a reviewed checkout into that agent’s documented skill location. For a Codex project, use `.agents/skills/widgetctl`. Keep the complete skill directory, including `scripts/`, `native/` and licenses. Copying the entire repository is unnecessary. This is an alternative to plugin installation, not an additional requirement.

## Ask for a widget setup

```text
Use the widgetctl skill to find my Weather app's widgets on the simulator
reserved for this task. Add a medium Forecast widget, inspect its settings,
and verify the saved configuration. Use my native UI driver to check rendering.
```

The agent should discover IDs and supported sizes, use `--json` for CLI operations, and preserve the complete configuration envelope. It must target your explicitly reserved simulator, use exact widget identities, and release its helper even if preparation fails. The [skill](../skills/widgetctl/SKILL.md) explains these decisions in a short, portable form.

Use the TypeScript API or Playwright fixture when a native driver must remain connected across several operations. The CLI prepares and releases per operation; JSON prevents prompts, not Home Screen restarts.

## What the plugin contains

- One short skill with automatic discovery and an explicit invocation prompt.
- A bundled CLI, native worker and production dependency code with license notices.
- OpenAI Agent Plugins 1.0 metadata and a repository marketplace.
- A Claude Code compatibility manifest and marketplace pointing to the same skill.

There are no network connectors, remote MCP servers, lifecycle hooks, auto-install scripts, credentials or extra permissions to configure. Installing a skill grants no new shell access; the agent still uses its host’s normal execution permissions.

For a human terminal command, optionally install `npm install --global widgetctl` and run `widgetctl`. TypeScript and Playwright imports require a project dependency: `npm install --save-dev widgetctl`, or `npm install --save-dev widgetctl @playwright/test` for the fixture. The bundled CLI does not add an npm dependency to your project.

The package schema and install manifests are checked locally. Marketplace discovery/installation support varies by client version. Public OpenAI directory approval is a separate release step; this repository does not claim an approved public listing. See [distribution and releases](distribution.md).
