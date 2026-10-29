import * as fs from "node:fs/promises";
import path from "node:path";
import plist from "plist";
import bplist from "bplist-parser";
import type { JsonValue, WidgetConfiguration } from "./controller.js";
import { listApplications } from "./discovery.js";

export interface ConfigurationField {
  key: string;
  label: string;
  type:
    | "boolean"
    | "string"
    | "number"
    | "enum"
    | "entity"
    | "entities"
    | "unsupported";
  value: JsonValue;
  present: boolean;
  numberEncoding?: "decimal-string";
  choices?: { label: string; value: JsonValue }[];
  reason?: string;
  optional?: boolean;
}
export interface NumberFormat {
  locale: string;
  decimalSeparator: string;
}
export interface ConfigurationDescription {
  numberFormat?: NumberFormat;
  configuration: WidgetConfiguration;
  fields: ConfigurationField[];
  reason?: string;
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const resolvedLabels = new WeakMap<object, string>();
const label = (value: unknown, fallback: string): string => {
  if (!record(value)) return fallback;
  return (
    resolvedLabels.get(value) ??
    (nonempty(value.defaultValue)
      ? value.defaultValue
      : nonempty(value.key)
        ? value.key
        : fallback)
  );
};

function validateJSON(
  value: unknown,
  depth = 0,
  budget = { left: 100000 },
): void {
  if (depth > 64 || --budget.left < 0)
    throw Error("Configuration exceeds the supported JSON size or depth");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) validateJSON(item, depth + 1, budget);
    return;
  }
  if (record(value)) {
    for (const item of Object.values(value))
      validateJSON(item, depth + 1, budget);
    return;
  }
  throw Error("Configuration must contain only finite JSON values");
}

export function isFiniteDecimalString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) &&
    Number.isFinite(Number(value))
  );
}

export function nativeDecimalString(
  value: unknown,
  decimalSeparator: string,
): string | undefined {
  if (
    typeof value !== "string" ||
    (decimalSeparator !== "." && value.includes("."))
  )
    return undefined;
  const normalized = value.split(decimalSeparator).join(".");
  return isFiniteDecimalString(normalized) ? normalized : undefined;
}

function typedField(
  field: ConfigurationField,
  parameter: RecordValue,
  metadata: RecordValue,
  numberFormat?: NumberFormat,
): ConfigurationField {
  const valueType = parameter.valueType;
  const unsupported = (reason: string): ConfigurationField => ({
    ...field,
    type: "unsupported",
    reason,
  });
  if (!record(valueType) || Object.keys(valueType).length !== 1)
    return unsupported("Unknown compiler parameter type");
  if (!field.present && !field.optional)
    return unsupported(
      "Required parameter is absent from the canonical configuration; no default was inferred",
    );
  const accepts = (
    type: "boolean" | "string" | "number",
  ): ConfigurationField =>
    !field.present ||
    (field.value === null && field.optional) ||
    typeof field.value === type
      ? { ...field, type }
      : unsupported(
          "Canonical value does not match the compiler parameter type",
        );
  if (record(valueType.primitive) && record(valueType.primitive.wrapper)) {
    const identifier = valueType.primitive.wrapper.typeIdentifier;
    if (identifier === 1) return accepts("boolean");
    if (identifier === 0) return accepts("string");
    if (identifier === 7) {
      if (!numberFormat)
        return unsupported("The simulator number format is unavailable");
      if (
        !field.present ||
        (field.optional && field.value === null) ||
        (typeof field.value === "number" && Number.isFinite(field.value)) ||
        nativeDecimalString(field.value, numberFormat.decimalSeparator) !==
          undefined
      )
        return { ...field, type: "number", numberEncoding: "decimal-string" };
      return unsupported(
        "Canonical value does not match the compiler decimal number type",
      );
    }
    return unsupported("Unrecognized compiler primitive type identifier");
  }
  if (
    record(valueType.linkEnumeration) &&
    record(valueType.linkEnumeration.wrapper)
  ) {
    const identifier = valueType.linkEnumeration.wrapper.identifier;
    const enums = Array.isArray(metadata.enums) ? metadata.enums : [];
    const matches = enums.filter(
      (item) => record(item) && item.identifier === identifier,
    );
    if (
      !nonempty(identifier) ||
      matches.length !== 1 ||
      !record(matches[0]) ||
      !Array.isArray(matches[0].cases) ||
      matches[0].cases.length === 0
    )
      return unsupported(
        "Enumeration choices are missing or ambiguous in compiler metadata",
      );
    const choices: { label: string; value: JsonValue }[] = [];
    for (const item of matches[0].cases) {
      if (
        !record(item) ||
        !nonempty(item.identifier) ||
        choices.some((choice) => choice.value === item.identifier)
      )
        return unsupported(
          "Enumeration choices are invalid or duplicated in compiler metadata",
        );
      const title = record(item.displayRepresentation)
        ? item.displayRepresentation.title
        : undefined;
      choices.push({
        label: label(title, item.identifier),
        value: item.identifier,
      });
    }
    if (
      field.present &&
      !(field.value === null && field.optional) &&
      !choices.some((choice) => choice.value === field.value)
    )
      return unsupported(
        "Canonical value is not one of the compiler enumeration identifiers",
      );
    return { ...field, type: "enum", choices };
  }
  const entity = (value: unknown): boolean =>
    record(value) &&
    record(value.entity) &&
    record(value.entity.wrapper) &&
    nonempty(value.entity.wrapper.typeName);
  if (entity(valueType)) return { ...field, type: "entity" };
  if (
    record(valueType.array) &&
    record(valueType.array.wrapper) &&
    entity(valueType.array.wrapper.memberValueType)
  ) {
    if (
      field.present &&
      !Array.isArray(field.value) &&
      !(field.value === null && field.optional)
    )
      return unsupported("Canonical entity collection is not an array");
    return { ...field, type: "entities" };
  }
  return unsupported("This compiler parameter type has no supported editor");
}

