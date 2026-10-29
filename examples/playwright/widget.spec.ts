import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "widgetctl/playwright";
import { target, udid } from "../inputs.js";

test("widget configuration persists", async ({ widgets }) => {
  const widget = await widgets.ensure(target);
  const configuration = await widget.exportConfiguration();
  const applied = await widget.applyConfiguration(configuration);
  expect(await widget.exportConfiguration()).toEqual(applied);
});

test("native widget renders expected content", async ({ widgets }) => {
  const driverPath = process.env.NATIVE_ASSERTION_MODULE;
  test.skip(
    !driverPath,
    "Set NATIVE_ASSERTION_MODULE to your native UI assertion module",
  );
  const widget = await widgets.ensure(target);
  const native = await import(pathToFileURL(resolve(driverPath!)).href);
  if (typeof native.assertWidgetRendered !== "function") {
    throw new Error(
      "Native module must export assertWidgetRendered({ udid, iconIdentifier })",
    );
  }
  await native.assertWidgetRendered({
    udid,
    iconIdentifier: widget.iconIdentifier,
  });
});
