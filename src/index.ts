import { createController } from "./controller.js";
import type {
  WidgetController,
  WidgetControllerOptions,
} from "./controller.js";
export { WidgetctlError } from "./controller.js";
export type {
  WidgetCatalog,
  InstalledWidget,
  ApplyConfigurationOptions,
  ConfigurationChoicesOptions,
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

export { listSimulators, listApplications } from "./discovery.js";
export type { Simulator, Application } from "./discovery.js";
export type {
  NumberFormat,
  ConfigurationField,
  ConfigurationDescription,
} from "./configuration.js";

export { classifyError } from "./errors.js";
export type { WidgetctlErrorCode, ErrorDetails } from "./errors.js";
export { doctor } from "./doctor.js";
export type { DoctorOptions, DoctorCheck, DoctorReport } from "./doctor.js";
