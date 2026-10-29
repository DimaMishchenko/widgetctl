#!/bin/bash
set -euo pipefail
fixture_root="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$fixture_root/../../.." && pwd)"
output_root="${WIDGETCTL_FIXTURE_OUTPUT:-$repo_root/.local/fixture-apps}"
mkdir -p "$output_root"
xcodebuild -project "$fixture_root/WidgetctlFixtures.xcodeproj" -scheme Fixtures \
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$output_root/DerivedData" CODE_SIGNING_ALLOWED=NO build 2>&1 | \
  tee "$output_root/build.log" | xcbeautify
for fixture_name in Garden Studio; do
  app_path="$output_root/DerivedData/Build/Products/Debug-iphonesimulator/$fixture_name.app"
  codesign --force --sign - "$app_path/PlugIns/${fixture_name}Widgets.appex"
  codesign --force --sign - "$app_path"
done
printf '%s\n' "$output_root/DerivedData/Build/Products/Debug-iphonesimulator/Garden.app" \
  "$output_root/DerivedData/Build/Products/Debug-iphonesimulator/Studio.app"
