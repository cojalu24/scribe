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
                    // Deterministic test path (any config): launching with
                    // SIMCTL_CHILD_SCRIBE_SAMPLE=1 opens the bundled sample
                    // paper. Only settable from a dev machine via simctl.
                    if ProcessInfo.processInfo.environment["SCRIBE_SAMPLE"] == "1",
                       let url = Bundle.main.url(forResource: "sample", withExtension: "pdf") {
                        store.openPaper(at: url)
                    }
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
