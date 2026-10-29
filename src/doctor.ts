import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { command, processAlive } from "./backend-runtime.js";
import { object, uuid } from "./backend-model.js";

export interface DoctorOptions {
  udid?: string;
  stateDirectory?: string;
}
export interface DoctorCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
  recovery?: string[];
}
export interface DoctorReport {
  schemaVersion: 1;
  healthy: boolean;
  checks: DoctorCheck[];
}
interface StateInfo {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  uid: number;
}
interface DoctorDependencies {
  platform: string;
  home: string;
  uid: number | undefined;
  run: typeof command;
  stat: (file: string) => Promise<StateInfo>;
  read: (file: string) => Promise<string>;
  alive: (pid: unknown) => boolean;
  now: () => number;
}
async function boundedRead(file: string): Promise<string> {
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 65536)
      throw Error("Helper metadata is not a bounded regular file");
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw Error("Helper metadata exceeds 64 KiB");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
const defaults: DoctorDependencies = {
  platform: process.platform,
  home: os.homedir(),
  uid: process.getuid?.(),
  run: command,
  stat: fs.lstat,
  read: boundedRead,
  alive: processAlive,
  now: Date.now,
};
const missing = (error: unknown) => object(error) && error.code === "ENOENT";
const detail = (error: unknown) => String(error).slice(0, 1200);

export function createDoctor(overrides: Partial<DoctorDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (options: DoctorOptions = {}): Promise<DoctorReport> => {
    const checks: DoctorCheck[] = [];
    const add = (
      id: string,
      status: DoctorCheck["status"],
      message: string,
      recovery?: string[],
    ) =>
      checks.push({ id, status, message, ...(recovery ? { recovery } : {}) });
    const report = (): DoctorReport => ({
      schemaVersion: 1,
      healthy: !checks.some((check) => check.status === "fail"),
      checks,
    });
    if (options.udid !== undefined && !uuid(options.udid)) {
      add("device", "fail", "UDID must be an explicit simulator UUID.", [
        "widgetctl devices --json",
      ]);
      return report();
    }
    if (deps.platform !== "darwin") {
      add(
        "host",
        "fail",
        `Unsupported host ${deps.platform}; widgetctl requires macOS and full Xcode.`,
        ["Run widgetctl doctor on a Mac with Xcode installed."],
      );
      return report();
    }
    add("host", "pass", "macOS host detected.");
    const probe = async (id: string, args: string[], recovery: string[]) => {
      try {
        const output = (await deps.run(args, 10000)).trim();
        if (!output) throw Error("Command returned no metadata");
        add(id, "pass", output.slice(0, 1200));
        return output;
      } catch (error) {
        add(id, "fail", detail(error), recovery);
        return undefined;
      }
    };
    const xcodeRecovery = [
      "Open Xcode Settings > Locations and select the full Xcode command line tools.",
      "xcodebuild -version",
    ];
    await probe("xcode", ["xcodebuild", "-version"], xcodeRecovery);
    await probe(
      "simulator-sdk",
      ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"],
      xcodeRecovery,
    );
    const compiler = await probe(
      "compiler",
      ["xcrun", "--sdk", "iphonesimulator", "--find", "clang"],
      xcodeRecovery,
    );
    if (compiler)
      await probe(
        "compiler-executable",
        [compiler, "--version"],
        xcodeRecovery,
      );
    let runtimeIds: Set<string> | undefined;
    let devices: Record<string, unknown> | undefined;
    try {
      const listing: unknown = JSON.parse(
        await deps.run(
          ["xcrun", "simctl", "list", "runtimes", "--json"],
          10000,
        ),
      );
      if (!object(listing) || !Array.isArray(listing.runtimes))
        throw Error("Invalid simulator runtime metadata");
      runtimeIds = new Set(
        listing.runtimes
          .filter(
            (runtime) =>
              object(runtime) &&
              typeof runtime.identifier === "string" &&
              runtime.identifier.startsWith(
                "com.apple.CoreSimulator.SimRuntime.iOS-",
              ) &&
              runtime.isAvailable === true,
          )
          .map((runtime) => runtime.identifier),
      );
      add(
        "ios-runtimes",
        runtimeIds.size ? "pass" : "fail",
        `${runtimeIds.size} available iOS simulator runtime(s).`,
        runtimeIds.size
          ? undefined
          : ["Install an iOS runtime in Xcode Settings > Components."],
      );
    } catch (error) {
      add("ios-runtimes", "fail", detail(error), [
        "xcrun simctl list runtimes --json",
        "Inspect Xcode Settings > Components.",
      ]);
    }
    try {
      const listing: unknown = JSON.parse(
        await deps.run(["xcrun", "simctl", "list", "devices", "--json"], 10000),
      );
      if (
        !object(listing) ||
        !object(listing.devices) ||
        Object.values(listing.devices).some(
          (entries) => !Array.isArray(entries),
        )
      )
        throw Error("Invalid simulator device metadata");
      devices = listing.devices;
      const available = Object.entries(devices)
        .filter(([runtime]) => runtimeIds?.has(runtime))
        .flatMap(([, entries]) => entries as unknown[])
        .filter(
          (device) =>
            object(device) && uuid(device.udid) && device.isAvailable === true,
        );
      add(
        "ios-devices",
        available.length ? "pass" : "warn",
        `${available.length} available iOS simulator device(s).`,
        available.length
          ? undefined
          : [
              "Create an iOS simulator in Xcode Window > Devices and Simulators.",
            ],
      );
    } catch (error) {
      add("ios-devices", "fail", detail(error), [
        "xcrun simctl list devices --json",
      ]);
    }
    const udid = options.udid?.toUpperCase();
    if (udid) {
      const matches = Object.entries(devices ?? {}).flatMap(
        ([runtime, entries]) =>
          (entries as unknown[])
            .filter(
              (device) =>
                object(device) &&
                typeof device.udid === "string" &&
                device.udid.toUpperCase() === udid,
            )
            .map((device) => ({ runtime, device })),
      );
      const selected = matches.length === 1 ? matches[0] : undefined;
      const ready =
        selected &&
        object(selected.device) &&
        selected.device.isAvailable === true &&
        runtimeIds?.has(selected.runtime) &&
        selected.device.state === "Booted";
      if (!ready) {
        add(
          "device",
          "fail",
          `Simulator ${udid} must be available, uniquely identified, and booted before widget operations.`,
          [
            "widgetctl devices --json",
            ...(selected &&
            object(selected.device) &&
            selected.device.state === "Shutdown" &&
            selected.device.isAvailable === true &&
            runtimeIds?.has(selected.runtime)
              ? [
                  `xcrun simctl boot ${udid}`,
                  `xcrun simctl bootstatus ${udid} -b`,
                ]
              : []),
          ],
        );
        add(
          "app-registration",
          "warn",
          "App registration cannot be inspected until the requested iOS simulator is booted.",
        );
      } else {
        add("device", "pass", `Requested iOS simulator ${udid} is booted.`);
        try {
          const apps = await deps.run(
            ["xcrun", "simctl", "listapps", udid],
            10000,
          );
          if (!apps.trim())
            throw Error("Application registry returned no metadata");
          add(
            "app-registration",
            "pass",
            "Installed application registry is readable. Widget descriptor registration still requires separate verification.",
          );
        } catch (error) {
          add("app-registration", "fail", detail(error), [
            `xcrun simctl listapps ${udid}`,
            `Launch the widget's containing app on ${udid}, then retry widget discovery.`,
          ]);
        }
      }
      await inspectSession(udid, add, deps);
    } else {
      add(
        "device",
        "warn",
        "No device selected; use --device with an explicit UUID to inspect boot and helper state.",
        ["widgetctl devices --json"],
      );
    }
    if (options.stateDirectory) {
      const directory = path.resolve(
        options.stateDirectory.startsWith("~/")
          ? path.join(deps.home, options.stateDirectory.slice(2))
          : options.stateDirectory,
      );
      try {
        const info = await deps.stat(directory);
        const safe =
          info.isDirectory() &&
          !info.isSymbolicLink() &&
          info.uid === deps.uid &&
          !(info.mode & 0o022);
        add(
          "state-directory",
          safe ? "pass" : "fail",
          safe
            ? `State directory metadata is safe: ${directory}`
            : `State directory has unsafe ownership, permissions, or type: ${directory}`,
        );
      } catch (error) {
        add(
          "state-directory",
          missing(error) ? "warn" : "fail",
          missing(error)
            ? `State directory does not exist yet: ${directory}`
            : detail(error),
        );
      }
    }
    add(
      "widget-registration",
      "warn",
      "Launch the widget's containing app before catalog discovery. Read-only diagnostics cannot establish SpringBoard descriptor registration or private API compatibility; verify a rendered widget on the requested simulator.",
    );
    return report();
  };
}

