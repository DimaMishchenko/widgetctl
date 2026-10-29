import AppIntents

struct Instrument: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Instrument"
  static let defaultQuery = InstrumentQuery()
  let id: String
  let name: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
  static let choices: [Instrument] = [
    Instrument(id: "piano", name: "Piano"),
    Instrument(id: "guitar", name: "Guitar"),
    Instrument(id: "drums", name: "Drums")
  ]
}

struct InstrumentQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [Instrument] {
    identifiers.compactMap { id in Instrument.choices.first { $0.id == id } }
  }
  func suggestedEntities() async throws -> [Instrument] { Instrument.choices }
  func entities(matching string: String) async throws -> [Instrument] {
    Instrument.choices.filter { $0.name.localizedCaseInsensitiveContains(string) }
  }
}

enum MixStyle: String, AppEnum {
  case acoustic
  case electronic
  case ambient
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Mix character"
  static let caseDisplayRepresentations: [MixStyle: DisplayRepresentation] = [
    .acoustic: "Acoustic",
    .electronic: "Electronic",
    .ambient: "Ambient"
  ]
}

struct StudioConfiguration: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Sound Studio settings"
  static let description = IntentDescription(
    "Deterministic typed configuration for widgetctl tests.")
  @Parameter(title: "Metronome active", default: false) var metronomeEnabled: Bool
  @Parameter(title: "Recording title", default: "Evening session") var sessionTitle: String
  @Parameter(title: "Tempo in BPM", default: 96.0) var tempo: Double
  @Parameter(title: "Mix character", default: .acoustic) var mixStyle: MixStyle
  @Parameter(title: "Lead instrument") var leadInstrument: Instrument?
  @Parameter(title: "Backing instruments") var backingInstruments: [Instrument]?
}
