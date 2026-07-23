import SwiftUI
import PDFKit

@main
struct ScribeApp: App {
    @StateObject private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                // "Open in Scribe" from Files / Mail / Safari.
                .onOpenURL { url in
                    store.openPaper(at: url)
                }
                .onAppear {
                    #if DEBUG
                    // Deterministic test path: SIMCTL_CHILD_SCRIBE_SAMPLE=1
                    // makes the app open its bundled sample paper on launch.
                    if ProcessInfo.processInfo.environment["SCRIBE_SAMPLE"] == "1",
                       let url = Bundle.main.url(forResource: "sample", withExtension: "pdf") {
                        store.openPaper(at: url)
                    }
                    #endif
                }
        }
    }
}

// Top-level app state: which screen we're on and the currently open paper.
@MainActor
final class AppStore: ObservableObject {
    @Published var paper: Paper?
    @Published var openError: String?

    func openPaper(at url: URL) {
        let secured = url.startAccessingSecurityScopedResource()
        defer { if secured { url.stopAccessingSecurityScopedResource() } }
        guard let document = PDFDocument(url: url) else {
            openError = "Couldn't open that PDF."
            return
        }
        paper = Paper(document: document, title: url.deletingPathExtension().lastPathComponent)
    }

    func closePaper() {
        paper = nil
    }
}

struct RootView: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        if let paper = store.paper {
            PaperView(paper: paper)
        } else {
            HomeView()
        }
    }
}
