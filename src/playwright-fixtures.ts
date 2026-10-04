import type { Fixtures } from "@playwright/test";
import {
  createWidgetController,
  type WidgetController,
  type WidgetControllerOptions,
} from "./index.js";
export interface WidgetWorkerFixtures {
  widgetctlOptions: WidgetControllerOptions | undefined;
  widgets: WidgetController;
}
export function createWidgetFixtures(
  create: (
    options: WidgetControllerOptions,
  ) => WidgetController = createWidgetController,
): Fixtures<{}, WidgetWorkerFixtures> {
  return {
    widgetctlOptions: [undefined, { option: true, scope: "worker" }],
    widgets: [
      async ({ widgetctlOptions }, use, workerInfo) => {
        if (!widgetctlOptions?.udid?.trim())
          throw new Error(
            "widgetctlOptions.udid must explicitly identify a simulator",
          );
        if (workerInfo.config.workers !== 1)
          throw new Error(
            "widgetctl requires workers: 1 per simulator UDID. Run separate Playwright invocations with distinct UDIDs for parallel devices.",
          );
        const widgets = create(widgetctlOptions);
        try {
          await widgets.prepare();
          await use(widgets);
        } finally {
          await widgets.release();
        }
      },
      { scope: "worker", auto: true },
    ],
  };
}
