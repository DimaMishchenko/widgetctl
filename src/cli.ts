#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createController,
  type WidgetController,
  type WidgetControllerOptions,
  type WidgetTarget,
} from "./controller.js";
import { listSimulators, type Simulator } from "./discovery.js";
import { command } from "./backend-runtime.js";
import {
  createPrompts,
  terminalText,
  selectCatalogTarget,
  editConfiguration,
  type Prompts,
} from "./interactive.js";

export const help = `widgetctl — iOS Simulator widget testing helper

Usage: widgetctl                         Guided mode in a terminal
       widgetctl <command> --device <UDID> [options]

Commands:
  devices       List available iOS simulators
  catalog       Discover apps, widget kinds and supported sizes
  list          List installed widgets with exact identities and positions
  add           Add or reveal a widget from the installed catalog
  edit          Interactively edit an exact widget's configuration
  remove        Remove an exact widget
  export        Export an exact widget's configuration to --file
  configure     Apply a complete configuration from --file to an exact widget

Options:
  --device <UDID>       Explicitly owned, booted simulator
  --app <bundle-id>     Installed app for add (optional with --extension)
  --extension <id>      Widget extension for add
  --kind <kind>         Catalog widget kind for add
  --size <size>         Catalog size: small, medium or large
  --widget <icon-uuid>  Exact existing widget for edit/remove/export/configure
  --file <path>         Configuration file for export/configure
  --position top       Reveal added widget first on its current page
  --replace            Create a fresh widget identity for add
  --exclusive          Remove other widgets of this extension for add
  --json               One JSON result on stdout, including failures
  --state-dir <path>   Compiled-worker cache directory
  --architecture <id>  arm64 or x86_64
  --launch-domain <id> SpringBoard launch domain override
  --help, -h           Show usage
  --version            Show package version

Commands that need a helper prepare and release it automatically. Preparation
and release may restart the selected simulator's UI; claim ownership before
using --device. devices and list read existing state without a helper.
Noninteractive commands never prompt. Exit codes: 0 success, 1 operation
failure, 2 invalid input or unverified outcome, 130 cancelled.
`;
export interface CliRuntime {
  isTTY: boolean;
  stdout(text: string): void;
  stderr(text: string): void;
  devices(): Promise<Simulator[]>;
  boot(udid: string): Promise<void>;
  controller(options: WidgetControllerOptions): WidgetController;
  prompts(signal: AbortSignal): Promise<Prompts>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}
