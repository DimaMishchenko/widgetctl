import { stripVTControlCharacters } from "node:util";
import type { JsonValue } from "./controller.js";

const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const width = (text: string) =>
  [...segments.segment(text)].reduce(
    (count, { segment }) =>
      count +
      (/\p{Extended_Pictographic}|[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(
        segment,
      )
        ? 2
        : 1),
    0,
  );
export function compactText(text: string, limit = 60): string {
  const clean = stripVTControlCharacters(text)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (width(clean) <= limit) return clean;
  let result = "";
  for (const { segment } of segments.segment(clean)) {
    if (width(result + segment) > Math.max(0, limit - 1)) break;
    result += segment;
  }
  return limit > 0 ? `${result}…` : "";
}
export function compactValue(
  value: JsonValue | undefined,
  choices?: { label: string; value: JsonValue }[],
  limit = 40,
): string {
  if (value === undefined) return "Not set";
  if (value === null) return "None";
  const choice = choices?.find(
    (choice) => JSON.stringify(choice.value) === JSON.stringify(value),
  );
  if (choice) return compactText(choice.label, limit);
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string") return compactText(value, limit) || "Empty";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value))
    return value.length
      ? compactText(
          value.map((item) => compactValue(item, choices)).join(", "),
          limit,
        )
      : "None selected";
  const metadata = value.metadata;
  if (
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    typeof metadata.title === "string"
  )
    return compactText(metadata.title, limit);
  return "Custom value";
}
export function uniqueNames(
  entries: { name: string; id: string; detail?: string }[],
): string[] {
  const limit = Math.max(12, (process.stdout.columns || 80) - 8);
  const names = entries.map((entry) => compactText(entry.name, limit));
  const duplicated = (items: string[], index: number) =>
    items.some((name, other) => other !== index && name === items[index]);
  const detailed = names.map((name, index) => {
    const detail = entries[index]!.detail
      ? compactText(entries[index]!.detail!, Math.max(4, Math.floor(limit / 2)))
      : undefined;
    return duplicated(names, index) && detail
      ? `${compactText(name, Math.max(1, limit - width(detail) - 3))} · ${detail}`
      : name;
  });
  const results = detailed.map((name, index) => {
    if (!duplicated(detailed, index)) return name;
    const id = compactText(entries[index]!.id, 200).slice(-6);
    const suffix = entries.some(
      (entry, other) =>
        other !== index &&
        detailed[other] === name &&
        compactText(entry.id, 200).slice(-6) === id,
    )
      ? String(index + 1)
      : id;
    return `${compactText(name, Math.max(1, limit - width(suffix) - 3))} · ${suffix}`;
  });
  return new Set(results).size === results.length
    ? results
    : results.map((name, index) => {
        const suffix = `#${index + 1}`;
        return `${compactText(name, Math.max(1, limit - suffix.length - 3))} · ${suffix}`;
      });
}
export const mark = (emoji: string, fallback: string): string =>
  process.env.WIDGETCTL_NO_EMOJI === "1" || process.env.TERM === "dumb"
    ? fallback
    : emoji;
export const titleCase = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);
