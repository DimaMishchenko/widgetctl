import type { WidgetSize, WidgetTarget } from "widgetctl";

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} before running this example`);
  return value;
}

export const udid = required("SIMULATOR_UDID");
const size = required("WIDGET_SIZE");
if (!["small", "medium", "large"].includes(size)) {
  throw new Error("WIDGET_SIZE must be small, medium or large");
}

export const target: WidgetTarget = {
  extension: required("WIDGET_EXTENSION"),
  kind: required("WIDGET_KIND"),
  size: size as WidgetSize,
  ...(process.env.WIDGET_CONTAINER
    ? { container: process.env.WIDGET_CONTAINER }
    : {}),
  ...(process.env.WIDGET_ICON
    ? { iconIdentifier: process.env.WIDGET_ICON }
    : {}),
};
