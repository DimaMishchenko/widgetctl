import { WidgetctlError } from "./errors.js";
import { isDeepStrictEqual } from "node:util";
export type Dict = Record<string, any>;
export type Target = { iconIdentifier: string; widgetIdentifier: string };
export const object = (v: unknown): v is Dict =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const equal: (left: unknown, right: unknown) => boolean =
  isDeepStrictEqual;
export function uuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}
export function* records(v: unknown): Generator<Dict> {
  if (object(v)) {
    yield v;
    for (const child of Object.values(v)) yield* records(child);
  } else if (Array.isArray(v)) for (const child of v) yield* records(child);
}
export function verifyIconstate(
  state: Dict,
  extension: string,
  kind: string,
  size: string,
): Dict[] {
  return [...records(state.iconLists ?? [])].filter(
    (v) =>
      (v.widgetIdentifier ?? v.widgetKind ?? v.kind) === kind &&
      (v.extensionBundleIdentifier ??
        v.widgetExtensionBundleIdentifier ??
        v.bundleIdentifier) === extension &&
      String(v.gridSize ?? v.gridSizeClass ?? v.sizeClass)
        .toLowerCase()
        .replaceAll(" ", "") === size,
  );
}
export function persistedTarget(v: Dict): Target {
  if (!uuid(v.displayIdentifier) || !uuid(v.uniqueIdentifier))
    throw Error(
      "Widget persisted displayIdentifier and uniqueIdentifier must be UUIDs",
    );
  return {
    iconIdentifier: v.displayIdentifier,
    widgetIdentifier: v.uniqueIdentifier,
  };
}
export function homeIdentities(state: Dict): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string, v: string) => {
    const key = JSON.stringify([k, v]);
    out.set(key, (out.get(key) ?? 0) + 1);
  };
  const visit = (v: unknown): void => {
    if (object(v)) {
      for (const k of ["displayIdentifier", "uniqueIdentifier"])
        if (typeof v[k] === "string") add(k, v[k]);
      for (const child of Object.values(v))
        if (object(child) || Array.isArray(child)) visit(child);
    } else if (Array.isArray(v))
      for (const child of v) {
        if (typeof child === "string") add("leaf", child);
        else visit(child);
      }
  };
  visit(state.iconLists ?? []);
  return out;
}
const key = (field: string, id: string) => JSON.stringify([field, id]);
export function validateHomeTarget(state: Dict, t: Target): void {
  const ids = homeIdentities(state);
  if (
    ids.get(key("displayIdentifier", t.iconIdentifier)) !== 1 ||
    ids.get(key("uniqueIdentifier", t.widgetIdentifier)) !== 1
  )
    throw Error(
      "Targeted widget identifiers must each identify exactly one Home entry",
    );
}
export function preservation(
  before: Dict,
  after: Dict,
  removed: Target[] = [],
  added: Target[] = [],
): string | null {
  const expected = homeIdentities(before);
  for (const t of removed) {
    expected.delete(key("displayIdentifier", t.iconIdentifier));
    expected.delete(key("uniqueIdentifier", t.widgetIdentifier));
  }
  for (const t of added) {
    for (const [field, id] of [
      ["displayIdentifier", t.iconIdentifier],
      ["uniqueIdentifier", t.widgetIdentifier],
    ]) {
      const k = key(field!, id!);
      expected.set(k, (expected.get(k) ?? 0) + 1);
    }
  }
  const current = homeIdentities(after);
  const missing = [...expected].filter(([k, n]) => (current.get(k) ?? 0) < n);
  if (missing.length)
    return `Other Home entries disappeared: ${JSON.stringify(missing)}`;
  return equal(expected, current) ? null : "Other Home identity counts changed";
}
export function removalOutcome(
  before: Dict,
  after: Dict,
  t: Target,
): string | null {
  const ids = homeIdentities(after);
  if (
    ids.has(key("displayIdentifier", t.iconIdentifier)) ||
    ids.has(key("uniqueIdentifier", t.widgetIdentifier))
  )
    return "Targeted Home widget identifiers are still persisted";
  return preservation(before, after, [t]);
}
export function exclusiveTargets(
  state: Dict,
  extension: string,
  desired: Target | null,
): Target[] {
  const targets = [...records(state.iconLists ?? [])]
    .filter(
      (v) =>
        (v.extensionBundleIdentifier ??
          v.widgetExtensionBundleIdentifier ??
          v.bundleIdentifier) === extension &&
        typeof (v.widgetIdentifier ?? v.widgetKind ?? v.kind) === "string",
    )
    .map((v) => {
      const t = persistedTarget(v);
      validateHomeTarget(state, t);
      return t;
    })
    .filter((t) => !equal(t, desired));
  if (
    new Set(targets.map((t) => t.iconIdentifier)).size !== targets.length ||
    new Set(targets.map((t) => t.widgetIdentifier)).size !== targets.length
  )
    throw Error("Exclusive preflight contains duplicate persisted identifiers");
  return targets;
}
export function homeWidgetPosition(state: Dict, t: Target): [number, number] {
  const matches: [number, number][] = [];
  for (const [p, page] of (state.iconLists ?? []).entries())
    if (Array.isArray(page))
      for (const [i, v] of page.entries())
        if (
          object(v) &&
          v.displayIdentifier === t.iconIdentifier &&
          v.uniqueIdentifier === t.widgetIdentifier
        )
          matches.push([p, i]);
  if (matches.length !== 1)
    throw Error(
      "Positioning requires exactly one direct Home page widget entry",
    );
  return matches[0]!;
}
export function positioningOutcome(
  before: Dict,
  after: Dict,
  t: Target,
): string | null {
  if (
    !equal(homeWidgetPosition(after, t), [homeWidgetPosition(before, t)[0], 0])
  )
    return "Widget is not at index zero of its original Home page";
  return preservation(before, after);
}
export function validateResponse(
  v: unknown,
  nonce: string,
  pid: number,
  expected?: Target | null,
): Dict {
  if (!object(v) || v.nonce !== nonce)
    throw Error("Worker response does not match the command nonce");
  if (!Number.isInteger(v.pid) || v.pid !== pid)
    throw Error("Worker response does not match the injected SpringBoard PID");
  if (
    ![
      "catalogued",
      "configuration_choices",
      "submitted",
      "removal_submitted",
      "validated",
      "inspected",
      "configuration_exported",
      "configuration_applied",
      "error",
    ].includes(v.status)
  )
    throw Error("Worker response contains an invalid status");
  if (v.status === "error" && typeof v.error !== "string")
    throw Error("Worker error response must include an error string");
  if (expected && v.status !== "error") {
    for (const [k, id] of Object.entries(expected))
      if (v[k] !== id)
        throw Error(
          "Worker response does not match the targeted persisted identifiers",
        );
    if (typeof v.iconClass !== "string" || v.widgetIdentityVerified !== true)
      throw Error(
        "Worker response is missing concrete widget identity validation",
      );
  }
  return v;
}
export function validateTargetBatch(
  response: Dict,
  targets: Target[],
  desired: Dict,
): void {
  if (
    !object(response.desired) ||
    Object.entries(desired).some(([k, v]) => response.desired[k] !== v) ||
    typeof response.desired.descriptor !== "string"
  )
    throw Error(
      "Worker did not validate the desired widget descriptor and family",
    );
  if (
    response.status !== "validated" ||
    !Array.isArray(response.targets) ||
    response.targets.length !== targets.length
  )
    throw Error("Worker did not validate all exclusive targets");
  for (const [i, t] of targets.entries()) {
    const v = response.targets[i];
    if (
      !object(v) ||
      Object.entries(t).some(([k, id]) => v[k] !== id) ||
      typeof v.iconClass !== "string" ||
      v.widgetIdentityVerified !== true
    )
      throw Error(
        "Worker batch validation omitted exact concrete widget identity",
      );
  }
}
export function validateConfiguration(v: unknown, expected: Dict): Dict {
  if (!object(v) || v.schemaVersion !== 1)
    throw new WidgetctlError("Configuration requires schemaVersion 1", {
      code: "INVALID_INPUT",
    });
  for (const [k, value] of Object.entries(expected))
    if (v[k] !== value)
      throw new WidgetctlError(
        `Configuration ${k} does not match the current widget`,
        { code: "IDENTITY_MISMATCH" },
      );
  const i = v.intent;
  if (
    !object(i) ||
    !equal(
      Object.keys(i).sort(),
      [
        "intentClass",
        "appBundleIdentifier",
        "extensionBundleIdentifier",
        "appIntentIdentifier",
        "parameters",
      ].sort(),
    )
  )
    throw Error(
      "Configuration must include the full canonical intent envelope",
    );
  if (
    i.intentClass !== "INAppIntent" ||
    i.appBundleIdentifier !== expected.container ||
    i.extensionBundleIdentifier !== expected.extension
  )
    throw new WidgetctlError(
      "Configuration intent class, app, or extension does not match the widget",
      { code: "IDENTITY_MISMATCH" },
    );
  if (
    typeof i.appIntentIdentifier !== "string" ||
    !i.appIntentIdentifier ||
    !object(i.parameters)
  )
    throw Error(
      "Configuration requires an intent identifier and full parameter dictionary",
    );
  function json(value: unknown): void {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      for (const c of value) json(c);
      return;
    }
    if (object(value) && Object.getPrototypeOf(value) === Object.prototype) {
      for (const c of Object.values(value)) json(c);
      return;
    }
    throw Error("Configuration must contain only finite JSON values");
  }
  json(v);
  return v;
}
export function selectBootedDevice(devices: Dict[], requested: string): Dict {
  const matches = devices.filter(
    (d) => typeof d.udid === "string" && d.udid.toUpperCase() === requested,
  );
  if (
    matches.length !== 1 ||
    matches[0]!.state !== "Booted" ||
    matches[0]!.isAvailable === false
  )
    throw new WidgetctlError(
      "The explicitly requested simulator must already be available and booted",
      {
        code:
          matches.length === 1 && matches[0]!.isAvailable !== false
            ? "DEVICE_NOT_BOOTED"
            : "DEVICE_NOT_FOUND",
      },
    );
  return matches[0]!;
}
export function targetIdentity(
  listing: Dict,
  runtimes: Dict,
  requested: string,
  architecture: string,
): [string, Dict] {
  const ids = Object.entries(listing.devices)
    .filter(([, ds]) =>
      (ds as Dict[]).some((d) => d.udid?.toUpperCase() === requested),
    )
    .map(([id]) => id);
  if (ids.length !== 1)
    throw Error("Requested device must belong to exactly one runtime");
  const runtime = runtimes.runtimes.find((r: Dict) => r.identifier === ids[0]);
  if (
    !runtime ||
    runtime.isAvailable === false ||
    !ids[0]!.startsWith("com.apple.CoreSimulator.SimRuntime.iOS-")
  )
    throw Error("Only iOS simulator runtimes are supported");
  if (!["arm64", "x86_64"].includes(architecture))
    throw Error("Unsupported simulator architecture");
  if (
    runtime.supportedArchitectures !== undefined &&
    (!Array.isArray(runtime.supportedArchitectures) ||
      !runtime.supportedArchitectures.includes(architecture))
  )
    throw Error("Runtime does not support requested architecture");
  if (
    typeof runtime.version !== "string" ||
    !/^\d+(?:\.\d+){1,2}$/.test(runtime.version)
  )
    throw Error("Runtime version must be a numeric iOS version");
  return [`${architecture}-apple-ios${runtime.version}-simulator`, runtime];
}

const nonemptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const widgetSizes = ["small", "medium", "large"];

export function catalogFromResponse(
  response: Dict,
  applications: { bundleIdentifier: string; name: string }[],
): Dict {
  if (response.status !== "catalogued" || !Array.isArray(response.widgets))
    throw Error("Catalog command received an invalid worker response");
  const apps = new Map<string, Dict>();
  const names = new Map(
    applications.map((app) => [app.bundleIdentifier, app.name]),
  );
  const seen = new Set<string>();
  for (const widget of response.widgets) {
    if (
      !object(widget) ||
      ![widget.extension, widget.container, widget.kind].every(
        nonemptyString,
      ) ||
      (widget.name !== undefined && !nonemptyString(widget.name)) ||
      !Array.isArray(widget.sizes) ||
      !widget.sizes.length ||
      !widget.sizes.every(
        (size: unknown) =>
          typeof size === "string" && widgetSizes.includes(size),
      ) ||
      new Set(widget.sizes).size !== widget.sizes.length
    )
      throw Error("Catalog contains invalid widget metadata");
    const key = JSON.stringify([
      widget.extension,
      widget.container,
      widget.kind,
    ]);
    if (seen.has(key))
      throw Error("Catalog contains ambiguous widget descriptors");
    seen.add(key);
    const name = names.get(widget.container) ?? widget.container;
    if (!apps.has(widget.container))
      apps.set(widget.container, {
        bundleIdentifier: widget.container,
        name,
        widgets: [],
      });
    apps.get(widget.container)!.widgets.push({
      ...(widget.name ? { name: widget.name } : {}),
      target: {
        extension: widget.extension,
        container: widget.container,
        kind: widget.kind,
      },
      sizes: widgetSizes.filter((size) => widget.sizes.includes(size)),
    });
  }
  return { apps: [...apps.values()] };
}

