#!/usr/bin/env bash
set -euo pipefail

: "${SIMULATOR_UDID:?Set the explicitly owned booted simulator UDID}"
: "${CONFIGURATION_FILE:?Set an output file for the complete configuration}"

device=(--device "$SIMULATOR_UDID" --json)
icon="${WIDGET_ICON:-}"
if [[ -z "$icon" ]]; then
  : "${WIDGET_EXTENSION:?Set the installed widget extension bundle identifier}"
  : "${WIDGET_KIND:?Set the catalog widget kind}"
  : "${WIDGET_SIZE:?Set a catalog-supported size}"
  target=(--extension "$WIDGET_EXTENSION" --kind "$WIDGET_KIND" --size "$WIDGET_SIZE")
  if [[ -n "${WIDGET_CONTAINER:-}" ]]; then target+=(--app "$WIDGET_CONTAINER"); fi
  added="$(npx widgetctl add "${device[@]}" "${target[@]}")"
  printf '%s\n' "$added"
  icon="$(node -e 'const result = JSON.parse(process.argv[1]); if (typeof result.iconIdentifier !== "string" || !result.iconIdentifier) process.exit(1); process.stdout.write(result.iconIdentifier)' "$added")"
fi
npx widgetctl export "${device[@]}" --widget "$icon" --file "$CONFIGURATION_FILE"
npx widgetctl configure "${device[@]}" --widget "$icon" --file "$CONFIGURATION_FILE"
