import { createController } from "./controller.js";
import type {
  WidgetController,
  WidgetControllerOptions,
} from "./controller.js";
export { WidgetctlError } from "./controller.js";
export type {
  WidgetSize,
  JsonValue,
  WidgetConfiguration,
  WidgetTarget,
  EnsureOptions,
  WidgetControllerOptions,
  WidgetHandle,
  WidgetController,
} from "./controller.js";
export type { BackendResult as WidgetOperationResult } from "./backend.js";
export function createWidgetController(
  options: WidgetControllerOptions,
): WidgetController {
  return createController(options);
}
