import AppIntents
import SwiftUI
import WidgetKit

struct StudioEntry: TimelineEntry {
  let date: Date
  let configuration: StudioConfiguration
}

struct StudioProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> StudioEntry {
    StudioEntry(date: .now, configuration: StudioConfiguration())
  }
  func snapshot(for configuration: StudioConfiguration, in context: Context) async -> StudioEntry {
    StudioEntry(date: .now, configuration: configuration)
  }
  func timeline(
    for configuration: StudioConfiguration, in context: Context
  ) async -> Timeline<StudioEntry> {
    Timeline(entries: [StudioEntry(date: .now, configuration: configuration)], policy: .never)
  }
}

struct StudioWidgetView: View {
  let entry: StudioEntry
  var body: some View {
    let configuration = entry.configuration
    VStack(alignment: .leading, spacing: 3) {
      Text("Sound Studio").font(.headline)
      Text(configuration.sessionTitle).font(.subheadline)
      Text("Metronome active: \(configuration.metronomeEnabled ? "On" : "Off")")
      Text("Tempo in BPM: \(configuration.tempo, specifier: "%.1f")")
      Text("Mix character: \(configuration.mixStyle.rawValue)")
      Text("Lead: \(configuration.leadInstrument?.name ?? "None")")
      Text("Group: \((configuration.backingInstruments ?? []).map(\.name).joined(separator: ", "))")
    }
    .font(.caption2)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .containerBackground(.indigo.opacity(0.15), for: .widget)
  }
}

struct StudioWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "SoundStudio.Configuration", intent: StudioConfiguration.self,
      provider: StudioProvider()
    ) { entry in
      StudioWidgetView(entry: entry)
    }
    .configurationDisplayName("Sound Studio Controls")
    .description("Displays every configured field.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}

@main
struct StudioWidgets: WidgetBundle {
  var body: some Widget {
    StudioWidget()
  }
}
