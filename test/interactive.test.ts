import { test } from "node:test";
import assert from "node:assert/strict";
import { WidgetctlError } from "../src/errors.js";
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
        return choices.find((choice) =>
          choice.name.startsWith("Save changes ·"),
        )!.value;
      if (selected === "$advanced")
        return choices.find((choice) => choice.name === "Advanced…")!.value;
      if (selected === "$back")
        return choices.find((choice) => choice.name === "Back")!.value;
      return selected as never;
    },
    confirm: async () => confirmations.shift()!,
    input: async () => inputs.shift()!,
    editor: async () => inputs.shift()!,
  };
}
test("editor stages edits and preserves full entity metadata on direct save", async () => {
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
  assert.equal(output, "");
});
test("dirty Back asks before discarding and declined discard keeps the draft", async () => {
  const questions = prompts(["showCode", "$back", "$save"], [true, false]);
  const result = await editConfiguration(original, questions, () => {});
  assert.equal(result!.intent.parameters.showCode, true);
  assert.equal(original.configuration.intent.parameters.showCode, false);
  assert.equal(
    await editConfiguration(
      original,
      prompts(["showCode", "$back"], [true, true]),
      () => {},
    ),
    undefined,
  );
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
      ["$advanced", "currency", "json", "$save"],
      [],
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
      throw new WidgetctlError("Runtime does not support entity discovery", {
        code: "UNSUPPORTED_CHOICES",
      });
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
    "Medium",
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
      prompts(["$advanced", "showCode", action, "$save"], []),
      (text) => {
        output += text;
      },
    );
    assert.ok(result);
    if (action === "null")
      assert.equal(result.intent.parameters.showCode, null);
    else
      assert.equal(Object.hasOwn(result.intent.parameters, "showCode"), false);
    assert.equal(output, "");
    assert.equal(description.configuration.intent.parameters.showCode, false);
  });
}

