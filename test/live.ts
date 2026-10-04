import { isDeepStrictEqual } from "node:util";
import { createWidgetController } from "../src/index.js";

const udid = process.env.WIDGETCTL_UDID;
const extension = process.env.WIDGETCTL_EXTENSION;
const kind = process.env.WIDGETCTL_KIND;
const size = process.env.WIDGETCTL_SIZE ?? "small";
if (
  !udid ||
  !extension ||
  !kind ||
  !["small", "medium", "large"].includes(size)
) {
  throw new Error(
    "Set WIDGETCTL_UDID, WIDGETCTL_EXTENSION, WIDGETCTL_KIND and optional WIDGETCTL_SIZE.",
  );
}
const widgets = createWidgetController({
  udid,
  onResult: (result) => console.log(JSON.stringify(result)),
});
try {
  await widgets.prepare();
  const widget = await widgets.ensure(
    { extension, kind, size: size as "small" | "medium" | "large" },
    { position: "top" },
  );
  const before = await widget.exportConfiguration();
  const after = await widget.applyConfiguration(before);
  if (!isDeepStrictEqual(before.intent.parameters, after.intent.parameters))
    throw new Error("Configuration parameters changed.");
} finally {
  await widgets.release();
}
