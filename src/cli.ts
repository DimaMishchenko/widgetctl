#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import {
  runOperation,
  validateOptions,
  type BackendOptions,
} from "./backend.js";

const help = `widgetctl — iOS Simulator widget testing helper

Usage: widgetctl <command> --device <UDID> [options]

Commands:
  prepare       Prepare the helper before connecting a UI driver
  release       Unload the helper; leave widgets installed
  inspect       Inspect runtime metadata and an optional --widget icon UUID
  ensure        Add or reveal a widget; reuse its existing identity by default
  remove        Remove exactly the selected widget, if present
  export        Export the current complete configuration to --file
  configure     Apply a complete exported configuration from --file

Widget commands require --extension <bundle-id> --kind <kind>
                        --size <small|medium|large>
Options:
  --container <bundle-id>       Optional app container lookup
  --widget <icon-uuid>          Target an exact existing widget
  --replace                    Ensure a fresh widget identity
  --exclusive                  Remove other widgets of this extension
  --position top               Put the widget first on its current page
  --state-dir <path>           Compiled-worker cache directory
  --architecture arm64|x86_64  Override simulator architecture
  --launch-domain user/<uid>   Override SpringBoard launch domain
  --file <path>                Configuration input/output
  --help                      Show this help
  --version                   Show the package version

Results and failures are JSON on stdout. Exit codes: 0 success,
1 operation failure, 2 invalid input or unverified persisted outcome.
Requires macOS, Xcode and an explicitly owned, already booted simulator.
`;

export async function main(argv: string[]): Promise<number> {
  let operationStarted = false;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        device: { type: "string" },
        extension: { type: "string" },
        kind: { type: "string" },
        size: { type: "string" },
        container: { type: "string" },
        widget: { type: "string" },
        replace: { type: "boolean" },
        exclusive: { type: "boolean" },
        position: { type: "string" },
        "state-dir": { type: "string" },
        architecture: { type: "string" },
        "launch-domain": { type: "string" },
        file: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    });
    if (values.help || argv.length === 0) {
      process.stdout.write(help);
      return 0;
    }
    if (values.version) {
      const manifest = JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
      ) as { version: string };
      process.stdout.write(`${manifest.version}\n`);
      return 0;
    }
    const modes: Record<string, BackendOptions["mode"]> = {
      prepare: "prepare",
      release: "unload",
      inspect: "inspect",
      ensure: "ensure",
      remove: "remove",
      export: "exportConfiguration",
      configure: "applyConfiguration",
    };
    const command = positionals[0];
    if (positionals.length !== 1 || !Object.hasOwn(modes, command ?? ""))
      throw new Error("Choose one command. Run widgetctl --help for usage.");
    if (
      !values.device ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        values.device,
      )
    )
      throw new Error(
        "--device must name the explicitly owned simulator UUID.",
      );
    const widgetCommand = ["ensure", "remove", "export", "configure"].includes(
      command,
    );
    if (
      widgetCommand &&
      (!values.extension ||
        !values.kind ||
        !["small", "medium", "large"].includes(values.size ?? ""))
    )
      throw new Error(
        "Widget commands require --extension, --kind and --size small|medium|large.",
      );
    if (values.size && !["small", "medium", "large"].includes(values.size))
      throw new Error("Unsupported --size.");
    if (values.position && values.position !== "top")
      throw new Error("--position supports only top.");
    if (
      values.architecture &&
      !["arm64", "x86_64"].includes(values.architecture)
    )
      throw new Error("Unsupported --architecture.");
    if (
      (values.replace || values.exclusive || values.position) &&
      command !== "ensure"
    )
      throw new Error("--replace, --exclusive and --position require ensure.");
    if (["export", "configure"].includes(command) !== Boolean(values.file))
      throw new Error("--file is required only for export and configure.");
    if (
      !widgetCommand &&
      (values.extension || values.kind || values.size || values.container)
    )
      throw new Error("Widget target options require a widget command.");
    if (values.widget && ["prepare", "release"].includes(command))
      throw new Error("--widget requires a widget operation or inspect.");
    const configuration =
      command === "configure"
        ? (JSON.parse(await readFile(values.file!, "utf8")) as object)
        : undefined;
    const options: BackendOptions = {
      udid: values.device,
      mode: modes[command],
      extension: values.extension,
      kind: values.kind,
      size: values.size as BackendOptions["size"],
      container: values.container,
      iconIdentifier: values.widget,
      exclusive: values.exclusive,
      replace: values.replace,
      position: values.position as "top" | undefined,
      stateDirectory: values["state-dir"],
      architecture: values.architecture as BackendOptions["architecture"],
      launchDomain: values["launch-domain"],
      configuration,
    };
    validateOptions(options);
    operationStarted = true;
    const result = await runOperation(options);
    const successful = [
      "ready",
      "unloaded",
      "inspected",
      "verified",
      "removed",
      "configuration_exported",
      "configuration_applied",
    ].includes(result.status);
    if (command === "export" && successful)
      await writeFile(
        values.file!,
        `${JSON.stringify(result.configuration, null, 2)}\n`,
        { mode: 0o600 },
      );
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, ...result })}\n`,
    );
    return successful ? 0 : /unverified|duplicate/.test(result.status) ? 2 : 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, status: "failed", error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    return operationStarted ? 1 : 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
