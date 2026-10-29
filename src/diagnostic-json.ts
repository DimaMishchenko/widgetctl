export function diagnosticJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? { $bigint: item.toString() } : item,
  );
}
