import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editConfiguration,
  type ConfigurationDescription,
  type Prompts,
} from "../src/interactive.js";
const original: ConfigurationDescription = {
  numberFormat: { locale: "en_US", decimalSeparator: "." },
  configuration: {
    schemaVersion: 1,
    extension: "app.widget",
    kind: "rates",
    size: "small",
    container: "app",
    intent: {
      intentClass: "INAppIntent",
      appBundleIdentifier: "app",
      extensionBundleIdentifier: "app.widget",
      appIntentIdentifier: "Rates",
      parameters: {
        currency: { identifier: "USD", metadata: { title: "Dollar" } },
        showCode: false,
        amount: 1,
      },
    },
  },
  fields: [
    {
      present: true,
      key: "currency",
      label: "Currency",
      type: "entity",
      value: { identifier: "USD", metadata: { title: "Dollar" } },
      choices: [
        {
          label: "Euro",
          value: { identifier: "EUR", metadata: { title: "Euro" } },
        },
      ],
    },
    {
      present: true,
      key: "showCode",
      label: "Show code",
      type: "boolean",
      value: false,
    },
    { present: true, key: "amount", label: "Amount", type: "number", value: 1 },
  ],
};
function prompts(
  selections: unknown[],
  confirmations: boolean[],
  inputs: string[] = [],
): Prompts {
  return {
    select: async (_message, choices) => {
      const selected = selections.shift();
      if (selected === "$save")
        return choices.find((choice) => choice.name === "Review and save")!
          .value;
      if (selected === "$back")
        return choices.find((choice) => choice.name === "Discard and go back")!
          .value;
      return selected as never;
    },
    confirm: async () => confirmations.shift()!,
    input: async () => inputs.shift()!,
    editor: async () => inputs.shift()!,
  };
}
test("editor stages edits, preserves full entity metadata and confirms a diff", async () => {
  let output = "";
  const result = await editConfiguration(
    original,
    prompts(
      [
        "currency",
        { identifier: "EUR", metadata: { title: "Euro" } },
        "showCode",
        "$save",
      ],
      [true, true],
    ),
    (text) => {
      output += text;
    },
  );
  assert.deepEqual(result!.intent.parameters.currency, {
    identifier: "EUR",
    metadata: { title: "Euro" },
  });
  assert.equal(result!.intent.parameters.showCode, true);
  assert.deepEqual(original.configuration.intent.parameters.currency, {
    identifier: "USD",
    metadata: { title: "Dollar" },
  });
  assert.match(output, /currency:.*USD.*EUR/);
});
test("discard and declined save never return a writeable draft", async () => {
  assert.equal(
    await editConfiguration(
      original,
      prompts(["showCode", "$save", "$back"], [true, false]),
      () => {},
    ),
    undefined,
  );
  assert.equal(original.configuration.intent.parameters.showCode, false);
});
test("invalid numeric input does not silently become zero", async () => {
  let output = "";
  assert.equal(
    await editConfiguration(
      original,
      prompts(["amount", "$save"], [], [""]),
      (text) => {
        output += text;
      },
    ),
    undefined,
  );
  assert.match(output, /finite decimal number/);
  assert.match(output, /No changes/);
});
test("unknown entity choices require an explicit JSON fallback", async () => {
  const description = structuredClone(original);
  delete description.fields[0]!.choices;
  const result = await editConfiguration(
    description,
    prompts(
      ["currency", "$save"],
      [true, true],
      ['{"identifier":"GBP","metadata":{"title":"Pound"}}'],
    ),
    () => {},
  );
  assert.deepEqual(result!.intent.parameters.currency, {
    identifier: "GBP",
    metadata: { title: "Pound" },
  });
});
test("unsupported fields are read only and surface their reason", async () => {
  const description = structuredClone(original);
  description.fields[0]!.type = "unsupported";
  description.fields[0]!.reason = "Runtime cannot enumerate this value";
  let output = "";
  assert.equal(
    await editConfiguration(
      description,
      prompts(["currency", "$back"], []),
      (text) => {
        output += text;
      },
    ),
    undefined,
  );
  assert.match(output, /Runtime cannot enumerate/);
});

test("entity lists toggle advertised complete values without JSON editing", async () => {
  const description = structuredClone(original);
  description.configuration.intent.parameters.currency = [];
  description.fields[0]!.type = "entities";
  description.fields[0]!.value = [];
  const result = await editConfiguration(
    description,
    prompts(["currency", 0, -1, "$save"], [true]),
    () => {},
  );
  assert.deepEqual(result!.intent.parameters.currency, [
    { identifier: "EUR", metadata: { title: "Euro" } },
  ]);
});

