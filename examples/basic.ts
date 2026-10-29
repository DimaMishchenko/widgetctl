import { writeFile } from "node:fs/promises";
import { createWidgetController } from "widgetctl";
import { required, target, udid } from "./inputs.js";

const output = required("CONFIGURATION_FILE");
const widgets = createWidgetController({ udid });
try {
  await widgets.prepare();
  const widget = await widgets.ensure(target);
  const configuration = await widget.exportConfiguration();
  await writeFile(output, `${JSON.stringify(configuration, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({ iconIdentifier: widget.iconIdentifier, output }),
  );
} finally {
  await widgets.release();
}
