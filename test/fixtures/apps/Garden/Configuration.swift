import AppIntents

struct Plant: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Plant"
  static let defaultQuery = PlantQuery()
  let id: String
  let name: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
  static let choices: [Plant] = [
    Plant(id: "fern", name: "Fern"),
    Plant(id: "orchid", name: "Orchid"),
    Plant(id: "cactus", name: "Cactus")
  ]
}

struct PlantQuery: EntityStringQuery {
  @IntentParameterDependency<GardenConfiguration>(\.$gardenNote) var configuration
  private var choices: [Plant] {
    configuration?.gardenNote == "Orchids only"
      ? Plant.choices.filter { $0.id == "orchid" } : Plant.choices
  }
  func entities(for identifiers: [String]) async throws -> [Plant] {
    identifiers.compactMap { id in Plant.choices.first { $0.id == id } }
  }
  func suggestedEntities() async throws -> [Plant] { choices }
  func entities(matching string: String) async throws -> [Plant] {
    choices.filter { $0.name.localizedCaseInsensitiveContains(string) }
  }
}

enum Season: String, AppEnum {
  case spring
  case summer
  case winter
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Growing season"
  static let caseDisplayRepresentations: [Season: DisplayRepresentation] = [
    .spring: "Spring",
    .summer: "Summer",
    .winter: "Winter"
  ]
}

struct GardenConfiguration: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Pocket Garden settings"
  static let description = IntentDescription(
    "Deterministic typed configuration for widgetctl tests.")
  @Parameter(title: "Watering reminder", default: true) var showWatering: Bool
  @Parameter(title: "Garden caption", default: "Morning garden") var gardenNote: String
  @Parameter(title: "Water in liters", default: 2.5) var waterAmount: Double
  @Parameter(title: "Growing season", default: .spring) var season: Season
  @Parameter(title: "Featured plant") var featuredPlant: Plant?
  @Parameter(title: "Companion plants") var companionPlants: [Plant]?
}
