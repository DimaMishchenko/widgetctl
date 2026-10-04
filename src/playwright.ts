import { test as base } from "@playwright/test";
import {
  createWidgetFixtures,
  type WidgetWorkerFixtures,
} from "./playwright-fixtures.js";
export type { WidgetWorkerFixtures } from "./playwright-fixtures.js";
export const widgetFixtures = createWidgetFixtures();
export const test = base.extend<{}, WidgetWorkerFixtures>(widgetFixtures);
export { expect } from "@playwright/test";
