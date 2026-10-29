# Widget fixtures

Build with Xcode and xcbeautify installed:

```sh
test/fixtures/apps/build.sh
```

The script builds the checked-in project, disables Xcode signing, applies local ad hoc bundle signatures without a team, and writes only to `.local/fixture-apps` (override with `WIDGETCTL_FIXTURE_OUTPUT`). Deployment target is iOS 18.5. No simulator is booted or modified. Install and launch the apps on an explicitly owned simulator before querying widget descriptors.

App products are under `.local/fixture-apps/DerivedData/Build/Products/Debug-iphonesimulator/`.

| App                        | Bundle ID                     | Widget kind                | Home families |
| -------------------------- | ----------------------------- | -------------------------- | ------------- |
| Garden.app / Pocket Garden | dev.widgetctl.fixtures.garden | PocketGarden.Configuration | small, medium |
| Garden.app / Pocket Garden | dev.widgetctl.fixtures.garden | PocketGarden.Static        | small         |
| Studio.app / Sound Studio  | dev.widgetctl.fixtures.studio | SoundStudio.Configuration  | medium, large |

Each configurable widget renders every field. Use medium or large for complete screenshot assertions. The static widget intentionally has no configuration intent. Entity queries return deterministic suggested choices and case-insensitive substring search without network access. Setting the Garden caption to `Orchids only` narrows both plant pickers to Orchid, exercising queries against staged dependent parameters.

| Type            | Garden parameter / title           | Studio parameter / title                 |
| --------------- | ---------------------------------- | ---------------------------------------- |
| Bool            | showWatering / Watering reminder   | metronomeEnabled / Metronome active      |
| String          | gardenNote / Garden caption        | sessionTitle / Recording title           |
| Double          | waterAmount / Water in liters      | tempo / Tempo in BPM                     |
| AppEnum         | season / Growing season            | mixStyle / Mix character                 |
| AppEntity       | featuredPlant / Featured plant     | leadInstrument / Lead instrument         |
| AppEntity array | companionPlants / Companion plants | backingInstruments / Backing instruments |

Garden enum IDs are `spring`, `summer`, `winter`; plant IDs are `fern`, `orchid`, `cactus`. Studio enum IDs are `acoustic`, `electronic`, `ambient`; instrument IDs are `piano`, `guitar`, `drums`.

Compiler-generated parameter metadata is in each product at `PlugIns/GardenWidgets.appex/Metadata.appintents/extract.actionsdata` or `PlugIns/StudioWidgets.appex/Metadata.appintents/extract.actionsdata`. The adjacent `version.json` describes the metadata format. After target membership changes, regenerate the checked-in project with `xcodegen generate --spec test/fixtures/apps/project.yml --project test/fixtures/apps`.

Explicit ad hoc signatures bind each extension’s bundle identifier and Info.plist. Linker-only signatures produced by `CODE_SIGNING_ALLOWED=NO` leave widgets showing placeholders on the tested runtimes. Each app requests its own widget timeline reload when launched.

Install and launch both apps on your owned, booted simulator:

```sh
udid='YOUR_OWNED_BOOTED_SIMULATOR_UUID'
products="$PWD/.local/fixture-apps/DerivedData/Build/Products/Debug-iphonesimulator"
xcrun simctl install "$udid" "$products/Garden.app"
xcrun simctl install "$udid" "$products/Studio.app"
xcrun simctl launch "$udid" dev.widgetctl.fixtures.garden
xcrun simctl launch "$udid" dev.widgetctl.fixtures.studio
```

Run the shipped acceptance example from the repository root:

```sh
SIMULATOR_UDID="$udid" VERIFICATION_OUTPUT="$PWD/.local/fixture-verification" \
  node --import tsx examples/verify-fixtures.ts
```

Use a simulator you exclusively own. The example restores existing fixture configurations, removes only newly created widgets, releases its helper in `finally`, and writes PNGs plus JSON evidence. Inspect the captures to confirm rendered outcomes. Garden’s caption `Orchids only` deliberately narrows both entity queries so staged dependency behavior is testable.
