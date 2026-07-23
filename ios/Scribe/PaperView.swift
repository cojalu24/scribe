import SwiftUI

// The reading screen: the paper with its moving highlight, and a bottom bar
// in the Mac app's vocabulary — Read aloud, Exit on the right.
struct PaperView: View {
    @EnvironmentObject var store: AppStore
    @StateObject private var reader = Reader()
    let paper: Paper

    var body: some View {
        VStack(spacing: 0) {
            PdfContainerView(
                paper: paper,
                activeIndex: reader.currentIndex,
                playing: reader.isPlaying,
                onSeek: { reader.seek(to: $0) }
            )
            .ignoresSafeArea(edges: .top)

            controls
        }
        .onAppear {
            reader.load(chunks: paper.chunks)
        }
        .onDisappear {
            reader.stopPlayback()
        }
        .alert("Voice problem", isPresented: .init(
            get: { reader.loadError != nil },
            set: { if !$0 { reader.loadError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(reader.loadError ?? "")
        }
    }

    private var controls: some View {
        HStack(spacing: 10) {
            Button {
                reader.toggle()
            } label: {
                Text(reader.isBuffering ? "…" : reader.isPlaying ? "Pause" : "Read aloud")
                    .font(Theme.font(15, .medium))
                    .foregroundStyle(Theme.foreground)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 11)
                            .stroke(Color(red: 0.84, green: 0.84, blue: 0.84), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)

            // Step between sentences (the arrow keys of the phone).
            Button { reader.step(-1) } label: { stepLabel("chevron.left") }
                .buttonStyle(.plain)
            Button { reader.step(1) } label: { stepLabel("chevron.right") }
                .buttonStyle(.plain)

            Spacer()

            Button {
                store.closePaper()
            } label: {
                Text("Exit")
                    .font(Theme.font(15, .medium))
                    .foregroundStyle(Color(red: 0.69, green: 0.34, blue: 0.31))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 11)
                            .stroke(Color(red: 0.91, green: 0.82, blue: 0.81), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.white)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.rule).frame(height: 1)
        }
    }

    private func stepLabel(_ system: String) -> some View {
        Image(systemName: system)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Theme.muted)
            .frame(width: 38, height: 38)
            .background(
                RoundedRectangle(cornerRadius: 11)
                    .stroke(Color(red: 0.84, green: 0.84, blue: 0.84), lineWidth: 1)
            )
    }
}
