import test from "node:test";
import assert from "node:assert/strict";
import { describeFromMetadata as describe } from "../src/configuration.js";
import type { JsonValue, WidgetConfiguration } from "../src/controller.js";

const describeFromMetadata = (
  config: WidgetConfiguration,
  metadata?: unknown,
) => describe(config, metadata, { locale: "en_US", decimalSeparator: "." });

function configuration(
  parameters: Record<string, JsonValue> = {},
): WidgetConfiguration {
  return {
    schemaVersion: 1,
    container: "dev.widgetctl.fixtures.garden",
    extension: "dev.widgetctl.fixtures.garden.widgets",
    kind: "PocketGarden.Configuration",
    size: "medium",
    intent: {
      intentClass: "INAppIntent",
      appBundleIdentifier: "dev.widgetctl.fixtures.garden",
      extensionBundleIdentifier: "dev.widgetctl.fixtures.garden.widgets",
      appIntentIdentifier: "GardenConfiguration",
      parameters,
    },
  };
}
const primitive = (typeIdentifier: number) => ({
  primitive: { wrapper: { typeIdentifier } },
});
const entity = { entity: { wrapper: { typeName: "Plant" } } };
const parameter = (name: string, valueType: unknown, isOptional = false) => ({
  name,
  title: { key: `Title for ${name}` },
  valueType,
  isOptional,
});
function metadata(parameters: unknown[]) {
  return {
    version: 1,
    actions: {
      GardenConfiguration: { identifier: "GardenConfiguration", parameters },
    },
    enums: [
      {
        identifier: "Season",
        cases: [
          {
            identifier: "spring",
            displayRepresentation: { title: { key: "Spring" } },
          },
          {
            identifier: "summer",
            displayRepresentation: { title: { key: "Summer" } },
          },
        ],
      },
    ],
  };
}

test("compiler metadata preserves all six canonical value types and human titles", () => {
  const params = {
    showWatering: true,
    gardenNote: "Custom garden",
    waterAmount: 3.5,
    season: "summer",
    featuredPlant: { identifier: "fern", opaque: { generation: 2 } },
    companionPlants: [{ identifier: "orchid" }],
  };
  const original = configuration(params);
  const result = describeFromMetadata(
    original,
    metadata([
      parameter("showWatering", primitive(1)),
      parameter("gardenNote", primitive(0)),
      parameter("waterAmount", primitive(7)),
      parameter("season", {
        linkEnumeration: { wrapper: { identifier: "Season" } },
      }),
      parameter("featuredPlant", entity, true),
      parameter(
        "companionPlants",
        { array: { wrapper: { capabilities: 3, memberValueType: entity } } },
        true,
      ),
    ]),
  );
  assert.equal(result.configuration, original);
  assert.deepEqual(
    result.fields.map((field) => field.type),
    ["boolean", "string", "number", "enum", "entity", "entities"],
  );
  for (const field of result.fields) {
    assert.equal(field.value, params[field.key as keyof typeof params]);
    assert.equal(field.label, `Title for ${field.key}`);
    assert.equal(field.present, true);
  }
  assert.deepEqual(result.fields[3]!.choices, [
    { label: "Spring", value: "spring" },
    { label: "Summer", value: "summer" },
  ]);
  assert.equal(result.fields[4]!.choices, undefined);
  assert.equal(result.fields[5]!.choices, undefined);
});

test("absent optional fields are distinct from explicit null without inferring defaults", () => {
  const original = configuration({ explicitNull: null });
  const result = describeFromMetadata(
    original,
    metadata([
      parameter("absent", primitive(0), true),
      parameter("explicitNull", entity, true),
      {
        ...parameter("requiredAbsent", primitive(7)),
        typeSpecificMetadata: [
          "LNValueTypeSpecificMetadataKeyDefaultValue",
          { double: { wrapper: 96 } },
        ],
      },
    ]),
  );
  assert.deepEqual(
    result.fields.map(({ key, value, present, type }) => ({
      key,
      value,
      present,
      type,
    })),
    [
      { key: "absent", value: null, present: false, type: "string" },
      { key: "explicitNull", value: null, present: true, type: "entity" },
      {
        key: "requiredAbsent",
        value: null,
        present: false,
        type: "unsupported",
      },
    ],
  );
  assert.deepEqual(original.intent.parameters, { explicitNull: null });
});

test("unavailable and mismatched actions preserve unknown parameters as read only", () => {
  const original = configuration({ opaque: { retained: [1, "x"] } });
  for (const input of [
    undefined,
    {},
    { ...metadata([]), version: 2 },
    {
      ...metadata([]),
      actions: {
        DifferentIntent: { identifier: "DifferentIntent", parameters: [] },
      },
    },
  ]) {
    const result = describeFromMetadata(original, input);
    assert.match(result.reason!, /metadata|exact/);
    assert.equal(result.fields[0]!.type, "unsupported");
    assert.equal(result.fields[0]!.value, original.intent.parameters.opaque);
  }
  assert.match(
    describeFromMetadata(configuration(), undefined).reason!,
    /metadata/,
  );
});