const defaults: CliRuntime = {
  isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  devices: listSimulators,
  boot: async (udid) => {
    await command(["xcrun", "simctl", "boot", udid]);
    await command(["xcrun", "simctl", "bootstatus", udid, "-b"], 120000);
  },
  controller: createController,
  prompts: createPrompts,
  read: (path) => readFile(path, "utf8"),
  write: async (path, text) => {
    await writeFile(path, text, { mode: 0o600 });
  },
};
class InputError extends Error {}
class Cancelled extends Error {}
class CleanupError extends Error {}
const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const actions = ["add", "edit", "remove", "export", "configure"];
export async function runCli(
  argv: string[],
  injected: Partial<CliRuntime> = {},
): Promise<number> {
  const runtime = { ...defaults, ...injected };
  const io = {
    ...runtime,
    stdout: (text: string) => runtime.stdout(terminalText(text)),
    stderr: (text: string) => runtime.stderr(terminalText(text)),
  };
  let json = argv.includes("--json");
  let started = false;
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once("SIGINT", interrupt);
  const emit = (result: Record<string, unknown>) =>
    runtime.stdout(
      `${JSON.stringify({ schemaVersion: 1, ...result }).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)}\n`,
    );
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        device: { type: "string" },
        app: { type: "string" },
        extension: { type: "string" },
        kind: { type: "string" },
        size: { type: "string" },
        widget: { type: "string" },
        file: { type: "string" },
        position: { type: "string" },
        replace: { type: "boolean" },
        exclusive: { type: "boolean" },
        json: { type: "boolean" },
        "state-dir": { type: "string" },
        architecture: { type: "string" },
        "launch-domain": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    });
    json = Boolean(values.json);
    if (values.help || (!argv.length && !io.isTTY)) {
      json ? emit({ status: "help", help }) : io.stdout(help);
      return 0;
    }
    if (values.version) {
      const manifest = JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
      ) as { version: string };
      json
        ? emit({ status: "version", version: manifest.version })
        : io.stdout(`${manifest.version}\n`);
      return 0;
    }
    const guided = io.isTTY && !json;
    let prompts: Prompts | undefined;
    const getPrompts = async () => (prompts ??= await io.prompts(abort.signal));
    let action = positionals[0];
    if (
      positionals.length > 1 ||
      (action && ![...actions, "devices", "catalog", "list"].includes(action))
    )
      throw new InputError(
        "Choose one supported command. Run widgetctl --help.",
      );
    if (!action) {
      if (!guided)
        throw new InputError("A command is required. Run widgetctl --help.");
      action = await (
        await getPrompts()
      ).select("What would you like to do?", [
        { name: "Add or reveal a widget", value: "add" },
        { name: "Edit widget configuration", value: "edit" },
        { name: "Remove a widget", value: "remove" },
        { name: "Export configuration", value: "export" },
        { name: "Apply configuration from a file", value: "configure" },
        { name: "Exit", value: "$exit" },
      ]);
      if (action === "$exit") throw new Cancelled();
    }
    if (values.device && !uuid(values.device))
      throw new InputError("--device must be an explicit simulator UUID.");
    if (values.widget && !uuid(values.widget))
      throw new InputError("--widget must be an exact icon UUID.");
    if (
      values.architecture &&
      !["arm64", "x86_64"].includes(values.architecture)
    )
      throw new InputError("Unsupported --architecture.");
    if (values["launch-domain"] && !/^user\/\d+$/.test(values["launch-domain"]))
      throw new InputError("--launch-domain must be user/<uid>.");
    if (values.position && values.position !== "top")
      throw new InputError("--position supports only top.");
    if (
      action !== "add" &&
      [
        values.app,
        values.extension,
        values.kind,
        values.size,
        values.position,
        values.replace,
        values.exclusive,
      ].some((value) => value !== undefined)
    )
      throw new InputError(
        "App, extension, kind, size and add options require add.",
      );
    if (
      values.widget &&
      !["edit", "remove", "export", "configure"].includes(action)
    )
      throw new InputError(
        "--widget requires edit, remove, export or configure.",
      );
    if (values.file && !["export", "configure"].includes(action))
      throw new InputError("--file requires export or configure.");
    if (!guided && action !== "devices") {
      if (!values.device)
        throw new InputError("--device is required. Run widgetctl --help.");
      if (
        action === "add" &&
        (!(values.app || values.extension) || !values.kind || !values.size)
      )
        throw new InputError(
          "add requires --app or --extension, --kind and --size.",
        );
      if (["remove", "export", "configure"].includes(action) && !values.widget)
        throw new InputError(`${action} requires --widget.`);
      if (["export", "configure"].includes(action) && !values.file)
        throw new InputError(`${action} requires --file.`);
      if (action === "edit")
        throw new InputError(
          "edit needs an interactive terminal. Use export and configure with --json for automation.",
        );
    }
    const inputConfiguration =
      action === "configure" && values.file
        ? JSON.parse(await io.read(values.file))
        : undefined;
    const devices = await io.devices();
    if (action === "devices") {
      json
        ? emit({ status: "devices_listed", devices })
        : io.stdout(
            devices
              .map(
                (device) =>
                  `${device.name} • iOS ${device.runtime} • ${device.state} • ${device.udid}`,
              )
              .join("\n") + "\n",
          );
      return 0;
    }
    let device = values.device
      ? devices.find(
          (device) =>
            device.udid.toUpperCase() === values.device!.toUpperCase(),
        )
      : undefined;
    if (values.device && !device)
      throw new InputError("Requested simulator is unavailable.");
    if (!device) {
      if (!devices.length)
        throw new InputError("No available iOS simulators found.");
      const selected = await (
        await getPrompts()
      ).select("Choose a simulator you own", [
        ...devices.map((device) => ({
          name: `${device.name} • iOS ${device.runtime} • ${device.state} • ${device.udid}`,
          value: device.udid,
        })),
        { name: "Back / cancel", value: "$back" },
      ]);
      if (selected === "$back") throw new Cancelled();
      device = devices.find((device) => device.udid === selected)!;
    }
    if (device.state !== "booted") {
      if (!guided)
        throw new InputError("The selected simulator must already be booted.");
      if (
        !(await (
          await getPrompts()
        ).confirm(
          `Boot ${device.name} (${device.udid}) and claim it for this operation?`,
          false,
        ))
      )
        throw new Cancelled();
      await io.boot(device.udid);
    }
    const needsWorker = action !== "list";
    if (
      needsWorker &&
      guided &&
      !(await (
        await getPrompts()
      ).confirm(
        `Prepare ${device.name}? Its UI may restart. Confirm you own this simulator.`,
        false,
      ))
    )
      throw new Cancelled();
    const controller = io.controller({
      udid: device.udid,
      stateDirectory: values["state-dir"],
      architecture: values.architecture as "arm64" | "x86_64" | undefined,
      launchDomain: values["launch-domain"],
    });
    let result: Record<string, unknown>;
    started = true;
    let operationError: unknown;
    try {
      if (needsWorker) {
        if (guided)
          io.stderr("Preparing the selected simulator's widget helper…\n");
        await controller.prepare();
      }
      abort.signal.throwIfAborted();
      if (action === "catalog")
        result = { status: "catalogued", catalog: await controller.catalog() };
      else if (action === "list")
        result = {
          status: "widgets_listed",
          widgets: await controller.installedWidgets(),
        };
      else if (action === "add") {
        const catalog = await controller.catalog();
        let target: WidgetTarget | undefined;
        try {
          target = await selectCatalogTarget(
            catalog.apps,
            values,
            guided ? await getPrompts() : undefined,
          );
        } catch (error) {
          if (
            error instanceof Error &&
            ["ExitPromptError", "AbortPromptError"].includes(error.name)
          )
            throw error;
          throw new InputError(
            error instanceof Error ? error.message : String(error),
          );
        }
        if (!target) throw new Cancelled();
        abort.signal.throwIfAborted();
        const handle = await controller.ensure(target, {
          replace: values.replace,
          exclusive: values.exclusive,
          position: values.position as "top" | undefined,
        });
        result = {
          status: "verified",
          target: handle.target,
          iconIdentifier: handle.iconIdentifier,
        };
      } else {
        let icon = values.widget;
        if (!icon) {
          const widgets = await controller.installedWidgets();
          if (!widgets.length)
            throw new InputError(
              "No installed widgets found. Add a widget first.",
            );
          icon = await (
            await getPrompts()
          ).select(
            "Choose an exact installed widget",
            widgets.map((widget) => ({
              name: `${widget.target.container} • ${widget.target.kind} • ${widget.target.size} • ${widget.position ? `page ${widget.position.page + 1}, item ${widget.position.index + 1}` : "position unavailable"} • ${widget.target.iconIdentifier}`,
              value: widget.target.iconIdentifier!,
            })),
          );
        }
        const handle = await controller.getWidget(icon);
        if (action === "remove") {
          if (
            guided &&
            !(await (
              await getPrompts()
            ).confirm(`Remove widget ${icon}?`, false))
          )
            throw new Cancelled();
          abort.signal.throwIfAborted();
          result = { ...(await handle.remove()) };
        } else if (action === "edit") {
          const description = await handle.describeConfiguration();
          const draft = await editConfiguration(
            description,
            await getPrompts(),
            io.stderr,
            (key, search, configuration, signal) =>
              handle.configurationChoices(key, search, {
                configuration,
                expected: description.configuration,
                signal: signal ?? abort.signal,
              }),
          );
          if (!draft) throw new Cancelled();
          abort.signal.throwIfAborted();
          result = {
            status: "configuration_applied",
            configuration: await handle.applyConfiguration(draft, {
              expected: description.configuration,
            }),
          };
        } else {
          const file =
            values.file ??
            (await (
              await getPrompts()
            ).input(
              action === "export"
                ? "Export file path"
                : "Configuration file path",
            ));
          if (!file.trim()) throw new InputError("A file path is required.");
          if (action === "export") {
            const configuration = await handle.exportConfiguration();
            abort.signal.throwIfAborted();
            await io.write(file, `${JSON.stringify(configuration, null, 2)}\n`);
            result = {
              status: "configuration_exported",
              file,
              iconIdentifier: icon,
            };
          } else {
            const configuration =
              inputConfiguration ?? JSON.parse(await io.read(file));
            abort.signal.throwIfAborted();
            result = {
              status: "configuration_applied",
              configuration: await handle.applyConfiguration(configuration),
            };
          }
        }
      }
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        if (needsWorker) {
          if (guided) io.stderr("Releasing the widget helper…\n");
          await controller.release();
        }
      } catch (cleanupError) {
        if (operationError)
          throw new CleanupError(
            `${operationError instanceof Error ? operationError.message : String(operationError)}; helper release also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
            { cause: operationError },
          );
        throw new CleanupError(
          `Helper release failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          { cause: cleanupError },
        );
      }
    }
    abort.signal.throwIfAborted();
    json
      ? emit(result)
      : io.stdout(
          `${String(result.status).replaceAll("_", " ")}${result.iconIdentifier ? ` • ${result.iconIdentifier}` : ""}\n${["catalog", "list"].includes(action) ? JSON.stringify(result.catalog ?? result.widgets, null, 2) + "\n" : ""}`,
        );
    return 0;
  } catch (error) {
    const cancelled =
      !(error instanceof CleanupError) &&
      (error instanceof Cancelled ||
        abort.signal.aborted ||
        (error instanceof Error &&
          ["ExitPromptError", "AbortPromptError"].includes(error.name)));
    const message = cancelled
      ? "Cancelled."
      : error instanceof Error
        ? error.message
        : String(error);
    const result = {
      status: cancelled ? "cancelled" : "failed",
      error: message,
    };
    json
      ? emit(result)
      : io.stderr(
          `${message}\n${error instanceof InputError ? "Run widgetctl --help for usage.\n" : ""}`,
        );
    return cancelled
      ? 130
      : error instanceof InputError || !started
        ? 2
        : /unverified|duplicate/.test(message)
          ? 2
          : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}
export const main = runCli;
if (
  process.argv[1] &&
  (await realpath(process.argv[1]).catch(() => "")) ===
    fileURLToPath(import.meta.url)
)
  process.exitCode = await main(process.argv.slice(2));
