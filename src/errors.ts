import type { BackendResult } from "./backend.js";

const guidance = {
  INVALID_INPUT: ["Check the arguments with widgetctl --help."],
  UNSUPPORTED_HOST: ["Run widgetctl on macOS with full Xcode installed."],
  UNSUPPORTED_RUNTIME: [
    "Run widgetctl doctor and use a verified iOS simulator runtime.",
  ],
  DEVICE_NOT_FOUND: [
    "Run widgetctl devices --json and select an available simulator UUID.",
  ],
  DEVICE_NOT_BOOTED: [
    "Boot only the simulator you own, then wait for simctl bootstatus before retrying.",
  ],
  DEVICE_BUSY: [
    "Wait for the current simulator owner to finish. Do not delete its locks.",
  ],
  DESCRIPTOR_TIMEOUT: [
    "The read-only descriptor wait exhausted its budget. Check registration and the exact target while retaining simulator ownership before deciding whether to wait again.",
  ],
  APP_NOT_REGISTERED: [
    "Launch the containing app once, then refresh the widget catalog.",
  ],
  WIDGET_NOT_FOUND: [
    "Refresh widgetctl list for the selected device and select a current exact icon UUID.",
  ],
  AMBIGUOUS_TARGET: [
    "List installed widgets and select one exact icon UUID, or refine the catalog target.",
  ],
  STALE_CONFIGURATION: [
    "Export the current widget again and review your changes against that snapshot before saving.",
  ],
  IDENTITY_MISMATCH: [
    "Refresh the exact widget and export a new configuration. Do not reuse an export from another instance.",
  ],
  UNSUPPORTED_CONFIGURATION: [
    "Keep this field unchanged or use an understood canonical JSON value. Report the app and runtime compatibility limit.",
  ],
  UNSUPPORTED_CHOICES: [
    "Try a narrower search. If discovery is unsupported, keep the existing value or use the explicit canonical JSON editor.",
  ],
  QUERY_TIMEOUT: [
    "Retry the read-only choice query after the app is responsive, or keep the existing value.",
  ],
  QUERY_FAILED: [
    "Check the app and simulator with widgetctl doctor. Retry the read-only query or keep the existing value.",
  ],
  HELPER_UNAVAILABLE: [
    "Run widgetctl doctor for this device. Release and prepare your owned session again; inspect saved state before retrying a write.",
  ],
  COMMAND_TIMEOUT: [
    "Inspect current simulator and widget state before retrying. A submitted write may already have completed.",
  ],
  OWNERSHIP_LOST: [
    "Stop this session. Inspect current widget state and establish exclusive simulator ownership before continuing.",
  ],
  VERIFICATION_FAILED: [
    "Inspect current widget state and rendering. Earlier steps may have completed; do not blindly repeat the mutation.",
  ],
  CALLBACK_FAILED: [
    "Fix the result callback. Inspect saved state before retrying; the operation may have completed.",
  ],
  CLEANUP_FAILED: [
    "Keep ownership of this simulator and run widgetctl doctor. Resolve helper cleanup before another worker uses it.",
  ],
  CANCELLED: [
    "A submitted write may finish during cleanup. Inspect current state before retrying.",
  ],
  IO_ERROR: ["Check the file path, permissions and available disk space."],
  UNSAFE_STATE: [
    "Inspect the reported state path and ownership. Do not delete another session's files.",
  ],
  OPERATION_FAILED: [
    "Run widgetctl doctor and inspect the operation result before retrying.",
  ],
} as const;

export type WidgetctlErrorCode = keyof typeof guidance;
export interface ErrorDetails {
  code: WidgetctlErrorCode;
  message: string;
  recovery: string[];
  retryable: boolean;
}
export function isErrorCode(value: unknown): value is WidgetctlErrorCode {
  return typeof value === "string" && Object.hasOwn(guidance, value);
}