for (const type of ["entity", "entities"] as const) {
  test(`${type} recoverable source failures resolve to Back and JSON choices rather than rejected sources`, async () => {
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
        if (term)
          throw new WidgetctlError("query unavailable", {
            code: "UNSUPPORTED_CHOICES",
          });
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
      if (!term)
        throw new WidgetctlError("Too many choices; refine the search", {
          code: "UNSUPPORTED_CHOICES",
        });
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

for (const type of ["entity", "entities"] as const) {
  for (const stage of ["initial", "search"] as const) {
    test(`${type} ${stage} discovery propagates unsafe and unknown failures without an editable draft`, async () => {
      const failures = [
        ...(
          [
            "OWNERSHIP_LOST",
            "UNSAFE_STATE",
            "CLEANUP_FAILED",
            "HELPER_UNAVAILABLE",
            "COMMAND_TIMEOUT",
            "STALE_CONFIGURATION",
          ] as const
        ).map((code) => new WidgetctlError(`fatal ${code}`, { code })),
        new Error("Unknown query failure"),
      ];
      for (const failure of failures) {
        const description = structuredClone(original);
        description.fields[0]!.type = type;
        delete description.fields[0]!.choices;
        const questions = prompts(["currency"], []);
        questions.confirm = async () => {
          assert.fail("Fatal discovery must not offer JSON editing or saving");
        };
        questions.editor = async () => {
          assert.fail("Fatal discovery must not create an editable draft");
        };
        let queries = 0;
        let searches = 0;
        questions.search = async (_message, source) => {
          searches++;
          assert.equal(stage, "search");
          const options = await source("broken");
          assert.equal(options.length, 1);
          assert.match(options[0]!.name, /Return to session/);
          assert.doesNotMatch(options[0]!.name, /JSON/);
          assert.deepEqual(await source("later"), options);
          assert.equal(
            queries,
            2,
            "A fatal search must stay fenced without another query",
          );
          return options[0]!.value;
        };
        await assert.rejects(
          editConfiguration(
            description,
            questions,
            () => {},
            async (_key, term) => {
              queries++;
              if (stage === "initial" || term) throw failure;
              return [];
            },
          ),
          (error) => error === failure,
        );
        assert.equal(searches, stage === "initial" ? 0 : 1);
        assert.deepEqual(description.configuration, original.configuration);
      }
    });
  }
}

test("recoverable query failures return safely without implicitly opening JSON", async () => {
  for (const code of [
    "UNSUPPORTED_CHOICES",
    "QUERY_TIMEOUT",
    "QUERY_FAILED",
  ] as const) {
    const description = structuredClone(original);
    delete description.fields[0]!.choices;
    let offeredFallback = false;
    const questions = prompts(["currency", "$back"], []);
    questions.confirm = async () => {
      offeredFallback = true;
      return false;
    };
    assert.equal(
      await editConfiguration(
        description,
        questions,
        () => {},
        async () => {
          throw new WidgetctlError("Recoverable query failure", { code });
        },
      ),
      undefined,
    );
    assert.equal(offeredFallback, false, code);
  }
});

for (const type of ["entity", "entities"] as const) {
  test(`${type} superseded search aborts do not fence the next live query`, async () => {
    const description = structuredClone(original);
    description.fields[0]!.type = type;
    delete description.fields[0]!.choices;
    const questions = prompts(["currency", "$save"], [true]);
    let searches = 0;
    const terms: string[] = [];
    questions.search = async (_message, source) => {
      if (searches++ === 0) {
        const oldQuery = new AbortController();
        oldQuery.abort();
        assert.deepEqual(await source("old", oldQuery.signal), []);
        const choices = await source("live", new AbortController().signal);
        return choices.find((choice) => choice.name.endsWith("Euro"))!.value;
      }
      return (await source("live"))[0]!.value;
    };
    let output = "";
    const result = await editConfiguration(
      description,
      questions,
      (text) => {
        output += text;
      },
      async (_key, term, _draft, signal) => {
        terms.push(term ?? "");
        signal?.throwIfAborted();
        return term ? [{ label: "Euro", value: { identifier: "EUR" } }] : [];
      },
    );
    assert.deepEqual(
      result!.intent.parameters.currency,
      type === "entity" ? { identifier: "EUR" } : [{ identifier: "EUR" }],
    );
    assert.deepEqual(terms.slice(0, 3), ["", "old", "live"]);
    assert.doesNotMatch(output, /lookup failed|lookup unavailable/);
  });

  test(`${type} an aborted search still propagates ownership failure and unrelated aborts`, async () => {
    for (const failure of [
      new WidgetctlError("Ownership lost during cancelled search", {
        code: "OWNERSHIP_LOST",
      }),
      new DOMException("Unrelated abort", "AbortError"),
    ]) {
      const description = structuredClone(original);
      description.fields[0]!.type = type;
      delete description.fields[0]!.choices;
      const questions = prompts(["currency"], []);
      questions.search = async (_message, source) => {
        const oldQuery = new AbortController();
        oldQuery.abort();
        const choices = await source("old", oldQuery.signal);
        assert.equal(choices.length, 1);
        assert.match(choices[0]!.name, /Return to session/);
        return choices[0]!.value;
      };
      await assert.rejects(
        editConfiguration(
          description,
          questions,
          () => {},
          async (_key, term) => {
            if (term) throw failure;
            return [];
          },
        ),
        (error) => error === failure,
      );
    }
  });
}

test("human summaries show inline changes and saving is the final action without confirmation", async () => {
  const description = structuredClone(original);
  description.fields[1]!.optional = true;
  description.configuration.intent.parameters.caption = "Hello";
  description.fields.push({
    key: "caption",
    label: "Caption",
    type: "string",
    value: "Hello",
    present: true,
  });
  const snapshots: string[][] = [];
  let step = 0;
  const questions: Prompts = {
    ...prompts([], []),
    select: async (_message, choices) => {
      snapshots.push(choices.map((choice) => choice.name));
      if (step++ === 0) return "showCode" as never;
      return choices.at(-1)!.value;
    },
    confirm: async (message) => {
      assert.equal(message, "Show code");
      return true;
    },
  };
  const result = await editConfiguration(description, questions, () => {});
  assert.equal(result!.intent.parameters.showCode, true);
  assert.ok(snapshots[0]!.includes("Currency: Dollar"));
  assert.ok(snapshots[0]!.includes("Show code: Off"));
  assert.ok(snapshots[0]!.includes("Caption: Hello"));
  assert.ok(snapshots[1]!.includes("Show code: Off → On"));
  assert.equal(snapshots[1]!.at(-1), "Save changes · 1");
});

test("clean Back and Advanced Back return without confirmation or raw editing", async () => {
  const questions = prompts(["$advanced", "currency", "back", "$back"], []);
  questions.confirm = async () =>
    assert.fail("Clean Back must not ask for confirmation");
  questions.editor = async () =>
    assert.fail("Advanced Back must not open JSON");
  assert.equal(
    await editConfiguration(original, questions, () => {}),
    undefined,
  );
});

test("raw editor cancellation propagates without returning a draft", async () => {
  const questions = prompts(["$advanced", "currency", "json"], []);
  const failure = new Error("Cancelled");
  failure.name = "AbortPromptError";
  questions.editor = async () => {
    throw failure;
  };
  await assert.rejects(
    editConfiguration(original, questions, () => {}),
    (error) => error === failure,
  );
  assert.deepEqual(original.configuration.intent.parameters.currency, {
    identifier: "USD",
    metadata: { title: "Dollar" },
  });
});

test("narrow editor keeps both sides of a long changed value visible", async () => {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  const description = structuredClone(original);
  description.fields = [
    {
      key: "note",
      label: "A long caption field",
      type: "string",
      present: true,
      value: "Original caption that is long",
    },
  ];
  description.configuration.intent.parameters = {
    note: "Original caption that is long",
  };
  let step = 0;
  try {
    Object.defineProperty(process.stdout, "columns", {
      value: 40,
      configurable: true,
    });
    const result = await editConfiguration(
      description,
      {
        select: async (_message, choices) => {
          if (step++ === 0) return "note" as never;
          const row = choices[0]!.name;
          assert.match(row, /Origi.*→ Updat/);
          assert.ok([...row].length <= 32);
          return choices.find((choice) =>
            choice.name.startsWith("Save changes"),
          )!.value as never;
        },
        input: async () => "Updated caption that is long",
        confirm: async () => assert.fail("saving must not ask twice"),
        editor: async () => assert.fail("normal strings do not use raw JSON"),
      },
      () => {},
    );
    assert.equal(
      result!.intent.parameters.note,
      "Updated caption that is long",
    );
  } finally {
    if (previous) Object.defineProperty(process.stdout, "columns", previous);
    else Reflect.deleteProperty(process.stdout, "columns");
  }
});
