import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  createWidgetController,
  type WidgetConfiguration,
  type WidgetHandle,
} from "widgetctl";

const udid = process.env.SIMULATOR_UDID;
if (!udid)
  throw new Error(
    "Set SIMULATOR_UDID to your exclusively owned, booted simulator with both signed fixture apps installed and launched.",
  );
const outputRoot = path.resolve(
  process.env.VERIFICATION_OUTPUT ?? "widgetctl-verification",
);
const output = path.join(
  outputRoot,
  `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`,
);
await mkdir(output, { recursive: true, mode: 0o700 });
const execute = promisify(execFile);
const widgets = createWidgetController({ udid });
const proofs: unknown[] = [];
const failures: unknown[] = [];
let cleanupFailed = false;
const cancellation = new AbortController();
const interrupt = () => cancellation.abort(new Error("Verification cancelled"));
const checkpoint = () => cancellation.signal.throwIfAborted();
const checked = async <T>(operation: () => Promise<T>): Promise<T> => {
  checkpoint();
  const result = await operation();
  checkpoint();
  return result;
};
const cleanup = async (operation: () => Promise<unknown>) => {
  try {
    await operation();
  } catch (error) {
    cleanupFailed = true;
    failures.push(error);
  }
};
const fixtures = [
  {
    app: "garden",
    kind: "PocketGarden.Configuration",
    text: "gardenNote",
    boolean: "showWatering",
    number: "waterAmount",
    enumeration: "season",
    entity: "featuredPlant",
    entities: "companionPlants",
    search: "orch",
    title: "Orchid",
  },
  {
    app: "studio",
    kind: "SoundStudio.Configuration",
    text: "sessionTitle",
    boolean: "metronomeEnabled",
    number: "tempo",
    enumeration: "mixStyle",
    entity: "leadInstrument",
    entities: "backingInstruments",
    search: "pian",
    title: "Piano",
  },
];
process.on("SIGINT", interrupt);
try {
  console.log(`Verification evidence: ${output}`);
  await checked(() => widgets.prepare());
  const initial = await checked(() => widgets.installedWidgets());
  for (const fixture of fixtures) {
    checkpoint();
    console.log(`Checking ${fixture.kind}…`);
    const target = {
      extension: `dev.widgetctl.fixtures.${fixture.app}.widgets`,
      container: `dev.widgetctl.fixtures.${fixture.app}`,
      kind: fixture.kind,
      size: "medium" as const,
    };
    let widget: WidgetHandle;
    try {
      widget = await widgets.ensure(target, { position: "top" });
    } catch (error) {
      failures.push(error);
      await cleanup(async () => {
        const added = (await widgets.installedWidgets()).filter(
          (entry) =>
            entry.target.container === target.container &&
            entry.target.extension === target.extension &&
            entry.target.kind === target.kind &&
            entry.target.size === target.size &&
            !initial.some(
              (existing) =>
                existing.target.iconIdentifier.toUpperCase() ===
                entry.target.iconIdentifier.toUpperCase(),
            ),
        );
        if (added.length > 1)
          throw new Error(
            "Cannot identify one newly created fixture widget after ensure failed; no ambiguous identities were removed.",
          );
        if (added.length === 1)
          await (
            await widgets.getWidget(added[0]!.target.iconIdentifier)
          ).remove();
      });
      break;
    }
    let original: WidgetConfiguration | undefined;
    let current: WidgetConfiguration | undefined;
    let mutationAttempted = false;
    const stages: unknown[] = [];
    const saveStage = async (stage: string, restoring = false) => {
      const signal = restoring ? undefined : cancellation.signal;
      signal?.throwIfAborted();
      console.log(`${fixture.app}: capturing ${stage}…`);
      await delay(6000, undefined, { signal });
      const image = path.join(output, `${fixture.app}-${stage}.png`);
      await execute(
        "xcrun",
        [
          "simctl",
          "io",
          udid,
          "screenshot",
          ...(process.env.SIMULATOR_DISPLAY
            ? [`--display=${process.env.SIMULATOR_DISPLAY}`]
            : []),
          image,
        ],
        { timeout: 30000, signal },
      );
      signal?.throwIfAborted();
      const description = await widget.describeConfiguration();
      await writeFile(
        path.join(output, `${fixture.app}-${stage}.json`),
        JSON.stringify(description, null, 2),
        { mode: 0o600 },
      );
      stages.push({
        stage,
        image,
        parameters: description.configuration.intent.parameters,
      });
    };
    try {
      const description = await checked(() => widget.describeConfiguration());
      original = description.configuration;
      current = original;
      assert.ok(
        description.numberFormat,
        "Native simulator number format is required",
      );
      const separator = description.numberFormat.decimalSeparator;
      const wireNumber = (value: string) => value.replace(".", separator);
      const unrestricted = structuredClone(original);
      unrestricted.intent.parameters[fixture.text] = "All fixture choices";
      const queryOptions = {
        configuration: unrestricted,
        expected: original,
        signal: cancellation.signal,
      };
      const suggested = await widget.configurationChoices(
        fixture.entity,
        undefined,
        queryOptions,
      );
      const collection = await widget.configurationChoices(
        fixture.entities,
        undefined,
        queryOptions,
      );
      const searched = await widget.configurationChoices(
        fixture.entity,
        fixture.search,
        queryOptions,
      );
      checkpoint();
      assert.equal(suggested.length, 3);
      assert.equal(collection.length, 3);
      assert.deepEqual(
        searched.map((choice) => choice.label),
        [fixture.title],
      );
      if (fixture.app === "garden") {
        const staged = structuredClone(original);
        staged.intent.parameters[fixture.text] = "Orchids only";
        for (const key of [fixture.entity, fixture.entities]) {
          const dependent = await widget.configurationChoices(key, undefined, {
            configuration: staged,
            expected: original,
            signal: cancellation.signal,
          });
          assert.deepEqual(
            dependent.map((choice) => choice.label),
            ["Orchid"],
          );
        }
      }
      assert.deepEqual(
        (await checked(() => widget.exportConfiguration())).intent,
        original.intent,
      );
      await saveStage("before");
      const draft = structuredClone(original);
      draft.intent.parameters[fixture.text] =
        `widgetctl verified ${fixture.app}`;
      draft.intent.parameters[fixture.boolean] =
        !original.intent.parameters[fixture.boolean];
      draft.intent.parameters[fixture.number] = wireNumber("7.5");
      draft.intent.parameters[fixture.entity] = searched[0]!.value;
      draft.intent.parameters[fixture.entities] = collection
        .slice(0, 2)
        .map((choice) => choice.value);
      const enumeration = description.fields.find(
        (field) => field.key === fixture.enumeration,
      )!;
      const alternative = enumeration.choices!.find(
        (choice) =>
          choice.value !== original!.intent.parameters[fixture.enumeration],
      )!;
      draft.intent.parameters[fixture.enumeration] = alternative.value;
      checkpoint();
      mutationAttempted = true;
      current = await widget.applyConfiguration(draft, { expected: original });
      assert.deepEqual(current.intent.parameters, draft.intent.parameters);
      await saveStage("edited");
      const stale = structuredClone(current);
      stale.intent.parameters = structuredClone(original.intent.parameters);
      await assert.rejects(
        widget.applyConfiguration(stale, { expected: stale }),
        /changed since editing began/i,
      );
      assert.deepEqual(
        (await checked(() => widget.exportConfiguration())).intent,
        current.intent,
      );
      for (const count of [0, 1, 2]) {
        checkpoint();
        const next: WidgetConfiguration = structuredClone(current!);
        next.intent.parameters[fixture.entities] = collection
          .slice(0, count)
          .map((choice) => choice.value);
        next.intent.parameters[fixture.number] = wireNumber(
          ["0.1", "13.5", "14.5"][count]!,
        );
        current = await widget.applyConfiguration(next, { expected: current });
        assert.deepEqual(current.intent.parameters, next.intent.parameters);
        const described = await widget.describeConfiguration();
        assert.equal(
          described.fields.find((field) => field.key === fixture.entities)!
            .type,
          "entities",
        );
        assert.equal(
          described.fields.find((field) => field.key === fixture.number)!.type,
          "number",
        );
        await saveStage(`${count}-entities`);
      }
    } catch (error) {
      failures.push(error);
    } finally {
      if (original && mutationAttempted) {
        const baseline = original;
        await cleanup(async () => {
          const latest = await widget.exportConfiguration();
          const restored = structuredClone(latest);
          restored.intent.parameters = baseline.intent.parameters;
          current = await widget.applyConfiguration(restored, {
            expected: latest,
          });
          assert.deepEqual(current.intent, baseline.intent);
          await saveStage("restored", true);
        });
      }
      if (
        !initial.some(
          (entry) =>
            entry.target.iconIdentifier.toUpperCase() ===
            widget.iconIdentifier.toUpperCase(),
        )
      )
        await cleanup(() => widget.remove());
    }
    proofs.push({ app: fixture.app, stages });
    if (failures.length) break;
  }
} catch (error) {
  failures.push(error);
} finally {
  console.log("Releasing the widget helper…");
  await cleanup(() => widgets.release());
  process.removeListener("SIGINT", interrupt);
}
if (
  cancellation.signal.aborted &&
  !failures.includes(cancellation.signal.reason)
)
  failures.push(cancellation.signal.reason);
await writeFile(
  path.join(output, failures.length ? "failure.json" : "proof.json"),
  JSON.stringify(
    {
      udid,
      status: failures.length ? "failed" : "passed",
      assertions: failures.length
        ? "Verification or cleanup failed; captured stages are incomplete evidence."
        : "Canonical values, query results, dependencies, cardinality, stale edits and cleanup passed. Inspect PNGs to establish rendered outcomes.",
      errors: failures.map((error) =>
        error instanceof Error ? error.message : String(error),
      ),
      proofs,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
if (failures.length) {
  process.exitCode = cancellation.signal.aborted && !cleanupFailed ? 130 : 1;
  console.error(
    new AggregateError(
      failures,
      `Fixture verification failed. Evidence: ${output}`,
    ),
  );
} else
  console.log(
    `Fixture assertions passed. Inspect before/edited/restored captures in ${output}.`,
  );
