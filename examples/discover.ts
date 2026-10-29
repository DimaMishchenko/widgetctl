import { createWidgetController, listSimulators } from "widgetctl";

console.log(JSON.stringify(await listSimulators(), null, 2));
const udid = process.env.SIMULATOR_UDID;
if (!udid)
  throw new Error("Set SIMULATOR_UDID to your owned, booted simulator.");
const widgets = createWidgetController({ udid });
try {
  await widgets.prepare();
  console.log(JSON.stringify(await widgets.catalog(), null, 2));
  console.log(JSON.stringify(await widgets.installedWidgets(), null, 2));
  const icon = process.env.WIDGET_ICON;
  if (icon) {
    const widget = await widgets.getWidget(icon);
    const description = await widget.describeConfiguration();
    console.log(JSON.stringify(description, null, 2));
    const key = process.env.CONFIGURATION_PARAMETER;
    if (key)
      console.log(
        JSON.stringify(
          await widget.configurationChoices(
            key,
            process.env.CONFIGURATION_SEARCH,
            { expected: description.configuration },
          ),
          null,
          2,
        ),
      );
  }
} finally {
  await widgets.release();
}
