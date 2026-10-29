import { setTimeout as delay } from "node:timers/promises";
import { WidgetctlError } from "./errors.js";
import type { WidgetCatalog, WidgetTarget } from "./controller.js";

export type DescriptorTarget = Required<
  Pick<WidgetTarget, "container" | "extension" | "kind" | "size">
>;
export interface DescriptorWaitOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}
export interface ReadinessClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export const readinessClock: ReadinessClock = {
  now: () => performance.now(),
  sleep: async (ms, signal) => {
    await delay(ms, undefined, { signal });
  },
};
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function validatedCatalog(value: unknown): WidgetCatalog {
  const invalid = () =>
    new WidgetctlError("Backend returned malformed widget catalog metadata", {
      code: "OPERATION_FAILED",
    });
  if (!object(value) || !Array.isArray(value.apps)) throw invalid();
  const apps = new Set<string>();
  const descriptors = new Set<string>();
  for (const app of value.apps) {
    if (
      !object(app) ||
      !nonempty(app.bundleIdentifier) ||
      !nonempty(app.name) ||
      !Array.isArray(app.widgets)
    )
      throw invalid();
    if (apps.has(app.bundleIdentifier))
      throw new WidgetctlError(
        "Backend returned duplicate widget catalog apps",
        { code: "AMBIGUOUS_TARGET" },
      );
    apps.add(app.bundleIdentifier);
    for (const widget of app.widgets) {
      if (
        !object(widget) ||
        !object(widget.target) ||
        ![
          widget.target.container,
          widget.target.extension,
          widget.target.kind,
        ].every(nonempty) ||
        widget.target.container !== app.bundleIdentifier ||
        (widget.name !== undefined && !nonempty(widget.name)) ||
        !Array.isArray(widget.sizes) ||
        !widget.sizes.length ||
        !widget.sizes.every(
          (size: unknown) =>
            typeof size === "string" &&
            ["small", "medium", "large"].includes(size),
        ) ||
        new Set(widget.sizes).size !== widget.sizes.length
      )
        throw invalid();
      const identity = JSON.stringify([
        widget.target.container,
        widget.target.extension,
        widget.target.kind,
      ]);
      if (descriptors.has(identity))
        throw new WidgetctlError(
          "Backend returned duplicate widget descriptors",
          { code: "AMBIGUOUS_TARGET" },
        );
      descriptors.add(identity);
    }
  }
  return structuredClone(value) as unknown as WidgetCatalog;
}

export function descriptorWait(
  udid: string,
  target: DescriptorTarget,
  options: DescriptorWaitOptions,
  clock: ReadinessClock,
): (query: () => Promise<WidgetCatalog>) => Promise<void> {
  const started = clock.now();
  if (
    !options ||
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > 2_147_483_647 ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal))
  )
    throw new WidgetctlError(
      "Descriptor wait requires a positive timeoutMs of at most 2147483647 and an optional AbortSignal",
      { code: "INVALID_INPUT" },
    );
  const { timeoutMs, signal } = options;
  const deadline = started + timeoutMs;
  let summary = "no successful catalog query";
  const checkpoint = (phase: string) => {
    if (signal?.aborted)
      throw new WidgetctlError("Read-only descriptor wait cancelled", {
        code: "CANCELLED",
        recovery: [
          "The wait performs no widget writes. Continue only while you still own this simulator session.",
        ],
        cause: signal.reason,
      });
    if (clock.now() >= deadline)
      throw new WidgetctlError(
        `Widget descriptor wait timed out after ${Math.max(0, Math.round(clock.now() - started))}ms during ${phase}; UDID ${udid}; target ${JSON.stringify(target)}; last catalog: ${summary}`,
        { code: "DESCRIPTOR_TIMEOUT" },
      );
  };
  return async (query) => {
    checkpoint("controller queue");
    for (;;) {
      checkpoint("before catalog query");
      const catalog = await query();
      summary = `${catalog.apps.length} apps, ${catalog.apps.reduce((count, app) => count + app.widgets.length, 0)} descriptors`;
      checkpoint("catalog response");
      if (
        catalog.apps.some(
          (app) =>
            app.bundleIdentifier === target.container &&
            app.widgets.some(
              (widget) =>
                widget.target.container === target.container &&
                widget.target.extension === target.extension &&
                widget.target.kind === target.kind &&
                widget.sizes.includes(target.size),
            ),
        )
      )
        return;
      checkpoint("before poll delay");
      try {
        await clock.sleep(
          Math.max(0, Math.min(250, deadline - clock.now())),
          signal,
        );
      } catch (error) {
        if (signal?.aborted) checkpoint("poll delay");
        throw error;
      }
      checkpoint("poll delay");
    }
  };
}