export function installedWidgets(state: Dict): Dict[] {
  if (!Array.isArray(state.iconLists))
    throw Error("IconState must contain Home iconLists");
  const direct = new Map<Dict, { page: number; index: number }>();
  for (const [page, entries] of state.iconLists.entries()) {
    if (!Array.isArray(entries)) throw Error("Unsupported Home page structure");
    for (const [index, entry] of entries.entries())
      if (object(entry)) direct.set(entry, { page, index });
  }
  const widgets: Dict[] = [];
  for (const entry of direct.keys()) {
    const kind = entry.widgetIdentifier ?? entry.widgetKind ?? entry.kind;
    const extension =
      entry.extensionBundleIdentifier ??
      entry.widgetExtensionBundleIdentifier ??
      (nonemptyString(kind) ? entry.bundleIdentifier : undefined);
    const candidate =
      entry.elementType === "widget" ||
      entry.extensionBundleIdentifier !== undefined ||
      entry.widgetExtensionBundleIdentifier !== undefined ||
      entry.widgetIdentifier !== undefined ||
      entry.widgetKind !== undefined ||
      (nonemptyString(kind) &&
        nonemptyString(entry.bundleIdentifier) &&
        nonemptyString(entry.containerBundleIdentifier));
    if (!candidate) continue;
    const container = entry.containerBundleIdentifier;
    const size = String(
      entry.gridSize ?? entry.gridSizeClass ?? entry.sizeClass,
    )
      .toLowerCase()
      .replaceAll(" ", "");
    if (
      ![extension, container, kind].every(nonemptyString) ||
      !widgetSizes.includes(size)
    )
      throw Error("Installed widget has incomplete or unsupported metadata");
    const identifiers = [
      [
        entry.extensionBundleIdentifier,
        entry.widgetExtensionBundleIdentifier,
        entry.bundleIdentifier,
      ],
      [entry.widgetIdentifier, entry.widgetKind, entry.kind],
    ];
    for (const values of identifiers)
      if (new Set(values.filter((value) => value !== undefined)).size > 1)
        throw Error("Installed widget has ambiguous persisted metadata");
    const sizes = [entry.gridSize, entry.gridSizeClass, entry.sizeClass]
      .filter((value) => value !== undefined)
      .map((value) => String(value).toLowerCase().replaceAll(" ", ""));
    if (new Set(sizes).size > 1)
      throw Error("Installed widget has ambiguous persisted metadata");
    const ids = persistedTarget(entry);
    validateHomeTarget(state, ids);
    widgets.push({
      target: {
        extension,
        container,
        kind,
        size,
        iconIdentifier: ids.iconIdentifier,
      },
      widgetIdentifier: ids.widgetIdentifier,
      position: direct.get(entry),
    });
  }
  return widgets;
}