test("entity search forwards the entered term and preserves returned identifiers", async () => {
  const description = structuredClone(original);
  delete description.fields[0]!.choices;
  const questions = prompts(["currency", "$save"], [true]);
  const terms: string[] = [];
  questions.search = async (_message, source) =>
    (await source("eur"))[1]!.value;
  const result = await editConfiguration(
    description,
    questions,
    () => {},
    async (key, term) => {
      assert.equal(key, "currency");
      terms.push(term ?? "");
      return [
        {
          label: "Euro",
          value: { identifier: "EUR", metadata: { title: "Euro" } },
        },
      ];
    },
  );
  assert.deepEqual(terms, ["", "eur"]);
  assert.deepEqual(result!.intent.parameters.currency, {
    identifier: "EUR",
    metadata: { title: "Euro" },
  });
});

test("unsupported runtime choice queries explain the limit before JSON fallback", async () => {
  const description = structuredClone(original);
  delete description.fields[0]!.choices;
  let output = "";
  const result = await editConfiguration(
    description,
    prompts(["currency", "$back"], [false]),
    (text) => {
      output += text;
    },
    async () => {
      throw new Error("Runtime does not support entity discovery");
    },
  );
  assert.equal(result, undefined);
  assert.match(output, /Runtime does not support entity discovery/);
});

test("catalog wizard backs from sizes through kinds and apps without writing", async () => {
  const { selectCatalogTarget } = await import("../src/interactive.js");
  const widgets = ["first", "second"].map((kind) => ({
    target: { extension: "app.widget", container: "app", kind },
    sizes: ["small", "medium"] as ("small" | "medium")[],
  }));
  const apps = [
    { bundleIdentifier: "app", name: "First", widgets },
    { bundleIdentifier: "other", name: "Other", widgets },
  ];
  const choices = [
    "First",
    "first",
    "Back",
    "Back",
    "Other",
    "second",
    "medium",
  ];
  const messages: string[] = [];
  const answers: Prompts = {
    ...prompts([], []),
    select: async (message, options) => {
      messages.push(message);
      const prefix = choices.shift()!;
      return options.find((option) => option.name.startsWith(prefix))!.value;
    },
  };
  const target = await selectCatalogTarget(apps, {}, answers);
  assert.equal(target!.kind, "second");
  assert.equal(target!.size, "medium");
  assert.deepEqual(messages, [
    "Choose an app",
    "Choose a widget kind",
    "Choose a size",
    "Choose a widget kind",
    "Choose an app",
    "Choose a widget kind",
    "Choose a size",
  ]);
});

for (const action of ["null", "remove"]) {
  test(`optional fields can become explicitly ${action === "null" ? "null" : "absent"} with a reviewed diff`, async () => {
    const description = structuredClone(original);
    description.fields[1]!.optional = true;
    let output = "";
    const result = await editConfiguration(
      description,
      prompts(["showCode", action, "$save"], [true]),
      (text) => {
        output += text;
      },
    );
    assert.ok(result);
    if (action === "null")
      assert.equal(result.intent.parameters.showCode, null);
    else
      assert.equal(Object.hasOwn(result.intent.parameters, "showCode"), false);
    assert.match(
      output,
      action === "null"
        ? /showCode: false → null/
        : /showCode: false → \(absent\)/,
    );
    assert.equal(description.configuration.intent.parameters.showCode, false);
  });
}

for (const type of ["entity", "entities"] as const) {
  test(`${type} source failures resolve to Back and JSON choices rather than rejected sources`, async () => {
    const description = structuredClone(original);
    const field = description.fields[0]!;
    field.type = type;
    delete field.choices;
    const questions = prompts(["currency", "$back"], []);
    let sourceWasCalled = false;
    questions.search = async (_message, source) => {
      const options = await source("broken");
      sourceWasCalled = true;
      assert.match(options[1]!.name, /Choice lookup failed.*unavailable/);
      assert.equal(options[0]!.name, "Back");
      return options[0]!.value;
    };
    const result = await editConfiguration(
      description,
      questions,
      () => {},
      async (_key, term) => {
        if (term) throw new Error("query unavailable");
        return [];
      },
    );
    assert.equal(result, undefined);
    assert.equal(sourceWasCalled, true);
  });
}

