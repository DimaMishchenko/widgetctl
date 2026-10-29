import SwiftUI
import WidgetKit

@main
struct GardenApp: App {
  var body: some Scene {
    WindowGroup {
      VStack(spacing: 16) {
        Image(systemName: "leaf").font(.largeTitle)
        Text("Pocket Garden").font(.title)
        Text("Widget configuration fixture").font(.headline)
      }
      .padding()
      .task { WidgetCenter.shared.reloadAllTimelines() }
    }
  }
}
