import { compactText, compactValue, uniqueNames, mark } from "./human.js";
import { setTimeout as delay } from "node:timers/promises";
import { isFiniteDecimalString, nativeDecimalString } from "./configuration.js";
import { stripVTControlCharacters } from "node:util";
import { isRecoverableChoiceError } from "./errors.js";
import type { JsonValue, WidgetConfiguration } from "./controller.js";

export interface Choice<T> {
  name: string;
  value: T;
  description?: string;
}
export interface Prompts {
  select<T>(message: string, choices: Choice<T>[]): Promise<T>;
  input(message: string, initial?: string): Promise<string>;
  confirm(message: string, initial?: boolean): Promise<boolean>;
  editor(message: string, initial: string): Promise<string>;
  search?<T>(
    message: string,
    source: (term: string, signal?: AbortSignal) => Promise<Choice<T>[]>,
  ): Promise<T>;
}
export function terminalText(value: string, singleLine = false): string {
  const clean = stripVTControlCharacters(value).replace(
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    "",
  );
  return singleLine ? clean.replace(/[\n\t]+/g, " ") : clean;
}
export type {
  ConfigurationField,
  ConfigurationDescription,
} from "./configuration.js";
import type {
  ConfigurationDescription,
  ConfigurationField,
} from "./configuration.js";
function changedParameters(
  original: WidgetConfiguration,
  draft: WidgetConfiguration,
): string[] {
  return [
    ...new Set([
      ...Object.keys(original.intent.parameters),
      ...Object.keys(draft.intent.parameters),
    ]),
  ].filter(
    (key) =>
      JSON.stringify(original.intent.parameters[key]) !==
      JSON.stringify(draft.intent.parameters[key]),
  );
}
export async function editConfiguration(
  description: ConfigurationDescription,
  prompts: Prompts,
  write: (text: string) => void,
  choicesForField?: (
    key: string,
    search?: string,
    configuration?: WidgetConfiguration,
    signal?: AbortSignal,
  ) => Promise<{ label: string; value: JsonValue }[]>,
): Promise<WidgetConfiguration | undefined> {
  const original = description.configuration;
  const draft = structuredClone(original);
  const save = Symbol("save");
  const back = Symbol("back");
  const advanced = Symbol("advanced");
  const knownChoices = new Map(
    description.fields.map((field) => [field.key, [...(field.choices ?? [])]]),
  );
  const summary = (
    configuration: WidgetConfiguration,
    field: ConfigurationField,
  ) => {
    if (!Object.hasOwn(configuration.intent.parameters, field.key))
      return "Not set";
    const value = configuration.intent.parameters[field.key]!;
    if (
      field.type === "number" &&
      field.numberEncoding &&
      typeof value === "string"
    ) {
      const normalized = nativeDecimalString(
        value,
        description.numberFormat?.decimalSeparator ?? ".",
      );
      if (normalized !== undefined) return compactValue(normalized);
    }
    return compactValue(value, knownChoices.get(field.key));
  };
  const editAdvanced = async (field: ConfigurationField) => {
    if (field.type === "unsupported") {
      write(`${field.reason ?? "This parameter cannot be edited safely."}\n`);
      return;
    }
    const action = await prompts.select(`Advanced · ${field.label}`, [
      { name: "Edit raw JSON", value: "json" },
      ...(field.optional
        ? [
            { name: "Set explicit null", value: "null" },
            { name: "Remove parameter (absent)", value: "remove" },
          ]
        : []),
      { name: "Back", value: "back" },
    ]);
    if (action === "back") return;
    if (action === "null") {
      draft.intent.parameters[field.key] = null;
      return;
    }
    if (action === "remove") {
      delete draft.intent.parameters[field.key];
      return;
    }
    try {
      const value = JSON.parse(
        await prompts.editor(
          field.label,
          JSON.stringify(draft.intent.parameters[field.key] ?? null, null, 2),
        ),
        (_key, value) => {
          if (typeof value === "number" && !Number.isFinite(value))
            throw new Error("Numbers must be finite");
          return value;
        },
      ) as JsonValue;
      if (field.type === "entities" && !Array.isArray(value))
        throw new Error("Expected a JSON array");
      if (field.choices?.length) {
        const values =
          field.type === "entities" && Array.isArray(value) ? value : [value];
        if (
          !values.every((entry) =>
            field.choices!.some(
              (choice) =>
                JSON.stringify(choice.value) === JSON.stringify(entry),
            ),
          )
        )
          throw new Error("Choose only advertised values");
      }
      draft.intent.parameters[field.key] = value;
    } catch (error) {
      if (
        error instanceof Error &&
        ["AbortPromptError", "ExitPromptError", "AbortError"].includes(
          error.name,
        )
      )
        throw error;
      write(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  };
  for (;;) {
    const changes = changedParameters(original, draft);
    const key = await prompts.select<string | symbol>(
      "Edit widget configuration",
      [
        ...description.fields.map((field) => {
          const changed =
            JSON.stringify(original.intent.parameters[field.key]) !==
            JSON.stringify(draft.intent.parameters[field.key]);
          const rowWidth = Math.max(20, (process.stdout.columns || 80) - 8);
          const label = compactText(
            field.label,
            Math.min(22, Math.floor(rowWidth / 3)),
          );
          const available = Math.max(
            6,
            rowWidth -
              [...label].length -
              2 -
              (field.type === "unsupported" ? 12 : 0),
          );
          const previewWidth = changed
            ? Math.max(1, Math.floor((available - 3) / 2))
            : available;
          const value = changed
            ? `${compactText(summary(original, field), previewWidth)} → ${compactText(summary(draft, field), previewWidth)}`
            : compactText(summary(draft, field), previewWidth);
          return {
            name: `${label}: ${value}${field.type === "unsupported" ? " (read only)" : ""}`,
            value: field.key,
          };
        }),
        { name: "Advanced…", value: advanced },
        { name: "Back", value: back },
        { name: `Save changes · ${changes.length}`, value: save },
      ],
    );
    if (key === back) {
      if (
        !changes.length ||
        (await prompts.confirm("Discard unsaved changes?", false))
      )
        return undefined;
      continue;
    }
    if (key === save) {
      if (!changes.length) {
        write("No changes to save.\n");
        return undefined;
      }
      return draft;
    }
    if (key === advanced) {
      const selected = await prompts.select("Advanced", [
        ...description.fields
          .filter((field) => field.type !== "unsupported")
          .map((field) => ({ name: field.label, value: field.key })),
        { name: "Back", value: "" },
      ]);
      const field = description.fields.find((field) => field.key === selected);
      if (field) await editAdvanced(field);
      continue;
    }
    if (typeof key !== "string") continue;
    let field = description.fields.find((field) => field.key === key);
    if (!field) continue;
    const current = draft.intent.parameters[key];
    if (
      ["enum", "entity", "entities"].includes(field.type) &&
      !field.choices?.length &&
      choicesForField
    ) {
      try {
        let initialChoices: { label: string; value: JsonValue }[] = [];
        let initialError: unknown;
        try {
          initialChoices = await choicesForField(
            key,
            undefined,
            structuredClone(draft),
          );
        } catch (error) {
          if (!isRecoverableChoiceError(error) || !prompts.search) throw error;
          initialError = error;
          write(
            `${error instanceof Error ? error.message : String(error)}. Type to search or choose Back.\n`,
          );
        }
        const lookup = async (term: string, signal?: AbortSignal) => {
          if (term) {
            const choices = await choicesForField(
              key,
              term,
              structuredClone(draft),
              signal,
            );
            knownChoices.set(key, [
              ...(knownChoices.get(key) ?? []),
              ...choices,
            ]);
            return choices;
          }
          if (initialError) throw initialError;
          return initialChoices;
        };
        knownChoices.set(key, [
          ...(knownChoices.get(key) ?? []),
          ...initialChoices,
        ]);
        type FailedChoice = { action: "fatal"; error: unknown };
        let fatalError: { value: unknown } | undefined;
        const supersededSearch = (error: unknown, signal?: AbortSignal) =>
          signal?.aborted &&
          error === signal.reason &&
          error instanceof Error &&
          ["AbortError", "AbortPromptError"].includes(error.name);
        const failedChoice = (error: unknown): Choice<FailedChoice> => ({
          name: `Choice lookup failed: ${error instanceof Error ? error.message : String(error)}. Return to session`,
          value: { action: "fatal", error },
        });
        if (prompts.search && field.type === "entities") {
          const selected = Array.isArray(current)
            ? structuredClone(current)
            : [];
          type Selection =
            | { action: "done" | "back" | "json" }
            | { action: "toggle"; value: JsonValue }
            | FailedChoice;
          let fallback = false;
          for (;;) {
            const choice = await prompts.search<Selection>(
              field.label,
              async (term, signal) => {
                if (fatalError) return [failedChoice(fatalError.value)];
                try {
                  return [
                    { name: "Done", value: { action: "done" } },
                    { name: "Discard selection", value: { action: "back" } },
                    {
                      name: "Advanced…",
                      value: { action: "json" },
                    },
                    ...(await lookup(term, signal)).map((choice) => ({
                      name: `${selected.some((value) => JSON.stringify(value) === JSON.stringify(choice.value)) ? mark("✓", "[x]") : mark("○", "[ ]")} ${choice.label}`,
                      value: { action: "toggle" as const, value: choice.value },
                    })),
                  ];
                } catch (error) {
                  if (supersededSearch(error, signal)) return [];
                  if (!isRecoverableChoiceError(error)) {
                    fatalError = { value: error };
                    return [failedChoice(error)];
                  }
                  return [
                    { name: "Back", value: { action: "back" } },
                    {
                      name: `Choice lookup failed: ${error instanceof Error ? error.message : String(error)}. Advanced…`,
                      value: { action: "json" },
                    },
                  ];
                }
              },
            );
            if (fatalError) throw fatalError.value;
            if (choice.action === "fatal") throw choice.error;
            if (choice.action === "done") {
              draft.intent.parameters[key] = selected;
              break;
            }
            if (choice.action === "back") break;
            if (choice.action === "json") {
              fallback = true;
              break;
            }
            if ("value" in choice) {
              const index = selected.findIndex(
                (value) =>
                  JSON.stringify(value) === JSON.stringify(choice.value),
              );
              if (index >= 0) selected.splice(index, 1);
              else selected.push(structuredClone(choice.value));
            }
          }
          if (fallback) await editAdvanced(field);
          continue;
        } else if (prompts.search) {
          type Selection =
            | { action: "back" | "json" }
            | { action: "value"; value: JsonValue }
            | FailedChoice;
          const choice = await prompts.search<Selection>(
            field.label,
            async (term, signal) => {
              if (fatalError) return [failedChoice(fatalError.value)];
              try {
                return [
                  { name: "Back", value: { action: "back" } },
                  ...(await lookup(term, signal)).map((choice) => ({
                    name: choice.label,
                    value: { action: "value" as const, value: choice.value },
                  })),
                  {
                    name: "Advanced…",
                    value: { action: "json" },
                  },
                ];
              } catch (error) {
                if (supersededSearch(error, signal)) return [];
                if (!isRecoverableChoiceError(error)) {
                  fatalError = { value: error };
                  return [failedChoice(error)];
                }
                return [
                  { name: "Back", value: { action: "back" } },
                  {
                    name: `Choice lookup failed: ${error instanceof Error ? error.message : String(error)}. Advanced…`,
                    value: { action: "json" },
                  },
                ];
              }
            },
          );
          if (fatalError) throw fatalError.value;
          if (choice.action === "fatal") throw choice.error;
          if (choice.action === "back") continue;
          if ("value" in choice) draft.intent.parameters[key] = choice.value;
          else await editAdvanced(field);
          continue;
        } else if (initialChoices.length)
          field = { ...field, choices: initialChoices };
      } catch (error) {
        if (!isRecoverableChoiceError(error)) throw error;
        write(
          `Choice lookup unavailable: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
    if (field.type === "unsupported") {
      write(`${field.reason ?? "This parameter cannot be edited safely."}\n`);
      continue;
    }
    if (field.type === "boolean")
      draft.intent.parameters[key] = await prompts.confirm(
        field.label,
        current === true,
      );
    else if (field.choices?.length && field.type === "entities") {
      const selected = Array.isArray(current) ? structuredClone(current) : [];
      for (;;) {
        const choice = await prompts.select(field.label, [
          ...field.choices.map((choice, index) => ({
            name: `${selected.some((value) => JSON.stringify(value) === JSON.stringify(choice.value)) ? mark("✓", "[x]") : mark("○", "[ ]")} ${choice.label}`,
            value: index,
          })),
          { name: "Done", value: -1 },
          { name: "Discard selection", value: -2 },
        ]);
        if (choice === -2) break;
        if (choice === -1) {
          draft.intent.parameters[key] = selected;
          break;
        }
        const value = field.choices[choice]!.value;
        const index = selected.findIndex(
          (entry) => JSON.stringify(entry) === JSON.stringify(value),
        );
        if (index >= 0) selected.splice(index, 1);
        else selected.push(structuredClone(value));
      }
    } else if (field.choices?.length) {
      const chosen = await prompts.select(field.label, [
        { name: "Back", value: undefined as JsonValue | undefined },
        ...field.choices.map((choice) => ({
          name: choice.label,
          value: choice.value,
        })),
      ]);
      if (chosen !== undefined) draft.intent.parameters[key] = chosen;
    } else if (field.type === "string")
      draft.intent.parameters[key] = await prompts.input(
        field.label,
        typeof current === "string" ? current : "",
      );
    else if (field.type === "number") {
      const separator = description.numberFormat?.decimalSeparator;
      if (field.numberEncoding && !separator) {
        write("The simulator number format is unavailable.\n");
        continue;
      }
      const displayed =
        field.numberEncoding && typeof current === "string"
          ? nativeDecimalString(current, separator!)
          : String(current);
      if (displayed === undefined) {
        write("The saved number has an unsupported native encoding.\n");
        continue;
      }
      const raw = await prompts.input(field.label, displayed);
      const value = raw.trim();
      if (!isFiniteDecimalString(value))
        write("Enter a finite decimal number using a dot for fractions.\n");
      else if (raw !== displayed)
        draft.intent.parameters[key] =
          field.numberEncoding === "decimal-string"
            ? value.replace(".", separator!)
            : Number(value);
    } else {
      write(
        `${field.reason ?? "No reliable choice list is available."} Use Advanced to edit raw JSON.\n`,
      );
    }
  }
}
export async function createPrompts(signal: AbortSignal): Promise<Prompts> {
  const { search, select, input, confirm, editor } =
    await import("@inquirer/prompts");
  const plain = (value: string) => value;
  const theme = {
    ...(process.env.WIDGETCTL_NO_EMOJI === "1" || process.env.TERM === "dumb"
      ? {
          prefix: { idle: "?", done: ">" },
          spinner: { interval: 100, frames: ["-", "\\", "|", "/"] },
          icon: { cursor: ">" },
        }
      : {}),
    ...(process.env.NO_COLOR !== undefined
      ? {
          prefix: { idle: "?", done: ">" },
          style: {
            answer: plain,
            message: plain,
            error: plain,
            help: plain,
            highlight: plain,
            description: plain,
            disabled: plain,
            searchTerm: plain,
          },
        }
      : {}),
  };
  const searchTheme = {
    ...theme,
    style: {
      ...theme.style,
      keysHelpTip: () =>
        compactText(
          "Type to search · ↑↓ move · Enter select",
          Math.max(20, (process.stdout.columns || 80) - 2),
        ),
    },
  };
  return {
    search: <T>(
      message: string,
      source: (term: string, signal?: AbortSignal) => Promise<Choice<T>[]>,
    ) =>
      search(
        {
          message: terminalText(message, true),
          theme: searchTheme,
          pageSize: Math.min(10, Math.max(3, (process.stdout.rows ?? 24) - 8)),
          source: async (term, context) => {
            if (term) await delay(250, undefined, { signal: context.signal });
            if (context.signal.aborted) return [];
            return (await source(term ?? "", context.signal)).map((choice) => ({
              ...choice,
              name: compactText(
                terminalText(choice.name, true),
                Math.max(20, (process.stdout.columns ?? 80) - 8),
              ),
            }));
          },
        },
        { signal },
      ),
    select: <T>(message: string, choices: Choice<T>[]) => {
      const options = choices.map((choice) => ({
        ...choice,
        name: compactText(
          terminalText(choice.name, true),
          Math.max(20, (process.stdout.columns ?? 80) - 8),
        ),
        ...(choice.description
          ? { description: terminalText(choice.description, true) }
          : {}),
      }));
      const config = {
        message: terminalText(message, true),
        theme,
        pageSize: Math.min(10, Math.max(3, (process.stdout.rows ?? 24) - 8)),
      };
      return choices.length <= 10
        ? select({ ...config, choices: options }, { signal })
        : search(
            {
              ...config,
              theme: searchTheme,
              source: async (term) =>
                options.filter((_choice, index) =>
                  terminalText(choices[index]!.name, true)
                    .toLowerCase()
                    .includes((term ?? "").toLowerCase()),
                ),
            },
            { signal },
          );
    },
    input: async (message, initial) => {
      if (initial !== undefined && terminalText(initial, true) !== initial) {
        if (
          await confirm(
            {
              message: `Keep the current value for ${terminalText(message, true)} unchanged?`,
              theme,
              default: true,
            },
            { signal },
          )
        )
          return initial;
        return editor(
          { message: terminalText(message, true), theme, default: initial },
          { signal },
        );
      }
      return input(
        { message: terminalText(message, true), theme, default: initial },
        { signal },
      );
    },
    confirm: (message, initial = false) =>
      confirm(
        { message: terminalText(message, true), theme, default: initial },
        { signal },
      ),
    editor: (message, initial) =>
      editor(
        { message: terminalText(message, true), theme, default: initial },
        { signal },
      ),
  };
}

export interface CatalogApp {
  bundleIdentifier: string;
  name: string;
  widgets: {
    name?: string;
    target: { container: string; extension: string; kind: string };
    sizes: import("./controller.js").WidgetSize[];
  }[];
}
export async function selectCatalogTarget(
  apps: CatalogApp[],
  filters: { app?: string; extension?: string; kind?: string; size?: string },
  prompts?: Prompts,
): Promise<import("./controller.js").WidgetTarget | undefined> {
  const matchesWidget = (widget: CatalogApp["widgets"][number]) =>
    (!filters.extension || widget.target.extension === filters.extension) &&
    (!filters.kind || widget.target.kind === filters.kind) &&
    (!filters.size ||
      widget.sizes.includes(
        filters.size as import("./controller.js").WidgetSize,
      ));
  const available = apps.filter(
    (app) =>
      (!filters.app || app.bundleIdentifier === filters.app) &&
      app.widgets.some(matchesWidget),
  );
  if (!available.length)
    throw new Error(
      "No installed catalog widget matches the requested app, extension, kind and size.",
    );
  const back = Symbol("back");
  const appNames = uniqueNames(
    available.map((app) => ({ name: app.name, id: app.bundleIdentifier })),
  );
  let stage: "app" | "kind" | "size" = "app";
  let app: CatalogApp | undefined;
  let widget: CatalogApp["widgets"][number] | undefined;
  for (;;) {
    if (stage === "app") {
      if (!prompts && available.length !== 1)
        throw new Error("App selection is ambiguous; pass --app.");
      const selected =
        available.length === 1
          ? available[0]!
          : await prompts!.select<CatalogApp | symbol>("Choose an app", [
              ...available.map((app, index) => ({
                name: appNames[index]!,
                value: app,
              })),
              { name: "Cancel", value: back },
            ]);
      if (typeof selected === "symbol") return undefined;
      app = selected;
      stage = "kind";
    } else if (stage === "kind") {
      const widgets = app!.widgets.filter(matchesWidget);
      const widgetNames = uniqueNames(
        widgets.map((widget) => ({
          name: widget.name ?? widget.target.kind,
          id: widget.target.kind,
          detail: widget.target.extension,
        })),
      );
      if (!widgets.length)
        throw new Error(
          "Requested widget kind is absent from the installed catalog.",
        );
      if (!prompts && widgets.length !== 1)
        throw new Error(
          "Widget selection is ambiguous; pass --extension and --kind.",
        );
      const selected =
        widgets.length === 1
          ? widgets[0]!
          : await prompts!.select<CatalogApp["widgets"][number] | symbol>(
              "Choose a widget kind",
              [
                ...widgets.map((widget, index) => ({
                  name: widgetNames[index]!,
                  value: widget,
                })),
                {
                  name: available.length > 1 ? "Back to apps" : "Cancel",
                  value: back,
                },
              ],
            );
      if (typeof selected === "symbol") {
        if (available.length === 1) return undefined;
        stage = "app";
        continue;
      }
      widget = selected;
      stage = "size";
    } else {
      if (filters.size) {
        if (
          !widget!.sizes.includes(
            filters.size as import("./controller.js").WidgetSize,
          )
        )
          throw new Error("Requested size is not supported by this widget.");
        return {
          ...widget!.target,
          size: filters.size as import("./controller.js").WidgetSize,
        };
      }
      if (!prompts && widget!.sizes.length !== 1)
        throw new Error("Choose --size from the catalog.");
      const canChooseKind = app!.widgets.filter(matchesWidget).length > 1;
      const size =
        widget!.sizes.length === 1
          ? widget!.sizes[0]!
          : await prompts!.select<
              import("./controller.js").WidgetSize | symbol
            >("Choose a size", [
              ...widget!.sizes.map((size) => ({
                name: size
                  .replace(/(^|[-_ ])\w/g, (letter) => letter.toUpperCase())
                  .replaceAll("-", " ")
                  .replaceAll("_", " "),
                value: size,
              })),
              {
                name: canChooseKind
                  ? "Back to widget kinds"
                  : available.length > 1
                    ? "Back to apps"
                    : "Cancel",
                value: back,
              },
            ]);
      if (typeof size === "symbol") {
        const widgets = app!.widgets.filter(matchesWidget);
        if (widgets.length > 1) stage = "kind";
        else if (available.length > 1) stage = "app";
        else return undefined;
        continue;
      }
      return { ...widget!.target, size };
    }
  }
}
