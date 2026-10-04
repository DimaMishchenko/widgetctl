import path from "node:path";
import os from "node:os";
import * as fs from "node:fs/promises";
import {
  type Dict,
  type Target,
  object,
  uuid,
  equal,
  verifyIconstate,
  persistedTarget,
  validateHomeTarget,
  exclusiveTargets,
  validateTargetBatch,
  removalOutcome,
  homeWidgetPosition,
  positioningOutcome,
  preservation,
  homeIdentities,
  validateConfiguration,
  selectBootedDevice,
} from "./backend-model.js";
import {
  runtime,
  type Runtime,
  prepareDirectory,
  withLock,
  atomicJson,
  readJson,
} from "./backend-runtime.js";
export interface BackendOptions {
  udid: string;
  mode:
    | "prepare"
    | "unload"
    | "inspect"
    | "ensure"
    | "remove"
    | "exportConfiguration"
    | "applyConfiguration";
  extension?: string;
  kind?: string;
  size?: "small" | "medium" | "large";
  container?: string;
  exclusive?: boolean;
  replace?: boolean;
  position?: "top";
  iconIdentifier?: string;
  architecture?: "arm64" | "x86_64";
  launchDomain?: string;
  stateDirectory?: string;
  configuration?: Dict;
}
export interface BackendResult {
  status: string;
  timings: Record<string, number>;
  [key: string]: any;
}
export function validateOptions(o: BackendOptions): string {
  if (!uuid(o.udid)) throw Error("UDID must be an explicit UUID");
  if (
    ![
      "prepare",
      "unload",
      "inspect",
      "ensure",
      "remove",
      "exportConfiguration",
      "applyConfiguration",
    ].includes(o.mode)
  )
    throw Error("Invalid operation mode");
  if (o.mode !== "ensure" && (o.exclusive || o.replace || o.position))
    throw Error("Exclusive, replace and position apply only to ensure");
  if (o.position && o.position !== "top") throw Error("Position must be top");
  if (o.iconIdentifier && !uuid(o.iconIdentifier))
    throw Error("iconIdentifier must be a UUID");
  if (o.launchDomain && !/^user\/\d+$/.test(o.launchDomain))
    throw Error("Launch domain must be user/UID");
  if (o.architecture && !["arm64", "x86_64"].includes(o.architecture))
    throw Error("Unsupported simulator architecture");
  if (["prepare", "unload", "inspect"].includes(o.mode)) {
    if (o.extension || o.kind || o.size || o.container)
      throw Error(
        "Lifecycle and inspection operations accept only UDID and lifecycle options",
      );
    if (o.iconIdentifier && o.mode !== "inspect")
      throw Error("Lifecycle operations do not accept iconIdentifier");
  } else if (
    !o.extension?.trim() ||
    !o.kind?.trim() ||
    !["small", "medium", "large"].includes(o.size ?? "")
  )
    throw Error(
      "Widget operations require extension, kind and small/medium/large size",
    );
  if (o.configuration && o.mode !== "applyConfiguration")
    throw Error("Configuration is accepted only for applyConfiguration");
  return o.udid.toUpperCase();
}
export function createBackend(
  r: Runtime = runtime,
  globalRoot = path.join(os.homedir(), "Library/Caches/widgetctl"),
): (o: BackendOptions) => Promise<BackendResult> {
  return async (o) => {
    const out: BackendResult = { status: "failed", timings: {} };
    try {
      const udid = validateOptions(o);
      Object.assign(out, { udid, mode: o.mode });
      const root = await prepareDirectory(globalRoot);
      const state = await prepareDirectory(o.stateDirectory ?? root);
      out.state_dir = state;
      const sessions = await prepareDirectory(path.join(root, "sessions"));
      const session = await prepareDirectory(path.join(sessions, udid));
      return await withLock(path.join(session, "runner.lock"), async () => {
        const listing = JSON.parse(
          await r.command(["xcrun", "simctl", "list", "devices", "--json"]),
        );
        const device = selectBootedDevice(
          Object.values(listing.devices).flat() as Dict[],
          udid,
        );
        const runtimeIds = Object.entries(listing.devices)
          .filter(([, devices]) =>
            (devices as Dict[]).some(
              (d) =>
                typeof d.udid === "string" && d.udid.toUpperCase() === udid,
            ),
          )
          .map(([id]) => id);
        if (
          runtimeIds.length !== 1 ||
          !runtimeIds[0]!.startsWith("com.apple.CoreSimulator.SimRuntime.iOS-")
        )
          throw Error(
            "Only one explicitly booted iOS simulator runtime is supported",
          );
        const sim = (...args: string[]) =>
          r.command(["xcrun", "simctl", "spawn", udid, ...args]);
        const domain =
          o.launchDomain ??
          `user/${(await sim("launchctl", "manageruid")).trim()}`;
        if (!/^user\/\d+$/.test(domain))
          throw Error("Simulator did not report a numeric launch-user UID");
        const target = `${domain}/com.apple.SpringBoard`;
        out.springboard_target = target;
        const pid = async () => {
          const text = await sim("launchctl", "print", target);
          const match = /^\s*pid\s*=\s*(\d+)\s*$/m.exec(text);
          return match ? Number(match[1]) : null;
        };
        const injectionPath = path.join(session, "injection.json");
        const paths = [
          path.join(
            device.dataPath ??
              path.join(
                os.homedir(),
                "Library/Developer/CoreSimulator/Devices",
                udid,
                "data",
              ),
            "Library/SpringBoard/IconState.plist",
          ),
          path.join(
            device.dataPath ??
              path.join(
                os.homedir(),
                "Library/Developer/CoreSimulator/Devices",
                udid,
                "data",
              ),
            "home/mobile/Library/SpringBoard/IconState.plist",
          ),
        ];
        const finish = (status: string, extra: Dict = {}) =>
          Object.assign(out, { status }, extra);
        const wait = async (
          check: (after: Dict) => string | null,
          ms = 5000,
        ): Promise<
          [boolean, string | null, Dict | null, string | null, number]
        > => {
          const started = r.now();
          let error: string | null = null,
            after: Dict | null = null,
            p: string | null = null;
          do {
            try {
              [after, p] = await r.loadIconstate(paths);
              error = check(after);
              if (!error)
                return [true, null, after, p, (r.now() - started) / 1000];
            } catch (e) {
              error = String(e);
            }
            await r.sleep(100);
          } while (r.now() - started < ms);
          return [false, error, after, p, (r.now() - started) / 1000];
        };
        if (o.mode === "unload") {
          await fs.rm(path.join(session, "command.json"), { force: true });
          const before = await r.heartbeat(session);
          const previous = await pid();
          const injection = await readJson(injectionPath);
          const owned =
            object(injection) &&
            injection.udid === udid &&
            injection.target === target;
          const pending = owned && injection.pending === true;
          const active =
            owned &&
            Number.isInteger(injection.pid) &&
            injection.pid === previous;
          if (!pending && !active && (!before || before.pid !== previous)) {
            await fs.rm(injectionPath, { force: true });
            return finish("unloaded", {
              no_op: true,
              springboard_pid: previous,
            });
          }
          const started = r.now();
          if (pending)
            await sim(
              "launchctl",
              "debug",
              target,
              "--environment",
              "DYLD_INSERT_LIBRARIES=",
              "WIDGETCTL_SESSION_DIR=",
              "WIDGETCTL_IDENTITY=",
              "WIDGETCTL_UDID=",
            );
          await sim("launchctl", "kickstart", "-k", target);
          let next: number | null = null;
          while (r.now() - started < 45000) {
            next = await pid();
            if (next && next !== previous) break;
            await r.sleep(200);
          }
          out.timings.injection_restart_seconds = (r.now() - started) / 1000;
          if (!next || next === previous)
            throw Error(
              "SpringBoard did not publish a new target PID after unload restart",
            );
          const observation = r.now();
          let unexpected: Dict | null = null;
          while (r.now() - observation < 3000) {
            unexpected = await r.heartbeat(session);
            if (unexpected) break;
            await r.sleep(100);
          }
          out.timings.unload_observation_seconds =
            (r.now() - observation) / 1000;
          if (!unexpected) {
            await fs.rm(injectionPath, { force: true });
            await fs.rm(path.join(session, "heartbeat.json"), { force: true });
          }
          return finish(unexpected ? "worker_still_live" : "unloaded", {
            previous_heartbeat: before,
            previous_springboard_pid: previous,
            springboard_pid: next,
          });
        }
        await fs.rm(path.join(session, "command.json"), { force: true });
        let existing: Dict = { iconLists: [] },
          existingMatches: Dict[] = [],
          ids: Target | null = null;
        if (!["inspect", "prepare"].includes(o.mode)) {
          [existing] = await r.loadIconstate(paths);
          existingMatches = verifyIconstate(
            existing,
            o.extension!,
            o.kind!,
            o.size!,
          );
          out.iconstate_before = existingMatches;
          if (o.iconIdentifier) {
            existingMatches = existingMatches.filter(
              (v) => v.displayIdentifier === o.iconIdentifier,
            );
            if (existingMatches.length !== 1)
              throw Error(
                "Explicit iconIdentifier must identify exactly one widget matching the requested tuple",
              );
          } else if (existingMatches.length > 1)
            return finish("duplicate_existing_widgets", {
              error:
                "Multiple Home widgets already match this kind and size; no widget command sent",
            });
          if (
            ["exportConfiguration", "applyConfiguration"].includes(o.mode) &&
            !existingMatches.length
          )
            throw Error(
              "Configuration export requires one installed persisted widget tuple",
            );
          if (o.mode === "remove" && !existingMatches.length)
            return finish("removed", { no_op: true, iconstate_matches: [] });
          ids = existingMatches.length
            ? persistedTarget(existingMatches[0]!)
            : null;
          if (ids) validateHomeTarget(existing, ids);
        }
        const originalIds = ids;
        const scoped = o.exclusive
          ? exclusiveTargets(existing, o.extension!, ids)
          : [];
        const replaced = o.replace ? ids : null;
        if (replaced) {
          scoped.push(replaced);
          out.replaced_identifiers = replaced;
        }
        let configBindings: Dict | null = null;
        if (["exportConfiguration", "applyConfiguration"].includes(o.mode)) {
          const container = existingMatches[0]!.containerBundleIdentifier;
          if (
            typeof container !== "string" ||
            !container ||
            (o.container && o.container !== container)
          )
            throw Error(
              "Configuration requires the exact persisted app container identifier",
            );
          configBindings = {
            udid,
            extension: o.extension,
            container,
            kind: o.kind,
            size: o.size,
            ...ids,
          };
          if (o.mode === "applyConfiguration")
            validateConfiguration(o.configuration, configBindings);
        }
        const [worker, identity] = await r.compileWorker(
          state,
          udid,
          listing,
          o.architecture,
          r.command,
        );
        out.worker_path = worker;
        let live = await r.heartbeat(session);
        if (
          live &&
          (live.protocol !== 1 ||
            live.identity !== identity ||
            live.ready !== true)
        )
          live = null;
        if (live && (await pid()) !== live.pid) live = null;
        if (!live) {
          const started = r.now();
          await fs.rm(path.join(session, "heartbeat.json"), { force: true });
          await atomicJson(injectionPath, {
            udid,
            target,
            pending: true,
            identity,
          });
          await sim(
            "launchctl",
            "debug",
            target,
            "--environment",
            `DYLD_INSERT_LIBRARIES=${worker}`,
            `WIDGETCTL_SESSION_DIR=${session}`,
            `WIDGETCTL_IDENTITY=${identity}`,
            `WIDGETCTL_UDID=${udid}`,
          );
          await sim("launchctl", "kickstart", "-k", target);
          while (r.now() - started < 45000) {
            live = await r.heartbeat(session);
            if (
              live &&
              live.protocol === 1 &&
              live.identity === identity &&
              live.ready === true &&
              (await pid()) === live.pid
            )
              break;
            live = null;
            await r.sleep(100);
          }
          out.timings.injection_restart_seconds = (r.now() - started) / 1000;
          if (!live)
            throw Error(
              "Injected worker did not publish a live heartbeat within 45 seconds",
            );
        } else out.timings.injection_restart_seconds = 0;
        await atomicJson(injectionPath, {
          udid,
          target,
          pending: false,
          identity,
          pid: live.pid,
        });
        out.worker = live;
        out.springboard_pid = live.pid;
        if (o.mode === "prepare") return finish("ready");
        if (scoped.length) {
          const validationTargets =
            ids && !scoped.some((t) => equal(t, ids))
              ? [ids, ...scoped]
              : scoped;
          const prefix = o.exclusive ? "exclusive" : "replace";
          const desired: Dict = {
            extension: o.extension,
            kind: o.kind,
            size: o.size,
          };
          if (o.container) desired.container = o.container;
          const [validation, elapsed] = await r.requestWorker(session, live, {
            mode: "validate",
            targets: validationTargets,
            desired,
            ...(o.position ? { position: o.position } : {}),
          });
          out[`${prefix}_preflight`] = validation;
          out.timings[`${prefix}_preflight_seconds`] = elapsed;
          if (validation.status === "error")
            return finish(`${prefix}_preflight_rejected`, {
              error: validation.error,
            });
          validateTargetBatch(validation, validationTargets, desired);
          out[`${prefix}_removals`] = [];
          for (const t of scoped) {
            const [before] = await r.loadIconstate(paths);
            const [response, commandSeconds] = await r.requestWorker(
              session,
              live,
              { mode: "remove", ...t },
              t,
            );
            const result: Dict = {
              identifiers: t,
              response,
              command_seconds: commandSeconds,
            };
            out[`${prefix}_removals`].push(result);
            if (response.status === "error")
              return finish(`${prefix}_removal_rejected`, {
                error: response.error,
              });
            if (response.status !== "removal_submitted")
              throw Error(
                "Exclusive removal received an unexpected worker response",
              );
            const [verified, error, , , seconds] = await wait((after) =>
              removalOutcome(before, after, t),
            );
            result.verification_seconds = seconds;
            if (!verified)
              return finish(`${prefix}_removal_unverified`, {
                verification_error: error,
              });
          }
        }
        if (replaced) ids = null;
        let positionBefore: Dict | null = null;
        if (o.position && ids) {
          [positionBefore] = await r.loadIconstate(paths);
          homeWidgetPosition(positionBefore, ids);
        }
        const payload: Dict = { mode: o.mode };
        if (ids) Object.assign(payload, ids);
        if (o.position && ids) payload.position = o.position;
        if (o.iconIdentifier && o.mode === "inspect")
          payload.iconIdentifier = o.iconIdentifier;
        if (o.mode !== "inspect")
          Object.assign(payload, {
            extension: o.extension,
            kind: o.kind,
            size: o.size,
          });
        if (o.container) payload.container = o.container;
        if (configBindings) Object.assign(payload, configBindings);
        if (o.mode === "applyConfiguration")
          payload.configuration = o.configuration;
        const [response, elapsed] = await r.requestWorker(
          session,
          live,
          payload,
          ids,
        );
        out.response = response;
        out.timings.command_seconds = elapsed;
        if (response.status === "error")
          return finish("worker_rejected", { error: response.error });
        if (o.mode === "applyConfiguration") {
          if (
            response.status !== "configuration_applied" ||
            response.roundtripVerified !== true ||
            response.widgetIdentityVerified !== true ||
            response.archiving !== true
          )
            throw Error(
              "Worker did not prove archived configuration apply and exact live readback",
            );
          const updated = persistedTarget({
            displayIdentifier: ids!.iconIdentifier,
            uniqueIdentifier: response.appliedWidgetIdentifier,
          });
          const configuration = validateConfiguration(response.configuration, {
            ...configBindings,
            ...updated,
          });
          if (
            !equal(configuration.intent, o.configuration!.intent) ||
            !equal(response.roundtrip, configuration.intent)
          )
            throw Error(
              "Configuration readback differs from the full requested intent",
            );
          const [verified, error, current, , seconds] = await wait((after) => {
            const matches = verifyIconstate(
              after,
              o.extension!,
              o.kind!,
              o.size!,
            );
            const selected = matches.filter(
              (v) => v.displayIdentifier === updated.iconIdentifier,
            );
            if (
              selected.length !== 1 ||
              !equal(persistedTarget(selected[0]!), updated)
            )
              return "Updated configuration widget identity did not persist";
            const expected = homeIdentities(existing);
            const oldKey = JSON.stringify([
                "uniqueIdentifier",
                ids!.widgetIdentifier,
              ]),
              newKey = JSON.stringify([
                "uniqueIdentifier",
                updated.widgetIdentifier,
              ]);
            expected.set(oldKey, (expected.get(oldKey) ?? 0) - 1);
            expected.set(newKey, (expected.get(newKey) ?? 0) + 1);
            for (const [k, n] of expected) if (n <= 0) expected.delete(k);
            if (!equal(expected, homeIdentities(after)))
              throw Error("Configuration apply changed other Home identities");
            return null;
          });
          out.timings.configuration_persistence_seconds = seconds;
          if (!verified)
            throw Error(error ?? "Configuration persistence unverified");
          return finish("configuration_applied", {
            configuration,
            iconstate_matches: verifyIconstate(
              current!,
              o.extension!,
              o.kind!,
              o.size!,
            ),
          });
        }
        if (o.mode === "exportConfiguration") {
          if (
            response.status !== "configuration_exported" ||
            response.roundtripVerified !== true ||
            response.widgetIdentityVerified !== true
          )
            throw Error(
              "Worker did not prove exact configuration identity and detached roundtrip",
            );
          const configuration = validateConfiguration(
            response.configuration,
            configBindings!,
          );
          if (!equal(response.roundtrip, configuration.intent))
            throw Error(
              "Worker roundtrip differs from the canonical exported intent",
            );
          const [current] = await r.loadIconstate(paths);
          const matches = verifyIconstate(
            current,
            o.extension!,
            o.kind!,
            o.size!,
          ).filter((v) => v.displayIdentifier === ids!.iconIdentifier);
          if (matches.length !== 1 || !equal(persistedTarget(matches[0]!), ids))
            throw Error(
              "Configuration target persisted identity changed during export",
            );
          const changed = preservation(existing, current);
          if (changed) throw Error(changed);
          return finish("configuration_exported", { configuration });
        }
        if (o.mode === "inspect") {
          if (response.status !== "inspected" || !object(response.inspection))
            throw Error(
              "Inspection command received an invalid worker response",
            );
          return finish("inspected");
        }
        if (o.mode === "remove") {
          if (response.status !== "removal_submitted")
            throw Error(
              "Removal command received an unexpected worker response status",
            );
          const [verified, error, , p, seconds] = await wait((after) =>
            removalOutcome(existing, after, ids!),
          );
          out.timings.iconstate_verification_seconds = seconds;
          return finish(verified ? "removed" : "removal_unverified", {
            removed_identifiers: ids,
            iconstate_path: p,
            ...(error ? { verification_error: error } : {}),
          });
        }
        if (response.status !== "submitted")
          throw Error(
            "Placement command received an unexpected worker response status",
          );
        let matches: Dict[] = [];
        const [verified, error, placed, p, seconds] = await wait((after) => {
          matches = verifyIconstate(after, o.extension!, o.kind!, o.size!);
          if (o.iconIdentifier && ids)
            matches = matches.filter(
              (v) => v.displayIdentifier === ids!.iconIdentifier,
            );
          return matches.length
            ? null
            : "No IconState entry matches extension, kind, and grid size";
        });
        out.timings.iconstate_verification_seconds = seconds;
        out.iconstate_path = p;
        out.iconstate_matches = matches;
        if (!verified || matches.length !== 1)
          return finish("response_received_but_iconstate_unverified", {
            verification_error:
              error ??
              "Multiple IconState entries match the requested widget and size",
          });
        let current = placed!;
        if (ids && !equal(persistedTarget(matches[0]!), ids))
          return finish("reveal_persistence_unverified", {
            verification_error:
              "Existing revealed widget persisted identity changed",
          });
        if (!ids) {
          ids = persistedTarget(matches[0]!);
          validateHomeTarget(current, ids);
          if (o.position) {
            positionBefore = current;
            homeWidgetPosition(current, ids);
          }
          const [reveal, revealSeconds] = await r.requestWorker(
            session,
            live,
            {
              mode: "ensure",
              ...ids,
              ...(o.position ? { position: o.position } : {}),
            },
            ids,
          );
          out.reveal_response = reveal;
          out.timings.reveal_seconds = revealSeconds;
          if (reveal.status === "error")
            return finish("reveal_rejected", { error: reveal.error });
          if (reveal.status !== "submitted" || reveal.action !== "reveal")
            throw Error(
              "Reveal command received an unexpected worker response",
            );
          [current] = await r.loadIconstate(paths);
          matches = verifyIconstate(current, o.extension!, o.kind!, o.size!);
          if (matches.length !== 1 || !equal(persistedTarget(matches[0]!), ids))
            return finish("reveal_persistence_unverified", {
              verification_error: "Revealed widget persisted identity changed",
            });
        }
        if (o.position) {
          const [ok, failure, after, , duration] = await wait((after) =>
            positioningOutcome(positionBefore!, after, ids!),
          );
          out.timings.position_verification_seconds = duration;
          if (!ok)
            return finish("position_unverified", {
              verification_error: failure,
            });
          current = after!;
          out.position = {
            page: homeWidgetPosition(current, ids)[0],
            index: 0,
          };
        }
        if (o.exclusive) {
          [current] = await r.loadIconstate(paths);
          if (exclusiveTargets(current, o.extension!, ids).length)
            return finish("exclusive_persistence_unverified", {
              verification_error:
                "Other widgets from the requested extension remain in Home IconState",
            });
          const failure = preservation(
            existing,
            current,
            scoped,
            !originalIds || replaced ? [ids] : [],
          );
          if (failure)
            return finish("exclusive_persistence_unverified", {
              verification_error: failure,
            });
        }
        if (replaced) {
          [current] = await r.loadIconstate(paths);
          const failure =
            ids.iconIdentifier === replaced.iconIdentifier ||
            ids.widgetIdentifier === replaced.widgetIdentifier
              ? "Replacement reused a removed widget identifier"
              : preservation(
                  existing,
                  current,
                  scoped,
                  !originalIds || replaced ? [ids] : [],
                );
          if (failure)
            return finish("replacement_persistence_unverified", {
              verification_error: failure,
            });
        }
        const lost = preservation(
          existing,
          current,
          scoped,
          !originalIds || replaced ? [ids] : [],
        );
        if (lost)
          return finish("placement_persistence_unverified", {
            verification_error: lost,
          });
        out.iconstate_after = verifyIconstate(
          current,
          o.extension!,
          o.kind!,
          o.size!,
        );
        return finish("verified", {
          iconstate_matches: matches,
          iconIdentifier: ids.iconIdentifier,
          widgetIdentifier: ids.widgetIdentifier,
        });
      });
    } catch (e) {
      out.status = "failed";
      out.error = e instanceof Error ? e.message : String(e);
      return out;
    }
  };
}
export const runOperation = createBackend();
