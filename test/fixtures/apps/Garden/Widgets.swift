import AppIntents
import SwiftUI
import WidgetKit

struct GardenEntry: TimelineEntry {
  let date: Date
  let configuration: GardenConfiguration
}

struct GardenProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> GardenEntry {
    GardenEntry(date: .now, configuration: GardenConfiguration())
  }
  func snapshot(for configuration: GardenConfiguration, in context: Context) async -> GardenEntry {
    GardenEntry(date: .now, configuration: configuration)
  }
  func timeline(
    for configuration: GardenConfiguration, in context: Context
  ) async -> Timeline<GardenEntry> {
    Timeline(entries: [GardenEntry(date: .now, configuration: configuration)], policy: .never)
  }
}

struct GardenWidgetView: View {
  let entry: GardenEntry
  var body: some View {
    let configuration = entry.configuration
    VStack(alignment: .leading, spacing: 3) {
      Text("Pocket Garden").font(.headline)
      Text(configuration.gardenNote).font(.subheadline)
      Text("Watering reminder: \(configuration.showWatering ? "On" : "Off")")
      Text("Water in liters: \(configuration.waterAmount, specifier: "%.1f")")
      Text("Growing season: \(configuration.season.rawValue)")
      Text("Lead: \(configuration.featuredPlant?.name ?? "None")")
      Text("Group: \((configuration.companionPlants ?? []).map(\.name).joined(separator: ", "))")
    }
    .font(.caption2)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .containerBackground(.green.opacity(0.15), for: .widget)
  }
}

struct GardenWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "PocketGarden.Configuration", intent: GardenConfiguration.self,
      provider: GardenProvider()
    ) { entry in
      GardenWidgetView(entry: entry)
    }
    .configurationDisplayName("Pocket Garden Controls")
    .description("Displays every configured field.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct GardenStaticProvider: TimelineProvider {
  func placeholder(in context: Context) -> SimpleEntry { SimpleEntry(date: .now) }
  func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> Void) {
    completion(SimpleEntry(date: .now))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<SimpleEntry>) -> Void) {
    completion(Timeline(entries: [SimpleEntry(date: .now)], policy: .never))
  }
}

struct SimpleEntry: TimelineEntry { let date: Date }

struct GardenStaticWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "PocketGarden.Static", provider: GardenStaticProvider()) { _ in
      Text("Garden static fixture")
        .containerBackground(.green.opacity(0.15), for: .widget)
    }
    .configurationDisplayName("Garden Static")
    .description("A widget without configurable fields.")
    .supportedFamilies([.systemSmall])
  }
}

@main
struct GardenWidgets: WidgetBundle {
  var body: some Widget {
    GardenWidget()
    GardenStaticWidget()
  }
}
