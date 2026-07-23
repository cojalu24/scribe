import SwiftUI

// The reading screen, mirroring the Mac app: paper on the soft backdrop,
// hairline-bordered rounded controls in a white bottom bar, Exit set apart
// on the right in muted red.
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

            controls
        }
        .background(Theme.backdrop)
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
        HStack(spacing: 8) {
            BarButton(
                label: reader.isPlaying ? "Pause" : "Read aloud",
                busy: reader.isBuffering
            ) {
                reader.toggle()
            }

            BarIconButton(system: "chevron.left") { reader.step(-1) }
            BarIconButton(system: "chevron.right") { reader.step(1) }

            Spacer(minLength: 12)

            BarButton(label: "Exit", style: .exit) {
                store.closePaper()
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(.white)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.rule).frame(height: 1)
        }
    }
}

// Mac-style bar button: hairline border, 11pt radius, Space Grotesk.
struct BarButton: View {
    enum Style { case normal, exit }
    var label: String
    var busy: Bool = false
    var style: Style = .normal
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if busy {
                    ProgressView()
                        .controlSize(.small)
                        .tint(Theme.muted)
                }
                Text(label)
                    .font(Theme.font(15, .medium))
            }
            .foregroundStyle(style == .exit ? Color(red: 0.69, green: 0.34, blue: 0.31) : Theme.foreground)
            .padding(.horizontal, 16)
            .frame(height: 42)
            .background(
                RoundedRectangle(cornerRadius: 11)
                    .stroke(
                        style == .exit
                            ? Color(red: 0.91, green: 0.82, blue: 0.81)
                            : Color(red: 0.84, green: 0.84, blue: 0.84),
                        lineWidth: 1
                    )
                    .background(RoundedRectangle(cornerRadius: 11).fill(.white))
            )
        }
        .buttonStyle(.plain)
    }
}

struct BarIconButton: View {
    var system: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .frame(width: 42, height: 42)
                .background(
                    RoundedRectangle(cornerRadius: 11)
                        .stroke(Color(red: 0.84, green: 0.84, blue: 0.84), lineWidth: 1)
                        .background(RoundedRectangle(cornerRadius: 11).fill(.white))
                )
        }
        .buttonStyle(.plain)
    }
}