test("unknown primitive IDs and incompatible canonical types remain read only", () => {
  const result = describeFromMetadata(
    configuration({ future: 1, wrong: "false", unknown: true }),
    metadata([
      parameter("future", primitive(2)),
      parameter("wrong", primitive(1)),
    ]),
  );
  assert.deepEqual(
    result.fields.map((field) => field.type),
    ["unsupported", "unsupported", "unsupported"],
  );
  assert.match(result.fields[0]!.reason!, /Unrecognized/);
  assert.match(result.fields[1]!.reason!, /does not match/);
  assert.match(result.fields[2]!.reason!, /no matching/);
});

test("ambiguous parameters and enum choices never enable an editor", () => {
  const original = configuration({ season: "summer" });
  const field = parameter("season", {
    linkEnumeration: { wrapper: { identifier: "Season" } },
  });
  assert.equal(
    describeFromMetadata(original, metadata([field, field])).fields[0]!.type,
    "unsupported",
  );
  const missingEnum = { ...metadata([field]), enums: [] };
  assert.equal(
    describeFromMetadata(original, missingEnum).fields[0]!.type,
    "unsupported",
  );
  const duplicateEnum = metadata([field]);
  duplicateEnum.enums[0]!.cases.push(duplicateEnum.enums[0]!.cases[0]!);
  assert.equal(
    describeFromMetadata(original, duplicateEnum).fields[0]!.type,
    "unsupported",
  );
  assert.equal(
    describeFromMetadata(configuration({ season: "other" }), metadata([field]))
      .fields[0]!.type,
    "unsupported",
  );
});

test("labels fall back to actual keys and unsupported entity arrays keep their value", () => {
  const result = describeFromMetadata(
    configuration({ plants: "opaque" }),
    metadata([
      {
        name: "plants",
        valueType: { array: { wrapper: { memberValueType: entity } } },
        isOptional: true,
      },
    ]),
  );
  assert.equal(result.fields[0]!.label, "plants");
  assert.equal(result.fields[0]!.value, "opaque");
  assert.equal(result.fields[0]!.type, "unsupported");
});

test("nonfinite, non-JSON and excessively recursive canonical values are rejected", () => {
  for (const value of [NaN, Infinity, undefined, new Date(), () => {}])
    assert.throws(
      () =>
        describeFromMetadata(
          configuration({ value: value as JsonValue }),
          metadata([]),
        ),
      /finite JSON/,
    );
  const recursive: Record<string, JsonValue> = {};
  recursive.self = recursive;
  assert.throws(
    () => describeFromMetadata(configuration(recursive), metadata([])),
    /depth/,
  );
});

test("native decimal strings are editable numbers and opaque descriptor metadata stays read only", () => {
  const config = configuration({
    tempo: "7.5",
    AppIntentDescriptor: {
      BundleIdentifier: "dev.widgetctl.fixtures.garden",
      Name: "Pocket Garden",
      AppIntentIdentifier: "GardenConfiguration",
    },
  });
  const result = describeFromMetadata(
    config,
    metadata([parameter("tempo", primitive(7))]),
  );
  assert.equal(result.fields[0]!.type, "number");
  assert.equal(result.fields[0]!.numberEncoding, "decimal-string");
  assert.equal(result.fields[0]!.value, "7.5");
  assert.equal(result.fields[1]!.type, "unsupported");
  assert.deepEqual(result.configuration, config);
  for (const value of [" 7.5", "7.5 ", "0x10", "Infinity", "NaN", ""]) {
    const invalid = describeFromMetadata(
      configuration({ tempo: value }),
      metadata([parameter("tempo", primitive(7))]),
    );
    assert.equal(invalid.fields[0]!.type, "unsupported", value);
  }
});

test("numeric schema uses the simulator decimal separator and rejects unknown formats", () => {
  const schema = metadata([parameter("tempo", primitive(7))]);
  const localized = describe(configuration({ tempo: "7,5" }), schema, {
    locale: "en_UA",
    decimalSeparator: ",",
  });
  assert.equal(localized.fields[0]!.type, "number");
  assert.deepEqual(localized.numberFormat, {
    locale: "en_UA",
    decimalSeparator: ",",
  });
  assert.equal(
    describe(configuration({ tempo: "7.5" }), schema, {
      locale: "en_UA",
      decimalSeparator: ",",
    }).fields[0]!.type,
    "unsupported",
  );
  assert.equal(
    describe(configuration({ tempo: 7.5 }), schema).fields[0]!.type,
    "unsupported",
  );
});

