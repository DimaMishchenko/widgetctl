#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createController,
  type WidgetController,
  type WidgetControllerOptions,
  type WidgetTarget,
  type WidgetCatalog,
  type InstalledWidget,
} from "./controller.js";
import {
  listSimulators,
  listApplications,
  type Simulator,
  type Application,
} from "./discovery.js";
import { compactText, uniqueNames, mark, titleCase } from "./human.js";
import { command } from "./backend-runtime.js";
import { doctor } from "./doctor.js";
import { WidgetctlError, classifyError } from "./errors.js";
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
  doctor        Check simulator tooling and readiness without changing state
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
  doctor: typeof doctor;
  stdout(text: string): void;
  stderr(text: string): void;
  devices(): Promise<Simulator[]>;
  applications(udid: string): Promise<Application[]>;
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
  applications: listApplications,
  doctor,
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
class InputError extends WidgetctlError {
  constructor(
    message: string,
    code: import("./errors.js").WidgetctlErrorCode = "INVALID_INPUT",
  ) {
    super(message, { code });
  }
}
class Cancelled extends Error {}
class CleanupError extends WidgetctlError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, {
      code: "CLEANUP_FAILED",
      ...options,
      recovery: ["Resolve helper release before starting another session."],
    });
  }
}
const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isCancellation = (error: unknown) =>
  error instanceof Cancelled ||
  (error instanceof Error &&
    ["ExitPromptError", "AbortPromptError"].includes(error.name));
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
    const persistent = guided && positionals.length === 0;
    let action = positionals[0];
    if (
      positionals.length > 1 ||
      (action &&
        ![...actions, "devices", "catalog", "list", "doctor"].includes(
          action ?? "",
        ))
    )
      throw new InputError(
        "Choose one supported command. Run widgetctl --help.",
      );
    if (!action && !persistent)
      throw new InputError("A command is required. Run widgetctl --help.");
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
      !persistent &&
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
      !["edit", "remove", "export", "configure"].includes(action ?? "")
    )
      throw new InputError(
        "--widget requires edit, remove, export or configure.",
      );
    if (values.file && !["export", "configure"].includes(action ?? ""))
      throw new InputError("--file requires export or configure.");
    if (!guided && !["devices", "doctor"].includes(action ?? "")) {
      if (!values.device)
        throw new InputError("--device is required. Run widgetctl --help.");
      if (
        action === "add" &&
        (!(values.app || values.extension) || !values.kind || !values.size)
      )
        throw new InputError(
          "add requires --app or --extension, --kind and --size.",
        );
      if (
        ["remove", "export", "configure"].includes(action ?? "") &&
        !values.widget
      )
        throw new InputError(`${action} requires --widget.`);
      if (["export", "configure"].includes(action ?? "") && !values.file)
        throw new InputError(`${action} requires --file.`);
      if (action === "edit")
        throw new InputError(
          "edit needs an interactive terminal. Use export and configure with --json for automation.",
        );
    }
    let device: Simulator | undefined;
    const diagnose = async () => {
      const report = await io.doctor({
        udid: device?.udid ?? values.device,
        stateDirectory: values["state-dir"],
      });
      json
        ? emit({ ...report, status: "diagnosed" })
        : io.stdout(
            `${report.healthy ? mark("✓", "OK") + " Ready" : mark("⚠", "!") + " Setup needs attention"} · ${report.checks.filter((check) => check.status === "pass").length} checks passed\n` +
              report.checks
                .filter((check) => check.status !== "pass")
                .map(
                  (check) =>
                    `${check.status === "warn" ? "!" : "×"} ${check.message}\n${(check.recovery ?? []).map((step) => `  ${step}\n`).join("")}`,
                )
                .join(""),
          );
      return report.healthy ? 0 : 1;
    };
    if (action === "doctor") return await diagnose();
    let controller: WidgetController | undefined;
    let workerAttempted = false;
    let prepared = false;
    let sessionConsent = false;
    let lastFailure: ReturnType<typeof classifyError> | undefined;
    const appNames = new Map<string, string>();
    const catalogNames = new Map<string, string>();
    let catalogNamesLoaded = false;
    const rememberCatalog = (catalog: WidgetCatalog) => {
      catalogNamesLoaded = true;
      for (const app of catalog.apps) {
        appNames.set(app.bundleIdentifier, app.name);
        for (const widget of app.widgets)
          if (widget.name)
            catalogNames.set(
              `${widget.target.extension}\0${widget.target.kind}`,
              widget.name,
            );
      }
    };
    const progress = (message: string) => {
      const visible =
        guided && !injected.stdout && !injected.stderr && process.stderr.isTTY;
      if (visible)
        process.stderr.write(
          `\r${compactText(message, Math.max(20, (process.stderr.columns || 80) - 2))}`,
        );
      return () => {
        if (visible) process.stderr.write("\r\x1b[2K");
      };
    };
    const loadAppNames = async () => {
      if (json || !device || appNames.size) return;
      try {
        for (const app of await io.applications(device.udid))
          appNames.set(app.bundleIdentifier, app.name);
      } catch {}
    };
    const widgetName = (widget: InstalledWidget) =>
      `${appNames.get(widget.target.container) ?? widget.target.container} · ${widget.name ?? catalogNames.get(`${widget.target.extension}\0${widget.target.kind}`) ?? (widget.target.kind.includes(".") ? "Widget" : widget.target.kind)} · ${titleCase(widget.target.size)}`;
    const widgetNames = (widgets: InstalledWidget[]) =>
      uniqueNames(
        widgets.map((widget) => ({
          name: widgetName(widget),
          id: widget.target.iconIdentifier,
          detail: widget.position
            ? `Page ${widget.position.page + 1}, item ${widget.position.index + 1}`
            : undefined,
        })),
      );
    const release = async (operationError?: unknown) => {
      try {
        if (workerAttempted && controller) {
          const finish = progress("Finishing session…");
          try {
            await controller.release();
          } finally {
            finish();
          }
        }
      } catch (error) {
        throw new CleanupError(
          `${operationError ? `${operationError instanceof Error ? operationError.message : String(operationError)}; ` : ""}Helper release failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: operationError ?? error },
        );
      } finally {
        workerAttempted = false;
        prepared = false;
        controller = undefined;
      }
    };
    const chooseDevice = async (devices: Simulator[]) => {
      if (!devices.length)
        throw new InputError(
          "No available iOS simulators found.",
          "DEVICE_NOT_FOUND",
        );
      const names = uniqueNames(
        devices.map((device) => ({
          name: `${device.name} · iOS ${device.runtime}${device.state === "booted" ? " · Running" : ""}`,
          id: device.udid,
        })),
      );
      const selected = await (
        await getPrompts()
      ).select("Choose a simulator", [
        ...devices.map((device, index) => ({
          name: names[index]!,
          value: device.udid,
        })),
        { name: "Back", value: "$back" },
      ]);
      if (selected === "$back") throw new Cancelled();
      const selectedDevice = devices.find(
        (candidate) => candidate.udid === selected,
      );
      if (!selectedDevice)
        throw new InputError(
          "Requested simulator is unavailable.",
          "DEVICE_NOT_FOUND",
        );
      return selectedDevice;
    };
    const execute = async (commandAction: string) => {
      action = commandAction;
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
                    `${device.name} · iOS ${device.runtime} · ${device.state === "booted" ? "Running" : "Stopped"}`,
                )
                .join("\n") + "\n",
            );
        return 0;
      }
      if (device) {
        const current = devices.find(
          (candidate) =>
            candidate.udid.toUpperCase() === device!.udid.toUpperCase(),
        );
        if (!current)
          throw new InputError(
            "Selected simulator is no longer available. Change simulator to continue.",
            "DEVICE_NOT_FOUND",
          );
        device = current;
      }
      device ??= values.device
        ? devices.find(
            (device) =>
              device.udid.toUpperCase() === values.device!.toUpperCase(),
          )
        : undefined;
      if (values.device && !device)
        throw new InputError(
          "Requested simulator is unavailable.",
          "DEVICE_NOT_FOUND",
        );
      if (!device) device = await chooseDevice(devices);
      const needsWorker = !["list", "$details"].includes(action);
      if (device.state !== "booted" && prepared) await release();
      if (device.state !== "booted" && !guided)
        throw new InputError(
          "The selected simulator must already be booted.",
          "DEVICE_NOT_BOOTED",
        );
      if (
        guided &&
        (device.state !== "booted" ||
          (needsWorker && !prepared && !sessionConsent))
      ) {
        const notice = needsWorker ? " Home Screen may restart." : "";
        const verb =
          device.state !== "booted" ? "Boot and use" : "Start session on";
        if (
          !(await (
            await getPrompts()
          ).confirm(`${verb} ${compactText(device.name, 28)}?${notice}`, false))
        )
          throw new Cancelled();
        if (needsWorker) sessionConsent = true;
      }
      if (device.state !== "booted") {
        const finish = progress(`Starting ${device.name}…`);
        try {
          await io.boot(device.udid);
        } finally {
          finish();
        }
        device = { ...device, state: "booted" };
      }
      abort.signal.throwIfAborted();
      controller ??= io.controller({
        udid: device.udid,
        stateDirectory: values["state-dir"],
        architecture: values.architecture as "arm64" | "x86_64" | undefined,
        launchDomain: values["launch-domain"],
      });
      let result: Record<string, unknown>;
      let humanResult = "";
      let operationError: unknown;
      try {
        if (needsWorker && !prepared) {
          workerAttempted = true;
          const finish = progress("Starting widget session…");
          try {
            await controller.prepare();
          } finally {
            finish();
          }
          prepared = true;
        }
        abort.signal.throwIfAborted();
        if (action === "catalog") {
          const catalog = await controller.catalog();
          rememberCatalog(catalog);
          result = { status: "catalogued", catalog };
        } else if (action === "list")
          result = {
            status: "widgets_listed",
            widgets: await controller.installedWidgets(),
          };
        else if (action === "add") {
          const catalog = await controller.catalog();
          rememberCatalog(catalog);
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
          const entry = catalog.apps
            .flatMap((app) => app.widgets)
            .find(
              (widget) =>
                widget.target.extension === target.extension &&
                widget.target.kind === target.kind,
            );
          humanResult = `${entry?.name ?? target.kind} · ${titleCase(target.size)} ready`;
          result = {
            status: "verified",
            target: handle.target,
            iconIdentifier: handle.iconIdentifier,
          };
        } else {
          let icon = values.widget;
          if (guided && needsWorker && !catalogNamesLoaded) {
            try {
              rememberCatalog(await controller.catalog());
            } catch (error) {
              if (
                abort.signal.aborted ||
                isCancellation(error) ||
                [
                  "OWNERSHIP_LOST",
                  "UNSAFE_STATE",
                  "CLEANUP_FAILED",
                  "HELPER_UNAVAILABLE",
                ].includes(classifyError(error).code)
              )
                throw error;
              catalogNamesLoaded = true;
            }
          }
          await loadAppNames();
          const widgets =
            guided || !json ? await controller.installedWidgets() : [];
          if (!icon) {
            if (!widgets.length)
              throw new InputError(
                "No installed widgets found. Add a widget first.",
                "WIDGET_NOT_FOUND",
              );
            const names = widgetNames(widgets);
            icon = await (
              await getPrompts()
            ).select("Choose a widget", [
              ...widgets.map((widget, index) => ({
                name: names[index]!,
                value: widget.target.iconIdentifier!,
              })),
              { name: "Back", value: "$back" },
            ]);
          }
          if (icon === "$back") throw new Cancelled();
          const selectedWidget = widgets.find(
            (widget) =>
              widget.target.iconIdentifier.toUpperCase() ===
              icon!.toUpperCase(),
          );
          const displayName = selectedWidget
            ? widgetNames(widgets)[widgets.indexOf(selectedWidget)]!
            : "widget";
          if (action === "$details") {
            if (!selectedWidget)
              throw new InputError(
                "Widget is no longer available.",
                "WIDGET_NOT_FOUND",
              );
            io.stdout(
              `${displayName}\nApp: ${selectedWidget.target.container}\nExtension: ${selectedWidget.target.extension}\nKind: ${selectedWidget.target.kind}\nSize: ${selectedWidget.target.size}\nWidget: ${icon}\n${selectedWidget.position ? `Page ${selectedWidget.position.page + 1}, item ${selectedWidget.position.index + 1}\n` : ""}`,
            );
            return 0;
          }
          const handle = await controller.getWidget(icon);
          if (action === "remove") {
            if (
              guided &&
              !(await (
                await getPrompts()
              ).confirm(`Remove ${displayName}?`, false))
            )
              throw new Cancelled();
            abort.signal.throwIfAborted();
            result = { ...(await handle.remove()) };
            humanResult = `${displayName} removed`;
          } else if (action === "edit") {
            if (guided) io.stdout(`${compactText(displayName)}\n`);
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
            if (!draft) return 0;
            abort.signal.throwIfAborted();
            humanResult = "Changes saved";
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
              await io.write(
                file,
                `${JSON.stringify(configuration, null, 2)}\n`,
              );
              humanResult = `Configuration exported to ${file}`;
              result = {
                status: "configuration_exported",
                file,
                iconIdentifier: icon,
              };
            } else {
              const configuration =
                inputConfiguration ?? JSON.parse(await io.read(file));
              abort.signal.throwIfAborted();
              humanResult = "Configuration applied";
              result = {
                status: "configuration_applied",
                configuration: await handle.applyConfiguration(configuration),
              };
            }
          }
        }
      } catch (error) {
        operationError = error;
        if (
          persistent &&
          prepared &&
          ["add", "edit", "remove", "configure"].includes(action) &&
          !isCancellation(error)
        )
          await release(error);
        throw error;
      } finally {
        if (!persistent || (workerAttempted && !prepared))
          await release(operationError);
      }
      abort.signal.throwIfAborted();
      if (json) emit(result);
      else if (action === "catalog") {
        const catalog = result.catalog as WidgetCatalog;
        io.stdout(
          catalog.apps.length
            ? catalog.apps
                .map(
                  (app) =>
                    `${app.name}\n${app.widgets.map((widget) => `  ${widget.name ?? widget.target.kind} · ${widget.sizes.map(titleCase).join(", ")}`).join("\n")}`,
                )
                .join("\n") + "\n"
            : "No installed widget kinds found.\n",
        );
      } else if (action === "list") {
        const widgets = result.widgets as InstalledWidget[];
        await loadAppNames();
        io.stdout(
          widgets.length
            ? widgetNames(widgets).join("\n") + "\n"
            : "No installed widgets found.\n",
        );
      } else
        io.stdout(
          `${mark("✓", "OK")} ${humanResult || String(result.status).replaceAll("_", " ")}\n`,
        );
      return 0;
    };
    if (!persistent) return await execute(action!);
    if (values.device)
      device = (await io.devices()).find(
        (candidate) =>
          candidate.udid.toUpperCase() === values.device!.toUpperCase(),
      );
    let sessionError: unknown;
    try {
      for (;;) {
        abort.signal.throwIfAborted();
        io.stdout(
          `\nwidgetctl${device ? ` · ${compactText(device.name)} · iOS ${device.runtime}` : ""}\n`,
        );
        let selected = await (
          await getPrompts()
        ).select("What would you like to do?", [
          { name: `${mark("➕", "+")} Add widget`, value: "add" },
          { name: `${mark("✏️", "~")} Edit widget`, value: "edit" },
          { name: `${mark("🗑", "-")} Remove widget`, value: "remove" },
          { name: `${mark("⋯", "...")} More`, value: "$more" },
          { name: `${mark("📱", "@")} Change simulator`, value: "$device" },
          { name: "Exit", value: "$exit" },
        ]);
        abort.signal.throwIfAborted();
        if (selected === "$exit") return 0;
        if (selected === "$more") {
          selected = await (
            await getPrompts()
          ).select("More", [
            { name: "Browse widgets", value: "catalog" },
            { name: "Installed widgets", value: "list" },
            { name: "Widget details", value: "$details" },
            { name: "Import configuration", value: "configure" },
            { name: "Export configuration", value: "export" },
            { name: "Diagnostics", value: "doctor" },
            ...(lastFailure
              ? [{ name: "Last error details", value: "$error" }]
              : []),
            { name: "Back", value: "$back" },
          ]);
          if (selected === "$back") continue;
          if (selected === "$error" && lastFailure) {
            io.stdout(
              `${lastFailure.code}: ${lastFailure.message}\n${lastFailure.recovery.join("\n")}\n`,
            );
            continue;
          }
        }
        try {
          if (selected === "$device") {
            await release();
            device = undefined;
            values.device = undefined;
            sessionConsent = false;
            appNames.clear();
            catalogNames.clear();
            catalogNamesLoaded = false;
            device = await chooseDevice(await io.devices());
            continue;
          }
          if (selected === "doctor") {
            await diagnose();
            continue;
          }
          await execute(selected);
        } catch (error) {
          if (
            abort.signal.aborted ||
            error instanceof CleanupError ||
            (error instanceof Error &&
              ["ExitPromptError", "AbortPromptError"].includes(error.name))
          )
            throw error;
          if (isCancellation(error)) {
            continue;
          }
          const failure = classifyError(error);
          if (
            [
              "OWNERSHIP_LOST",
              "UNSAFE_STATE",
              "CLEANUP_FAILED",
              "HELPER_UNAVAILABLE",
            ].includes(failure.code)
          )
            throw error;
          if (
            [
              "VERIFICATION_FAILED",
              "COMMAND_TIMEOUT",
              "CALLBACK_FAILED",
              "OPERATION_FAILED",
            ].includes(failure.code)
          )
            await release(error);
          lastFailure = failure;
          io.stderr(
            `${mark("⚠", "!")} ${compactText(failure.message, Math.max(20, (process.stderr.columns || 80) - 3))}\n${failure.recovery[0] ? `${failure.recovery[0]}\n` : ""}Details: More → Last error details\n`,
          );
        }
      }
    } catch (error) {
      sessionError = error;
      throw error;
    } finally {
      await release(sessionError);
    }
  } catch (error) {
    const failure = classifyError(error);
    const cancelled =
      failure.code !== "CLEANUP_FAILED" &&
      !(error instanceof CleanupError) &&
      (isCancellation(error) ||
        abort.signal.aborted ||
        failure.code === "CANCELLED");
    const message = cancelled ? "Cancelled." : failure.message;
    const result = {
      code: cancelled ? "CANCELLED" : failure.code,
      recovery: cancelled ? [] : failure.recovery,
      retryable: cancelled ? false : failure.retryable,
      status: cancelled ? "cancelled" : "failed",
      error: message,
    };
    json
      ? emit(result)
      : io.stderr(
          `${message}\n${cancelled ? "" : failure.recovery.map((step) => `${step}\n`).join("")}`,
        );
    return cancelled
      ? 130
      : error instanceof InputError
        ? 2
        : ["INVALID_INPUT", "VERIFICATION_FAILED", "AMBIGUOUS_TARGET"].includes(
              failure.code,
            )
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
