import {
  runOperation,
  type BackendOptions,
  type BackendResult,
} from "./backend.js";

export type WidgetSize = "small" | "medium" | "large";
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type WidgetConfiguration = {
  schemaVersion: 1;
  extension: string;
  kind: string;
  size: WidgetSize;
  container: string;
  intent: {
    intentClass: "INAppIntent";
    appBundleIdentifier: string;
    extensionBundleIdentifier: string;
    appIntentIdentifier: string;
    parameters: Record<string, JsonValue>;
  };
  [key: string]: JsonValue;
};
export interface WidgetTarget {
  extension: string;
  kind: string;
  size: WidgetSize;
  container?: string;
  iconIdentifier?: string;
}
export interface EnsureOptions {
  exclusive?: boolean;
  replace?: boolean;
  position?: "top";
}
export interface WidgetControllerOptions {
  udid: string;
  stateDirectory?: string;
  architecture?: "arm64" | "x86_64";
  launchDomain?: string;
  onResult?: (result: BackendResult) => void;
}
export class WidgetctlError extends Error {
  readonly result?: BackendResult;
  constructor(
    message: string,
    options: { result?: BackendResult; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "WidgetctlError";
    this.result = options.result;
  }
}
const successful: Record<BackendOptions["mode"], string> = {
  prepare: "ready",
  unload: "unloaded",
  inspect: "inspected",
  ensure: "verified",
  remove: "removed",
  exportConfiguration: "configuration_exported",
  applyConfiguration: "configuration_applied",
};
function finiteJson(value: unknown, seen = new Set<object>()): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return;
  if (typeof value !== "object" || seen.has(value))
    throw new WidgetctlError(
      "Configuration must contain finite, acyclic JSON values",
    );
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) finiteJson(item, seen);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype)
      throw new WidgetctlError("Configuration must contain plain JSON objects");
    for (const key of Reflect.ownKeys(value)) {
      if (
        typeof key !== "string" ||
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable
      )
        throw new WidgetctlError(
          "Configuration must contain enumerable JSON keys",
        );
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor))
        throw new WidgetctlError("Configuration cannot contain accessors");
      finiteJson(descriptor.value, seen);
    }
  }
  seen.delete(value);
}
function configuration(
  value: unknown,
  target: WidgetTarget,
): WidgetConfiguration {
  finiteJson(value);
  const config = value as WidgetConfiguration;
  if (
    !config ||
    Array.isArray(config) ||
    config.schemaVersion !== 1 ||
    config.extension !== target.extension ||
    config.kind !== target.kind ||
    config.size !== target.size ||
    typeof config.container !== "string" ||
    !config.container ||
    (target.container && config.container !== target.container)
  )
    throw new WidgetctlError(
      "Configuration envelope does not match the target widget",
    );
  const intent = config.intent;
  if (
    !intent ||
    Array.isArray(intent) ||
    Object.keys(intent).sort().join(",") !==
      [
        "intentClass",
        "appBundleIdentifier",
        "extensionBundleIdentifier",
        "appIntentIdentifier",
        "parameters",
      ]
        .sort()
        .join(",") ||
    intent.intentClass !== "INAppIntent" ||
    intent.extensionBundleIdentifier !== config.extension ||
    intent.appBundleIdentifier !== config.container ||
    typeof intent.appIntentIdentifier !== "string" ||
    !intent.appIntentIdentifier ||
    !intent.parameters ||
    Array.isArray(intent.parameters) ||
    typeof intent.parameters !== "object"
  )
    throw new WidgetctlError(
      "Configuration requires the full canonical intent envelope",
    );
  return structuredClone(config);
}
function validateTarget(target: WidgetTarget): WidgetTarget {
  if (
    !target ||
    typeof target.extension !== "string" ||
    !target.extension.trim() ||
    typeof target.kind !== "string" ||
    !target.kind.trim() ||
    !["small", "medium", "large"].includes(target.size) ||
    (target.container !== undefined &&
      (typeof target.container !== "string" || !target.container.trim())) ||
    (target.iconIdentifier !== undefined &&
      (typeof target.iconIdentifier !== "string" ||
        !target.iconIdentifier.trim()))
  )
    throw new WidgetctlError(
      "A widget extension, kind, and supported size are required",
    );
  return {
    extension: target.extension,
    kind: target.kind,
    size: target.size,
    ...(target.container ? { container: target.container } : {}),
    ...(target.iconIdentifier ? { iconIdentifier: target.iconIdentifier } : {}),
  };
}
export interface WidgetHandle {
  readonly target: Readonly<WidgetTarget>;
  readonly iconIdentifier: string;
  reveal(): Promise<BackendResult>;
  parameters(): Promise<Record<string, JsonValue>>;
  updateConfiguration(
    mutator: (parameters: Record<string, JsonValue>) => void | Promise<void>,
  ): Promise<WidgetConfiguration>;
  remove(): Promise<BackendResult>;
  exportConfiguration(): Promise<WidgetConfiguration>;
  applyConfiguration(
    configuration: WidgetConfiguration,
  ): Promise<WidgetConfiguration>;
}
export interface WidgetController {
  readonly udid: string;
  prepare(): Promise<BackendResult>;
  release(): Promise<BackendResult>;
  inspect(): Promise<BackendResult>;
  ensure(target: WidgetTarget, options?: EnsureOptions): Promise<WidgetHandle>;
  exportConfiguration(target: WidgetTarget): Promise<WidgetConfiguration>;
  applyConfiguration(
    target: WidgetTarget,
    configuration: WidgetConfiguration,
  ): Promise<WidgetConfiguration>;
}
export function createController(
  options: WidgetControllerOptions,
  runOperationBackend: (
    options: BackendOptions,
  ) => Promise<BackendResult> = runOperation,
): WidgetController {
  if (typeof options.udid !== "string" || !options.udid.trim())
    throw new WidgetctlError("An explicit simulator UDID is required");
  const settings = {
    udid: options.udid,
    stateDirectory: options.stateDirectory,
    architecture: options.architecture,
    launchDomain: options.launchDomain,
  };
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = queue.then(operation);
    queue = pending.catch(() => undefined);
    return pending;
  };
  const run = async (
    mode: BackendOptions["mode"],
    extra: Partial<BackendOptions> = {},
  ): Promise<BackendResult> => {
    let result: BackendResult;
    try {
      result = await runOperationBackend({ ...settings, ...extra, mode });
    } catch (cause) {
      if (cause instanceof WidgetctlError) throw cause;
      throw new WidgetctlError(`Widget operation ${mode} failed`, { cause });
    }
    try {
      options.onResult?.(result);
    } catch (cause) {
      throw new WidgetctlError("Widget result callback failed", {
        result,
        cause,
      });
    }
    if (result.status !== successful[mode])
      throw new WidgetctlError(
        `Widget operation ${mode} failed: ${result.status}`,
        { result },
      );
    return result;
  };
  const exportConfig = async (target: WidgetTarget) =>
    configuration(
      (await run("exportConfiguration", target)).configuration,
      target,
    );
  const applyConfig = async (
    target: WidgetTarget,
    value: WidgetConfiguration,
  ) =>
    configuration(
      (
        await run("applyConfiguration", {
          ...target,
          configuration: configuration(value, target),
        })
      ).configuration,
      target,
    );
  const controller: WidgetController = {
    udid: settings.udid,
    prepare: () => serialize(() => run("prepare")),
    release: () => serialize(() => run("unload")),
    inspect: () => serialize(() => run("inspect")),
    exportConfiguration: (target) =>
      serialize(() => exportConfig(validateTarget(target))),
    applyConfiguration: (target, value) =>
      serialize(() => applyConfig(validateTarget(target), value)),
    ensure: (input, ensureOptions = {}) =>
      serialize(async () => {
        const target = validateTarget(input);
        const result = await run("ensure", {
          ...target,
          exclusive: ensureOptions.exclusive,
          replace: ensureOptions.replace,
          position: ensureOptions.position,
        });
        if (typeof result.iconIdentifier !== "string" || !result.iconIdentifier)
          throw new WidgetctlError(
            "Backend did not return an exact widget icon identifier",
            { result },
          );
        const bound = Object.freeze({
          ...target,
          iconIdentifier: result.iconIdentifier,
        });
        return Object.freeze({
          target: bound,
          iconIdentifier: result.iconIdentifier,
          reveal: () =>
            serialize(() => run("ensure", { ...bound, position: "top" })),
          parameters: () =>
            serialize(
              async () => (await exportConfig(bound)).intent.parameters,
            ),
          exportConfiguration: () => serialize(() => exportConfig(bound)),
          applyConfiguration: (value: WidgetConfiguration) =>
            serialize(() => applyConfig(bound, value)),
          updateConfiguration: (
            mutator: (
              parameters: Record<string, JsonValue>,
            ) => void | Promise<void>,
          ) =>
            serialize(async () => {
              const current = await exportConfig(bound);
              await mutator(current.intent.parameters);
              return applyConfig(bound, current);
            }),
          remove: () => serialize(() => run("remove", bound)),
        });
      }),
  };
  return controller;
}