export function describeFromMetadata(
  configuration: WidgetConfiguration,
  metadata?: unknown,
  format?: unknown,
): ConfigurationDescription {
  const numberFormat =
    record(format) &&
    nonempty(format.locale) &&
    typeof format.decimalSeparator === "string" &&
    [...format.decimalSeparator].length === 1 &&
    !/[\da-z\s+\-]/i.test(format.decimalSeparator)
      ? { locale: format.locale, decimalSeparator: format.decimalSeparator }
      : undefined;
  validateJSON(configuration);
  if (!record(configuration.intent?.parameters))
    throw Error("Configuration requires canonical parameters");
  const parameters = configuration.intent.parameters;
  const unavailable = (reason: string): ConfigurationDescription => ({
    configuration,
    reason,
    fields: Object.entries(parameters).map(([key, value]) => ({
      key,
      label: key,
      type: "unsupported",
      value,
      present: true,
      reason,
    })),
  });
  if (!record(metadata) || metadata.version !== 1 || !record(metadata.actions))
    return unavailable(
      "Compiler configuration metadata is unavailable or unsupported",
    );
  const identifier = configuration.intent.appIntentIdentifier;
  const action = Object.hasOwn(metadata.actions, identifier)
    ? metadata.actions[identifier]
    : undefined;
  if (
    !record(action) ||
    action.identifier !== identifier ||
    !Array.isArray(action.parameters)
  )
    return unavailable(
      "No exact compiler action matches the canonical intent identifier",
    );
  const schema = new Map<string, RecordValue>();
  for (const parameter of action.parameters) {
    if (
      !record(parameter) ||
      !nonempty(parameter.name) ||
      schema.has(parameter.name) ||
      typeof parameter.isOptional !== "boolean"
    )
      return unavailable(
        "Compiler configuration parameters are invalid or ambiguous",
      );
    schema.set(parameter.name, parameter);
  }
  const keys = [
    ...schema.keys(),
    ...Object.keys(parameters).filter((key) => !schema.has(key)),
  ];
  const fields = keys.map((key): ConfigurationField => {
    const parameter = schema.get(key);
    const present = Object.hasOwn(parameters, key);
    const field: ConfigurationField = {
      key,
      label: parameter ? label(parameter.title, key) : key,
      type: "unsupported",
      value: present ? parameters[key]! : null,
      present,
      ...(parameter ? { optional: parameter.isOptional as boolean } : {}),
    };
    return parameter
      ? typedField(field, parameter, metadata, numberFormat)
      : {
          ...field,
          reason: "Canonical parameter has no matching compiler metadata",
        };
  });
  return { configuration, fields, ...(numberFormat ? { numberFormat } : {}) };
}

