import { test } from "node:test";
import assert from "node:assert/strict";
import { compactText, compactValue, uniqueNames, mark } from "../src/human.js";

test("human values summarize canonical data without exposing object internals", () => {
  const entity = {
    identifier: "secret-id",
    metadata: { title: "Boston Fern", extra: "preserve" },
  };
  assert.equal(compactValue(entity), "Boston Fern");
  assert.equal(
    compactValue(entity, [{ value: entity, label: "Fern" }]),
    "Fern",
  );
  assert.equal(compactValue([entity]), "Boston Fern");
  assert.equal(compactValue({ identifier: "unknown" }), "Custom value");
  assert.equal(compactValue(true), "On");
  assert.equal(compactValue(false), "Off");
  assert.equal(compactValue(null), "None");
  assert.equal(compactValue(undefined), "Not set");
  assert.equal(compactValue(""), "Empty");
  assert.equal(entity.metadata.extra, "preserve");
});

test("human previews sanitize controls and truncate complete graphemes", () => {
  assert.equal(compactText("\x1b[31mFern\x1b[0m\n\u202ePlant"), "Fern Plant");
  assert.equal(compactText("🌿🌿🌿", 5), "🌿🌿…");
  assert.equal(compactText("家家家", 5), "家家…");
  assert.equal(compactText("a\u0301b\u0301c\u0301", 2), "a\u0301…");
});

test("duplicate names prefer positions and retain distinguishable identities when truncated", () => {
  const positions = uniqueNames([
    { name: "Garden", id: "a", detail: "Page 1" },
    { name: "Garden", id: "b", detail: "Page 2" },
  ]);
  assert.deepEqual(positions, ["Garden · Page 1", "Garden · Page 2"]);
  assert.deepEqual(uniqueNames([{ name: "Garden", id: "a" }]), ["Garden"]);
  const names = uniqueNames([
    { name: "A".repeat(200), id: "00000000-0000-0000-0000-111111111111" },
    { name: "A".repeat(200), id: "10000000-0000-0000-0000-111111111111" },
  ]);
  assert.equal(new Set(names).size, 2);
  assert.ok(names.every((name) => [...name].length <= 72));
});

test("emoji fallback is readable text", () => {
  const previous = process.env.WIDGETCTL_NO_EMOJI;
  try {
    process.env.WIDGETCTL_NO_EMOJI = "1";
    assert.equal(mark("📱", "Device"), "Device");
  } finally {
    if (previous === undefined) delete process.env.WIDGETCTL_NO_EMOJI;
    else process.env.WIDGETCTL_NO_EMOJI = previous;
  }
});

test("long extension details cannot hide collision disambiguation in narrow terminals", () => {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  try {
    Object.defineProperty(process.stdout, "columns", {
      value: 40,
      configurable: true,
    });
    const names = uniqueNames([
      {
        name: "Weather",
        id: "forecastA",
        detail: "com.example.weather.widgets.forecastA",
      },
      {
        name: "Weather",
        id: "forecastB",
        detail: "com.example.weather.widgets.forecastB",
      },
    ]);
    assert.equal(new Set(names).size, 2);
    assert.ok(names.every((name) => [...name].length <= 32));
  } finally {
    if (previous) Object.defineProperty(process.stdout, "columns", previous);
    else Reflect.deleteProperty(process.stdout, "columns");
  }
});

test("generated suffixes cannot collide with naturally occurring names", () => {
  const labels = uniqueNames([
    { name: "Garden", id: "a" },
    { name: "Garden", id: "b" },
    { name: "Garden · a", id: "c" },
  ]);
  assert.equal(new Set(labels).size, 3);
});
