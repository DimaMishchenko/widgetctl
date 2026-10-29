import SwiftUI
import WidgetKit

@main
struct StudioApp: App {
  var body: some Scene {
    WindowGroup {
      VStack(spacing: 16) {
        Image(systemName: "pianokeys").font(.largeTitle)
        Text("Sound Studio").font(.title)
        Text("Widget configuration fixture").font(.headline)
      }
      .padding()
      .task { WidgetCenter.shared.reloadAllTimelines() }
    }
  }
}
