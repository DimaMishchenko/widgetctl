import { WidgetctlError, classifyError } from "./errors.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  describeFromMetadata,
  readConfigurationMetadata,
  type ConfigurationDescription,
} from "./configuration.js";
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
export interface WidgetCatalog {
  apps: {
    bundleIdentifier: string;
    name: string;
    widgets: {
      name?: string;
      target: { extension: string; container: string; kind: string };
      sizes: WidgetSize[];
    }[];
  }[];
}
export interface InstalledWidget {
  name?: string;
  target: WidgetTarget & { container: string; iconIdentifier: string };
  widgetIdentifier: string;
  position?: { page: number; index: number };
}
export interface ApplyConfigurationOptions {
  expected?: WidgetConfiguration;
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
export { WidgetctlError } from "./errors.js";
const successful: Record<BackendOptions["mode"], string> = {
  catalog: "catalogued",
  installedWidgets: "listed",
  configurationChoices: "configuration_choices",
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
      { code: "INVALID_INPUT" },
    );
  seen.add(value);
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !==
    (array ? Array.prototype : Object.prototype)
  )
    throw new WidgetctlError(
      "Configuration must contain plain JSON objects and arrays",
      { code: "INVALID_INPUT" },
    );
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === "length") continue;
    if (
      typeof key !== "string" ||
      !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
      (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
    )
      throw new WidgetctlError(
        "Configuration must contain enumerable JSON keys",
        { code: "INVALID_INPUT" },
      );
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor))
      throw new WidgetctlError("Configuration cannot contain accessors", {
        code: "INVALID_INPUT",
      });
    finiteJson(descriptor.value, seen);
  }
  if (array)
    for (let index = 0; index < value.length; index++)
      if (!Object.hasOwn(value, index))
        throw new WidgetctlError("Configuration cannot contain sparse arrays", {
          code: "INVALID_INPUT",
        });
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
    (target.container && config.container !== target.container) ||
    (target.iconIdentifier &&
      config.iconIdentifier !== undefined &&
      config.iconIdentifier !== target.iconIdentifier)
  )
    throw new WidgetctlError(
      "Configuration envelope does not match the target widget",
      { code: "IDENTITY_MISMATCH" },
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
      { code: "INVALID_INPUT" },
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
      { code: "INVALID_INPUT" },
    );
  return {
    extension: target.extension,
    kind: target.kind,
    size: target.size,
    ...(target.container ? { container: target.container } : {}),
    ...(target.iconIdentifier ? { iconIdentifier: target.iconIdentifier } : {}),
  };
}
export interface ConfigurationChoicesOptions {
  configuration?: WidgetConfiguration;
  expected?: WidgetConfiguration;
  signal?: AbortSignal;
}
export interface WidgetHandle {
  readonly target: Readonly<WidgetTarget>;
  readonly iconIdentifier: string;
  reveal(): Promise<BackendResult>;
  parameters(): Promise<Record<string, JsonValue>>;
  updateConfiguration(
    mutator: (parameters: Record<string, JsonValue>) => void | Promise<void>,
  ): Promise<WidgetConfiguration>;
  describeConfiguration(): Promise<ConfigurationDescription>;
  configurationChoices(
    key: string,
    search?: string,
    options?: ConfigurationChoicesOptions,
  ): Promise<{ label: string; value: JsonValue }[]>;
  remove(): Promise<BackendResult>;
  exportConfiguration(): Promise<WidgetConfiguration>;
  applyConfiguration(
    configuration: WidgetConfiguration,
    options?: ApplyConfigurationOptions,
  ): Promise<WidgetConfiguration>;
}
export interface WidgetController {
  readonly udid: string;
  catalog(): Promise<WidgetCatalog>;
  installedWidgets(): Promise<InstalledWidget[]>;
  getWidget(iconIdentifier: string): Promise<WidgetHandle>;
  prepare(): Promise<BackendResult>;
  release(): Promise<BackendResult>;
  inspect(): Promise<BackendResult>;
  ensure(target: WidgetTarget, options?: EnsureOptions): Promise<WidgetHandle>;
  exportConfiguration(target: WidgetTarget): Promise<WidgetConfiguration>;
  applyConfiguration(
    target: WidgetTarget,
    configuration: WidgetConfiguration,
    options?: ApplyConfigurationOptions,
  ): Promise<WidgetConfiguration>;
}
export function createController(
  options: WidgetControllerOptions,
  runOperationBackend: (
    options: BackendOptions,
  ) => Promise<BackendResult> = runOperation,
  metadataReader = readConfigurationMetadata,
): WidgetController {
  if (typeof options.udid !== "string" || !options.udid.trim())
    throw new WidgetctlError("An explicit simulator UDID is required", {
      code: "INVALID_INPUT",
    });
  const settings = {
    udid: options.udid,
    stateDirectory: options.stateDirectory,
    architecture: options.architecture,
    launchDomain: options.launchDomain,
  };
  const mutatorContext = new AsyncLocalStorage<{ active: boolean }>();
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    if (mutatorContext.getStore()?.active)
      return Promise.reject(
        new WidgetctlError(
          "Configuration mutators cannot call operations on the same controller",
          { code: "INVALID_INPUT" },
        ),
      );
    const pending = queue.then(operation);
    queue = pending.catch(() => undefined);
    return pending;
  };
  const snapshotAndSerialize = <Input, Result>(
    snapshot: () => Input,
    operation: (input: Input) => Promise<Result>,
  ): Promise<Result> => {
    let input: Input;
    try {
      input = snapshot();
    } catch (cause) {
      return Promise.reject(cause);
    }
    return serialize(() => operation(input));
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
      throw new WidgetctlError(
        `Widget operation ${mode} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { ...classifyError(cause), cause },
      );
    }
    try {
      options.onResult?.(result);
    } catch (cause) {
      throw new WidgetctlError("Widget result callback failed", {
        code: "CALLBACK_FAILED",
        result,
        cause,
      });
    }
    if (result.status !== successful[mode]) {
      const diagnosis =
        typeof result.error === "string"
          ? result.error
          : typeof result.verification_error === "string"
            ? result.verification_error
            : undefined;
      throw new WidgetctlError(
        `Widget operation ${mode} failed: ${result.status}${diagnosis ? `: ${diagnosis}` : ""}`,
        { result },
      );
    }
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
    expected?: WidgetConfiguration,
  ) =>
    configuration(
      (
        await run("applyConfiguration", {
          ...target,
          configuration: value,
          ...(expected ? { expectedConfiguration: expected } : {}),
        })
      ).configuration,
      target,
    );
  const bindHandle = (
    target: WidgetTarget,
    iconIdentifier: string,
  ): WidgetHandle => {
    const bound = Object.freeze({ ...target, iconIdentifier });
    return Object.freeze({
      target: bound,
      iconIdentifier,
      reveal: () =>
        serialize(() => run("ensure", { ...bound, position: "top" })),
      parameters: () =>
        serialize(async () => (await exportConfig(bound)).intent.parameters),
      exportConfiguration: () => serialize(() => exportConfig(bound)),
      describeConfiguration: () =>
        serialize(async () => {
          const result = await run("exportConfiguration", bound);
          const value = configuration(result.configuration, bound);
          let metadata: unknown;
          try {
            metadata = await metadataReader(
              settings.udid,
              value,
              typeof result.numberFormat?.locale === "string"
                ? result.numberFormat.locale
                : undefined,
            );
          } catch {
            metadata = undefined;
          }
          return describeFromMetadata(value, metadata, result.numberFormat);
        }),
      configurationChoices: (
        key: string,
        search = "",
        options: ConfigurationChoicesOptions = {},
      ) =>
        snapshotAndSerialize(
          () => {
            if (
              typeof key !== "string" ||
              !key ||
              key.length > 256 ||
              typeof search !== "string" ||
              search.length > 512
            )
              throw new WidgetctlError(
                "Entity choices require a parameter key of at most 256 characters and a search of at most 512 characters",
                { code: "INVALID_INPUT" },
              );
            return {
              key,
              search,
              signal: options.signal,
              draft:
                options.configuration === undefined
                  ? undefined
                  : configuration(options.configuration, bound),
              expected:
                options.expected === undefined
                  ? undefined
                  : configuration(options.expected, bound),
            };
          },
          async ({ key, search, draft, expected, signal }) => {
            signal?.throwIfAborted();
            const current = expected ?? (await exportConfig(bound));
            signal?.throwIfAborted();
            if (
              draft &&
              draft.intent.appIntentIdentifier !==
                current.intent.appIntentIdentifier
            )
              throw new WidgetctlError(
                "Entity query draft must keep the current intent identifier",
                { code: "IDENTITY_MISMATCH" },
              );
            signal?.throwIfAborted();
            const result = await run("configurationChoices", {
              ...bound,
              parameterKey: key,
              search,
              configuration: draft ?? current,
              expectedConfiguration: expected ?? current,
            });
            return structuredClone(result.choices) as {
              label: string;
              value: JsonValue;
            }[];
          },
        ),
      applyConfiguration: (
        value: WidgetConfiguration,
        options: ApplyConfigurationOptions = {},
      ) =>
        snapshotAndSerialize(
          () => ({
            value: configuration(value, bound),
            expected:
              options.expected === undefined
                ? undefined
                : configuration(options.expected, bound),
          }),
          ({ value, expected }) => applyConfig(bound, value, expected),
        ),
      updateConfiguration: (
        mutator: (
          parameters: Record<string, JsonValue>,
        ) => void | Promise<void>,
      ) =>
        serialize(async () => {
          const current = await exportConfig(bound);
          const expected = structuredClone(current);
          const context = { active: true };
          await mutatorContext.run(context, async () => {
            try {
              await mutator(current.intent.parameters);
            } finally {
              context.active = false;
            }
          });
          return applyConfig(bound, configuration(current, bound), expected);
        }),
      remove: () => serialize(() => run("remove", bound)),
    });
  };
  const listInstalled = async (): Promise<InstalledWidget[]> => {
    const result = await run("installedWidgets");
    if (!Array.isArray(result.widgets))
      throw new WidgetctlError("Backend did not return installed widgets", {
        result,
      });
    const seen = new Set<string>();
    const widgetIds = new Set<string>();
    return result.widgets.map((widget: InstalledWidget) => {
      const target = validateTarget(widget?.target);
      if (
        !target.iconIdentifier ||
        !target.container ||
        typeof widget.widgetIdentifier !== "string" ||
        !widget.widgetIdentifier ||
        seen.has(target.iconIdentifier.toUpperCase()) ||
        widgetIds.has(widget.widgetIdentifier.toUpperCase())
      )
        throw new WidgetctlError(
          "Backend returned ambiguous installed widget identity",
          { result },
        );
      seen.add(target.iconIdentifier.toUpperCase());
      widgetIds.add(widget.widgetIdentifier.toUpperCase());
      return structuredClone(widget);
    });
  };
  const controller: WidgetController = {
    udid: settings.udid,
    catalog: () =>
      serialize(async () => {
        const result = await run("catalog");
        if (!result.catalog || !Array.isArray(result.catalog.apps))
          throw new WidgetctlError("Backend did not return a widget catalog", {
            result,
          });
        return structuredClone(result.catalog) as WidgetCatalog;
      }),
    installedWidgets: () => serialize(listInstalled),
    getWidget: (iconIdentifier) =>
      snapshotAndSerialize(
        () => {
          if (typeof iconIdentifier !== "string" || !iconIdentifier.trim())
            throw new WidgetctlError(
              "An exact widget icon identifier is required",
              { code: "INVALID_INPUT" },
            );
          return iconIdentifier.toUpperCase();
        },
        async (iconIdentifier) => {
          const matches = (await listInstalled()).filter(
            (widget) =>
              widget.target.iconIdentifier.toUpperCase() === iconIdentifier,
          );
          if (matches.length !== 1)
            throw new WidgetctlError(
              "Widget icon identifier must match exactly one installed widget",
              { code: "WIDGET_NOT_FOUND" },
            );
          return bindHandle(
            matches[0]!.target,
            matches[0]!.target.iconIdentifier,
          );
        },
      ),
    prepare: () => serialize(() => run("prepare")),
    release: () => serialize(() => run("unload")),
    inspect: () => serialize(() => run("inspect")),
    exportConfiguration: (target) =>
      snapshotAndSerialize(() => validateTarget(target), exportConfig),
    applyConfiguration: (target, value, options = {}) =>
      snapshotAndSerialize(
        () => {
          const selected = validateTarget(target);
          return {
            target: selected,
            configuration: configuration(value, selected),
            expected:
              options.expected === undefined
                ? undefined
                : configuration(options.expected, selected),
          };
        },
        ({ target, configuration, expected }) =>
          applyConfig(target, configuration, expected),
      ),
    ensure: (input, ensureOptions = {}) =>
      snapshotAndSerialize(
        () => ({
          target: validateTarget(input),
          ensureOptions: {
            exclusive: ensureOptions.exclusive,
            replace: ensureOptions.replace,
            position: ensureOptions.position,
          },
        }),
        async ({ target, ensureOptions }) => {
          const result = await run("ensure", {
            ...target,
            exclusive: ensureOptions.exclusive,
            replace: ensureOptions.replace,
            position: ensureOptions.position,
          });
          if (
            typeof result.iconIdentifier !== "string" ||
            !result.iconIdentifier
          )
            throw new WidgetctlError(
              "Backend did not return an exact widget icon identifier",
              { result },
            );
          return bindHandle(target, result.iconIdentifier);
        },
      ),
  };
  return controller;
}