test("metadata title fallbacks prefer compiler defaults without changing canonical values", () => {
  const config = configuration({ base: "EUR", season: "spring" });
  const schema = metadata([
    {
      ...parameter("base", primitive(0)),
      title: { key: "baseParameter", defaultValue: "Base", table: "Widgets" },
    },
    {
      ...parameter("season", {
        linkEnumeration: { wrapper: { identifier: "Season" } },
      }),
      title: { defaultValue: "Season" },
    },
  ]);
  schema.enums[0]!.cases[0]!.displayRepresentation.title = {
    key: "springKey",
    defaultValue: "Spring default",
  } as any;
  const result = describeFromMetadata(config, schema);
  assert.equal(result.fields[0]!.label, "Base");
  assert.equal(result.fields[1]!.label, "Season");
  assert.equal(result.fields[1]!.choices![0]!.label, "Spring default");
  assert.deepEqual(result.configuration.intent.parameters, {
    base: "EUR",
    season: "spring",
  });
});

test("installed extension tables resolve regional locales, binary strings and enum titles safely", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { default: plist } = await import("plist");
  const { resolveMetadataLabels } = await import("../src/configuration.js");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "widgetctl-labels-"));
  try {
    const extension = path.join(root, "Widget.appex");
    await fs.mkdir(path.join(extension, "en.lproj"), { recursive: true });
    await fs.mkdir(path.join(extension, "uk.lproj"), { recursive: true });
    await fs.writeFile(
      path.join(extension, "en.lproj", "Widgets.strings"),
      plist.build({
        baseParameter: "Base English",
        selectedList: "Custom list English",
      }),
    );
    await fs.writeFile(
      path.join(extension, "uk.lproj", "Widgets.strings"),
      Buffer.from(
        "YnBsaXN0MDDSAQIDBF1iYXNlUGFyYW1ldGVyXHNlbGVjdGVkTGlzdGYEEQQwBDcEPgQyBDBuBBIEOAQxBEAEMAQ9BFYAIAQyBDAEOwROBEIEOAgNGyg1AAAAAAAAAQEAAAAAAAAABQAAAAAAAAAAAAAAAAAAAFI=",
        "base64",
      ),
    );
    const make = (table: unknown = "Widgets") => {
      const schema = metadata([
        {
          ...parameter("base", primitive(0)),
          title: { key: "baseParameter", defaultValue: "Default base", table },
        },
        parameter("season", {
          linkEnumeration: { wrapper: { identifier: "Season" } },
        }),
      ]);
      schema.enums[0]!.cases[0]!.displayRepresentation.title = {
        key: "selectedList",
        table: "Widgets",
        defaultValue: "Default list",
      } as any;
      return schema;
    };
    const config = configuration({ base: "EUR", season: "spring" });
    const schema = make();
    await resolveMetadataLabels(schema, extension, "en_UA");
    let result = describeFromMetadata(config, schema);
    assert.equal(result.fields[0]!.label, "Base English");
    assert.equal(result.fields[1]!.choices![0]!.label, "Custom list English");
    await resolveMetadataLabels(schema, extension, "uk_UA");
    result = describeFromMetadata(config, schema);
    assert.equal(result.fields[0]!.label, "Базова");
    assert.equal(result.fields[1]!.choices![0]!.label, "Вибрані валюти");
    await resolveMetadataLabels(schema, extension, "fr_FR");
    assert.equal(
      describeFromMetadata(config, schema).fields[0]!.label,
      "Default base",
    );
    for (const table of [
      undefined,
      "Missing",
      "../../Outside",
      "/tmp/Outside",
    ]) {
      const input = make(table === undefined ? null : table);
      await resolveMetadataLabels(input, extension, "en_UA");
      assert.equal(
        describeFromMetadata(config, input).fields[0]!.label,
        "Default base",
      );
    }
    const noDefault = make("Missing");
    delete (noDefault.actions.GardenConfiguration.parameters[0] as any).title
      .defaultValue;
    await resolveMetadataLabels(noDefault, extension, "en_UA");
    assert.equal(
      describeFromMetadata(config, noDefault).fields[0]!.label,
      "baseParameter",
    );
    await fs.writeFile(
      path.join(root, "Outside.strings"),
      plist.build({ baseParameter: "Unsafe external title" }),
    );
    await fs.symlink(
      path.join(root, "Outside.strings"),
      path.join(extension, "en.lproj", "Linked.strings"),
    );
    await fs.symlink(
      path.join(extension, "en.lproj"),
      path.join(extension, "de.lproj"),
    );
    for (const [locale, table] of [
      ["en_UA", "Linked"],
      ["de_DE", "Widgets"],
      ["../en", "Widgets"],
    ]) {
      const input = make(table);
      await resolveMetadataLabels(input, extension, locale);
      assert.equal(
        describeFromMetadata(config, input).fields[0]!.label,
        "Default base",
      );
    }
    await fs.writeFile(
      path.join(extension, "en.lproj", "Large.strings"),
      Buffer.alloc(1024 * 1024 + 1),
    );
    const large = make("Large");
    await resolveMetadataLabels(large, extension, "en_UA");
    assert.equal(
      describeFromMetadata(config, large).fields[0]!.label,
      "Default base",
    );
    assert.deepEqual(config.intent.parameters, {
      base: "EUR",
      season: "spring",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