async function inspectSession(
  udid: string,
  add: (
    id: string,
    status: DoctorCheck["status"],
    message: string,
    recovery?: string[],
  ) => unknown,
  deps: DoctorDependencies,
) {
  const root = path.join(deps.home, "Library/Caches/widgetctl");
  const session = path.join(root, "sessions", udid);
  try {
    for (const directory of [root, path.join(root, "sessions"), session]) {
      const info = await deps.stat(directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== deps.uid ||
        info.mode & 0o022
      )
        throw Error(`Unsafe helper session directory: ${directory}`);
    }
    try {
      const lock = await deps.stat(path.join(session, "runner.lock"));
      if (
        !lock.isFile() ||
        lock.isSymbolicLink() ||
        lock.uid !== deps.uid ||
        lock.mode & 0o022
      )
        throw Error("Unsafe helper lock file");
      add(
        "helper-lock",
        "warn",
        "Runner lock file exists. File presence does not establish an active lock; doctor does not acquire or alter it.",
      );
    } catch (error) {
      if (!missing(error)) throw error;
      add("helper-lock", "pass", "No runner lock file exists.");
    }
    try {
      const heartbeat: unknown = JSON.parse(
        await deps.read(path.join(session, "heartbeat.json")),
      );
      const fresh =
        object(heartbeat) &&
        heartbeat.udid === udid &&
        typeof heartbeat.timestamp === "number" &&
        Number.isFinite(heartbeat.timestamp) &&
        Math.abs(deps.now() / 1000 - heartbeat.timestamp) <= 3 &&
        deps.alive(heartbeat.pid);
      add(
        "helper-heartbeat",
        fresh ? "pass" : "warn",
        fresh
          ? `Fresh helper heartbeat for ${udid}; this is a snapshot, not a runtime compatibility test.`
          : `Helper heartbeat for ${udid} is stale or invalid. No state was changed.`,
        fresh ? undefined : [`widgetctl doctor --device ${udid}`],
      );
    } catch (error) {
      add(
        "helper-heartbeat",
        "warn",
        missing(error)
          ? "No helper heartbeat exists; a helper has not been started or has exited."
          : `Cannot inspect helper heartbeat: ${detail(error)}`,
      );
    }
  } catch (error) {
    add(
      "helper-session",
      missing(error) ? "pass" : "fail",
      missing(error) ? `No helper session exists for ${udid}.` : detail(error),
    );
  }
}
export const doctor = createDoctor();
