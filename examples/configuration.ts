import assert from "node:assert/strict";
import { createWidgetController, type JsonValue } from "widgetctl";
import { target, udid } from "./inputs.js";

const parameter = process.env.WIDGET_PARAMETER;
const valueText = process.env.WIDGET_VALUE_JSON;
if ((parameter === undefined) !== (valueText === undefined)) {
  throw new Error(
    "Set both WIDGET_PARAMETER and WIDGET_VALUE_JSON, or neither",
  );
}
const value =
  valueText === undefined ? undefined : (JSON.parse(valueText) as JsonValue);
const widgets = createWidgetController({ udid });
try {
  await widgets.prepare();
  const widget = await widgets.ensure(target);
  const exported = await widget.exportConfiguration();
  const applied = await widget.applyConfiguration(exported);
  assert.deepEqual(await widget.exportConfiguration(), applied);

  if (parameter !== undefined) {
    const updated = await widget.updateConfiguration((parameters) => {
      if (!Object.hasOwn(parameters, parameter)) {
        throw new Error(
          `Export and inspect the existing parameter ${parameter} first`,
        );
      }
      parameters[parameter] = value!;
    });
    assert.deepEqual(await widget.exportConfiguration(), updated);
  }
  console.log(
    JSON.stringify({ iconIdentifier: widget.iconIdentifier, persisted: true }),
  );
} finally {
  await widgets.release();
}
