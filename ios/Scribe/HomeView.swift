import SwiftUI
import UniformTypeIdentifiers

// Mirrors the Mac app's landing: a single "Open a paper" card plus a quieter
// "Record a meeting" entry. No wordmark, no taglines.
struct HomeView: View {
    @EnvironmentObject var store: AppStore
    @State private var showImporter = false
    @State private var showMeetingNote = false

    var body: some View {
        VStack(spacing: 12) {
            Spacer()

            Button {
                showImporter = true
            } label: {
                Text("Open a paper")
                    .font(Theme.font(19, .medium))
                    .foregroundStyle(Theme.foreground)
                    .frame(maxWidth: .infinity)
                    .frame(height: 170)
                    .background(
                        RoundedRectangle(cornerRadius: 18)
                            .stroke(style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                            .foregroundStyle(Color(red: 0.81, green: 0.81, blue: 0.81))
                    )
            }
            .buttonStyle(.plain)

            Button {
                showMeetingNote = true
            } label: {
                Text("Record a meeting")
                    .font(Theme.font(16, .medium))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Theme.rule, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)

            Spacer()
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: 480)
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.pdf]) { result in
            if case .success(let url) = result {
                store.openPaper(at: url)
            }
        }
        .alert("Meetings arrive on iPhone soon", isPresented: $showMeetingNote) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("For now, record meetings in Scribe on your Mac.")
        }
        .alert("Couldn't open PDF", isPresented: .init(
            get: { store.openError != nil },
            set: { if !$0 { store.openError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.openError ?? "")
        }
    }
}