test("explicit kind and size filter app choices before ambiguity checks", async () => {
  const { selectCatalogTarget } = await import("../src/interactive.js");
  const apps = [
    {
      bundleIdentifier: "one",
      name: "One",
      widgets: [
        {
          target: { extension: "one.widgets", container: "one", kind: "alpha" },
          sizes: ["small" as const],
        },
      ],
    },
    {
      bundleIdentifier: "two",
      name: "Two",
      widgets: [
        {
          target: { extension: "two.widgets", container: "two", kind: "beta" },
          sizes: ["medium" as const],
        },
      ],
    },
  ];
  assert.deepEqual(
    await selectCatalogTarget(apps, { kind: "beta", size: "medium" }),
    {
      extension: "two.widgets",
      container: "two",
      kind: "beta",
      size: "medium",
    },
  );
  await assert.rejects(
    selectCatalogTarget(apps, { kind: "beta", size: "large" }),
    /No installed catalog widget matches/,
  );
});

test("failed initial suggestions can be refined using the staged dependent values", async () => {
  const description = structuredClone(original);
  delete description.fields[0]!.choices;
  const questions = prompts(["showCode", "currency", "$save"], [true, true]);
  questions.search = async (_message, source) =>
    (await source("eur"))[1]!.value;
  const terms: string[] = [];
  const result = await editConfiguration(
    description,
    questions,
    () => {},
    async (key, term, draft) => {
      assert.equal(key, "currency");
      assert.equal(draft!.intent.parameters.showCode, true);
      assert.equal(original.configuration.intent.parameters.showCode, false);
      terms.push(term ?? "");
      if (!term) throw Error("Too many choices; refine the search");
      return [
        {
          label: "Euro",
          value: { identifier: "EUR", metadata: { title: "Euro" } },
        },
      ];
    },
  );
  assert.deepEqual(terms, ["", "eur"]);
  assert.equal(result!.intent.parameters.showCode, true);
  assert.deepEqual(result!.intent.parameters.currency, {
    identifier: "EUR",
    metadata: { title: "Euro" },
  });
});

test("native decimal edits encode strings and preserve unknown descriptor metadata", async () => {
  const description = structuredClone(original);
  description.configuration.intent.parameters.amount = "7.5";
  description.configuration.intent.parameters.AppIntentDescriptor = {
    BundleIdentifier: "app",
    Name: "Native descriptor",
  };
  description.fields[2] = {
    ...description.fields[2]!,
    value: "7.5",
    numberEncoding: "decimal-string",
  };
  const result = await editConfiguration(
    description,
    prompts(["amount", "$save"], [true], ["0.1"]),
    () => {},
  );
  assert.equal(result!.intent.parameters.amount, "0.1");
  assert.deepEqual(
    result!.intent.parameters.AppIntentDescriptor,
    description.configuration.intent.parameters.AppIntentDescriptor,
  );
});
for (const current of [2.5, "7.50"])
  test(`accepting native decimal default ${JSON.stringify(current)} preserves canonical storage`, async () => {
    const description = structuredClone(original);
    description.configuration.intent.parameters.amount = current;
    description.fields[2] = {
      ...description.fields[2]!,
      value: current,
      numberEncoding: "decimal-string",
    };
    const result = await editConfiguration(
      description,
      prompts(["amount", "$save"], [], [String(current)]),
      () => {},
    );
    assert.equal(result, undefined);
    assert.equal(description.configuration.intent.parameters.amount, current);
  });

test("decimal prompts use readable input while saving the simulator locale encoding", async () => {
  const description = structuredClone(original);
  description.numberFormat = { locale: "en_UA", decimalSeparator: "," };
  description.configuration.intent.parameters.amount = "7,50";
  description.fields[2] = {
    ...description.fields[2]!,
    value: "7,50",
    numberEncoding: "decimal-string",
  };
  const questions = prompts(["amount", "$save"], [true]);
  questions.input = async (_message, initial) => {
    assert.equal(initial, "7.50");
    return "0.1";
  };
  const result = await editConfiguration(description, questions, () => {});
  assert.equal(result!.intent.parameters.amount, "0,1");
  const unchanged = await editConfiguration(
    description,
    prompts(["amount", "$save"], [], ["7.50"]),
    () => {},
  );
  assert.equal(unchanged, undefined);
  assert.equal(description.configuration.intent.parameters.amount, "7,50");
});
