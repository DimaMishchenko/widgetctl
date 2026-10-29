import plist from "plist";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { command } from "./backend-runtime.js";
import { object, uuid } from "./backend-model.js";

export interface Simulator {
  udid: string;
  name: string;
  state: "booted" | "shutdown";
  runtime: string;
}
export interface Application {
  bundleIdentifier: string;
  name: string;
  path?: string;
}
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export function createDiscovery(run = command) {
  const listSimulators = async (): Promise<Simulator[]> => {
    const results = await Promise.allSettled([
      run(["xcrun", "simctl", "list", "devices", "--json"]),
      run(["xcrun", "simctl", "list", "runtimes", "--json"]),
    ]);
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    const listing: unknown = JSON.parse(
      (results[0] as PromiseFulfilledResult<string>).value,
    );
    const runtimes: unknown = JSON.parse(
      (results[1] as PromiseFulfilledResult<string>).value,
    );
    if (
      !object(listing) ||
      !object(listing.devices) ||
      !object(runtimes) ||
      !Array.isArray(runtimes.runtimes)
    )
      throw Error("Invalid simulator discovery metadata");
    const available = new Map<string, string>();
    for (const runtime of runtimes.runtimes) {
      if (!object(runtime) || !nonempty(runtime.identifier))
        throw Error("Invalid simulator runtime metadata");
      if (
        !runtime.identifier.startsWith(
          "com.apple.CoreSimulator.SimRuntime.iOS-",
        ) ||
        runtime.isAvailable !== true
      )
        continue;
      if (!nonempty(runtime.version))
        throw Error("Simulator runtime is missing its version");
      if (available.has(runtime.identifier))
        throw Error("Ambiguous simulator runtime metadata");
      available.set(runtime.identifier, runtime.version);
    }
    const devices: Simulator[] = [];
    const seen = new Set<string>();
    for (const [runtime, entries] of Object.entries(listing.devices)) {
      if (!available.has(runtime)) continue;
      if (!Array.isArray(entries))
        throw Error("Invalid simulator device metadata");
      for (const device of entries) {
        if (!object(device)) throw Error("Invalid simulator device metadata");
        if (
          device.isAvailable !== true ||
          !["Booted", "Shutdown"].includes(device.state)
        )
          continue;
        if (!uuid(device.udid) || !nonempty(device.name))
          throw Error("Simulator is missing its identity or name");
        const udid = device.udid.toUpperCase();
        if (seen.has(udid)) throw Error("Ambiguous simulator device identity");
        seen.add(udid);
        devices.push({
          udid,
          name: device.name,
          state: device.state === "Booted" ? "booted" : "shutdown",
          runtime: available.get(runtime)!,
        });
      }
    }
    return devices;
  };
  const listApplications = async (udid: string): Promise<Application[]> => {
    if (!uuid(udid)) throw Error("UDID must be an explicit UUID");
    udid = udid.toUpperCase();
    const devices = await listSimulators();
    if (
      devices.filter(
        (device) => device.udid === udid && device.state === "booted",
      ).length !== 1
    )
      throw Error(
        "Application discovery requires the explicitly requested available booted iOS simulator",
      );
    const text = await run(["xcrun", "simctl", "listapps", udid]);
    let listing: unknown;
    try {
      listing = JSON.parse(text);
    } catch {
      try {
        if (!text.trimStart().startsWith("<"))
          throw Error("Application metadata requires plist conversion");
        listing = plist.parse(text);
      } catch {
        const temporary = await fs.mkdtemp(
          path.join(os.tmpdir(), "widgetctl-apps-"),
        );
        try {
          const file = path.join(temporary, "apps.plist");
          await fs.writeFile(file, text, { mode: 0o600 });
          listing = JSON.parse(
            await run(["/usr/bin/plutil", "-convert", "json", "-o", "-", file]),
          );
        } finally {
          await fs.rm(temporary, { recursive: true, force: true });
        }
      }
    }
    if (!object(listing)) throw Error("Invalid installed application metadata");
    const apps: Application[] = [];
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(listing)) {
      if (!object(value)) throw Error("Invalid installed application metadata");
      const id = value.CFBundleIdentifier ?? key;
      const name = value.CFBundleDisplayName ?? value.CFBundleName;
      if (!nonempty(id) || !nonempty(name))
        throw Error(
          "Installed application is missing its bundle identifier or name",
        );
      if (seen.has(id)) throw Error("Ambiguous installed application identity");
      seen.add(id);
      const appPath = value.Path ?? value.Bundle;
      if (appPath !== undefined && !nonempty(appPath))
        throw Error("Invalid application path");
      apps.push({
        bundleIdentifier: id,
        name,
        ...(appPath ? { path: appPath } : {}),
      });
    }
    return apps;
  };
  return { listSimulators, listApplications };
}
export const { listSimulators, listApplications } = createDiscovery();
