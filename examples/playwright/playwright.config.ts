import { defineConfig } from "@playwright/test";
import type { WidgetWorkerFixtures } from "widgetctl/playwright";
import { udid } from "../inputs.js";

export default defineConfig<{}, WidgetWorkerFixtures>({
  testDir: ".",
  testMatch: "widget.spec.ts",
  workers: 1,
  fullyParallel: false,
  use: { widgetctlOptions: { udid } },
});