const nativeCodes: Record<string, WidgetctlErrorCode> = {
  StaleConfiguration: "STALE_CONFIGURATION",
  MissingDescriptor: "APP_NOT_REGISTERED",
  MissingWidgetIcon: "WIDGET_NOT_FOUND",
  DuplicateDescriptors: "AMBIGUOUS_TARGET",
  UnavailableABI: "UNSUPPORTED_RUNTIME",
  UnavailableProvider: "UNSUPPORTED_RUNTIME",
  UnsupportedFamily: "UNSUPPORTED_RUNTIME",
  WorkerGenerationMismatch: "HELPER_UNAVAILABLE",
  WidgetIdentityMismatch: "IDENTITY_MISMATCH",
  UnsafeWidgetIcon: "IDENTITY_MISMATCH",
  ConfigurationIdentityMismatch: "IDENTITY_MISMATCH",
  ConfigurationIntentMismatch: "IDENTITY_MISMATCH",
  ConfigurationTargetMismatch: "IDENTITY_MISMATCH",
  ChoiceConfigurationMismatch: "STALE_CONFIGURATION",
  ChoiceConnectionMismatch: "UNSUPPORTED_CHOICES",
  UnsupportedIntentClass: "UNSUPPORTED_CONFIGURATION",
  UnsupportedIntentIdentifier: "UNSUPPORTED_CONFIGURATION",
  UnsupportedParameters: "UNSUPPORTED_CONFIGURATION",
  UnsupportedConfigurationMetadata: "UNSUPPORTED_CONFIGURATION",
  UnsupportedChoiceConfiguration: "UNSUPPORTED_CHOICES",
  UnsupportedChoiceParameter: "UNSUPPORTED_CHOICES",
  UnsupportedChoiceSerialization: "UNSUPPORTED_CHOICES",
  UnsupportedChoices: "UNSUPPORTED_CHOICES",
  TooManyChoices: "UNSUPPORTED_CHOICES",
  ChoiceTooLarge: "UNSUPPORTED_CHOICES",
  ChoiceQueryTimeout: "QUERY_TIMEOUT",
  ChoiceQueryFailed: "QUERY_FAILED",
  InvalidCommand: "INVALID_INPUT",
  InvalidPosition: "INVALID_INPUT",
  InvalidSize: "INVALID_INPUT",
  InvalidConfiguration: "INVALID_INPUT",
  InvalidChoiceRequest: "INVALID_INPUT",
  InvalidCanonicalJSON: "INVALID_INPUT",
  InvalidChoiceConfiguration: "INVALID_INPUT",
  ConfigurationReadbackMismatch: "VERIFICATION_FAILED",
  RoundtripMismatch: "VERIFICATION_FAILED",
  InvalidUpdatedIdentity: "VERIFICATION_FAILED",
};
export function backendErrorCode(result?: BackendResult): WidgetctlErrorCode {
  if (!result) return "OPERATION_FAILED";
  if (isErrorCode(result.errorCode)) return result.errorCode;
  if (
    typeof result.errorName === "string" &&
    Object.hasOwn(nativeCodes, result.errorName)
  )
    return nativeCodes[result.errorName]!;
  if (result.status === "duplicate_existing_widgets") return "AMBIGUOUS_TARGET";
  if (result.status === "worker_still_live") return "CLEANUP_FAILED";
  if (result.status.endsWith("unverified")) return "VERIFICATION_FAILED";
  return "OPERATION_FAILED";
}

export class WidgetctlError extends Error implements ErrorDetails {
  readonly code: WidgetctlErrorCode;
  readonly recovery: string[];
  readonly retryable: boolean;
  readonly result?: BackendResult;
  constructor(
    message: string,
    options: {
      code?: WidgetctlErrorCode;
      recovery?: readonly string[];
      retryable?: boolean;
      result?: BackendResult;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "WidgetctlError";
    this.result = options.result;
    this.code = options.code ?? backendErrorCode(options.result);
    this.recovery = [...(options.recovery ?? guidance[this.code])];
    this.retryable =
      options.retryable ??
      ["QUERY_TIMEOUT", "QUERY_FAILED"].includes(this.code);
  }
}

export function classifyError(error: unknown): ErrorDetails {
  if (error instanceof WidgetctlError)
    return {
      code: error.code,
      message: error.message,
      recovery: [...error.recovery],
      retryable: error.retryable,
    };
  const name = error instanceof Error ? error.name : undefined;
  const systemCode =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  const code: WidgetctlErrorCode =
    name === "AbortError" ||
    name === "ExitPromptError" ||
    name === "AbortPromptError"
      ? "CANCELLED"
      : (typeof systemCode === "string" &&
            systemCode.startsWith("ERR_PARSE_ARGS_")) ||
          error instanceof SyntaxError
        ? "INVALID_INPUT"
        : [
              "ENOENT",
              "EACCES",
              "EPERM",
              "ENOSPC",
              "EISDIR",
              "ENOTDIR",
              "ELOOP",
            ].includes(String(systemCode))
          ? "IO_ERROR"
          : "OPERATION_FAILED";
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    recovery: [...guidance[code]],
    retryable: false,
  };
}

export function isRecoverableChoiceError(error: unknown): boolean {
  return (
    error instanceof WidgetctlError &&
    ["UNSUPPORTED_CHOICES", "QUERY_TIMEOUT", "QUERY_FAILED"].includes(
      error.code,
    )
  );
}