async function readBounded(file: string, maximum: number): Promise<Buffer> {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum)
      throw Error("Compiler metadata exceeds the supported file size");
    const buffer = Buffer.alloc(maximum + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.length - total,
        null,
      );
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maximum)
      throw Error("Compiler metadata exceeds the supported file size");
    return buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
}
export async function resolveMetadataLabels(
  metadata: unknown,
  extension: string,
  locale?: string,
): Promise<unknown> {
  if (!record(metadata)) return metadata;
  const resources: RecordValue[] = [];
  if (record(metadata.actions))
    for (const action of Object.values(metadata.actions))
      if (record(action) && Array.isArray(action.parameters))
        for (const parameter of action.parameters)
          if (record(parameter) && record(parameter.title))
            resources.push(parameter.title);
  if (Array.isArray(metadata.enums))
    for (const enumeration of metadata.enums)
      if (record(enumeration) && Array.isArray(enumeration.cases))
        for (const item of enumeration.cases)
          if (
            record(item) &&
            record(item.displayRepresentation) &&
            record(item.displayRepresentation.title)
          )
            resources.push(item.displayRepresentation.title);
  for (const resource of resources) resolvedLabels.delete(resource);
  if (!locale || !/^[a-z]{2,8}(?:[-_][a-z0-9]{2,8})*$/i.test(locale))
    return metadata;
  const bundle = await fs.realpath(extension);
  const components = locale.replaceAll("_", "-").split("-");
  const languages = [
    ...new Set([
      locale,
      components.join("-"),
      components.join("_"),
      components[0]!,
    ]),
  ];
  const tables = new Map<string, RecordValue | undefined>();
  let remainingBytes = 8 * 1024 * 1024;
  for (const resource of resources) {
    if (
      !nonempty(resource.key) ||
      !nonempty(resource.table) ||
      !/^[a-z0-9_ -][a-z0-9_. -]{0,127}$/i.test(resource.table)
    )
      continue;
    for (const language of languages) {
      const relative = path.join(
        `${language}.lproj`,
        `${resource.table}.strings`,
      );
      if (!tables.has(relative)) {
        if (tables.size >= 64 || remainingBytes <= 0) continue;
        let table: RecordValue | undefined;
        try {
          const directoryPath = path.join(bundle, `${language}.lproj`);
          const filePath = path.join(bundle, relative);
          if (
            (await fs.lstat(directoryPath)).isSymbolicLink() ||
            (await fs.lstat(filePath)).isSymbolicLink()
          )
            throw Error("Localized resources must not be symlinks");
          const directory = await fs.realpath(directoryPath);
          const file = await fs.realpath(filePath);
          if (
            directory.startsWith(bundle + path.sep) &&
            file.startsWith(directory + path.sep)
          ) {
            const bytes = await readBounded(
              file,
              Math.min(1024 * 1024, remainingBytes),
            );
            remainingBytes -= bytes.length;
            const parsed: unknown =
              bytes.subarray(0, 8).toString() === "bplist00"
                ? bplist.parseBuffer(bytes)[0]
                : plist.parse(bytes.toString("utf8"));
            if (record(parsed)) table = parsed;
          }
        } catch {}
        tables.set(relative, table);
      }
      const table = tables.get(relative);
      if (
        table &&
        Object.hasOwn(table, resource.key) &&
        nonempty(table[resource.key])
      ) {
        resolvedLabels.set(resource, table[resource.key] as string);
        break;
      }
    }
  }
  return metadata;
}

async function bundleIdentifier(bundle: string): Promise<unknown> {
  const bytes = await readBounded(path.join(bundle, "Info.plist"), 1024 * 1024);
  const info: unknown =
    bytes.subarray(0, 8).toString() === "bplist00"
      ? bplist.parseBuffer(bytes)[0]
      : plist.parse(bytes.toString("utf8"));
  return record(info) ? info.CFBundleIdentifier : undefined;
}

export async function readConfigurationMetadata(
  udid: string,
  configuration: WidgetConfiguration,
  locale?: string,
): Promise<unknown | undefined> {
  const applications = await listApplications(udid);
  const matches = applications.filter(
    (app) => app.bundleIdentifier === configuration.container,
  );
  if (
    matches.length !== 1 ||
    !matches[0]!.path ||
    !path.isAbsolute(matches[0]!.path!)
  )
    return undefined;
  try {
    const app = await fs.realpath(matches[0]!.path!);
    if ((await bundleIdentifier(app)) !== configuration.container)
      return undefined;
    const plugins = await fs.realpath(path.join(app, "PlugIns"));
    if (!plugins.startsWith(app + path.sep)) return undefined;
    const candidates: string[] = [];
    for (const entry of await fs.readdir(plugins, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".appex")) continue;
      const extension = await fs.realpath(path.join(plugins, entry.name));
      if (!extension.startsWith(plugins + path.sep)) continue;
      try {
        if ((await bundleIdentifier(extension)) === configuration.extension)
          candidates.push(extension);
      } catch {
        continue;
      }
    }
    if (candidates.length !== 1) return undefined;
    const metadata = await fs.realpath(
      path.join(candidates[0]!, "Metadata.appintents", "extract.actionsdata"),
    );
    if (!metadata.startsWith(candidates[0]! + path.sep)) return undefined;
    return await resolveMetadataLabels(
      JSON.parse(
        (await readBounded(metadata, 8 * 1024 * 1024)).toString("utf8"),
      ),
      candidates[0]!,
      locale,
    );
  } catch {
    return undefined;
  }
}
