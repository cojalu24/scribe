import SwiftUI
import PDFKit

// Wraps PDFKit's page view: renders the real paper, paints the moving
// sentence highlight (yellow while reading, grey when paused), scrolls to
// follow it, and reports taps for tap-to-seek.
struct PdfContainerView: UIViewRepresentable {
    let paper: Paper
    let activeIndex: Int
    let playing: Bool
    let onSeek: (Int) -> Void

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.document = paper.document
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.autoScales = true
        view.pageShadowsEnabled = false
        view.backgroundColor = UIColor(Theme.backdrop)

        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.handleTap(_:)))
        tap.delegate = context.coordinator
        view.addGestureRecognizer(tap)
        context.coordinator.pdfView = view
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.highlight(chunkIndex: activeIndex, playing: playing)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: PdfContainerView
        weak var pdfView: PDFView?
        private var annotations: [(PDFPage, PDFAnnotation)] = []
        private var lastPainted: (index: Int, playing: Bool)?

        init(parent: PdfContainerView) {
            self.parent = parent
        }

        func highlight(chunkIndex: Int, playing: Bool) {
            guard lastPainted?.index != chunkIndex || lastPainted?.playing != playing else { return }
            lastPainted = (chunkIndex, playing)

            for (page, annotation) in annotations {
                page.removeAnnotation(annotation)
            }
            annotations.removeAll()

            guard let pdfView,
                  chunkIndex < parent.paper.chunks.count else { return }
            let chunk = parent.paper.chunks[chunkIndex]
            guard let page = parent.paper.document.page(at: chunk.pageIndex) else { return }

            let color = playing
                ? UIColor(Theme.highlightPlaying).withAlphaComponent(0.45)
                : UIColor.black.withAlphaComponent(0.10)

            for rect in chunk.lineRects {
                let annotation = PDFAnnotation(bounds: rect.insetBy(dx: -1.5, dy: -1.5),
                                               forType: .highlight,
                                               withProperties: nil)
                annotation.color = color
                page.addAnnotation(annotation)
                annotations.append((page, annotation))
            }

            // Keep the active sentence in view.
            if let first = chunk.lineRects.first {
                pdfView.go(to: first.insetBy(dx: 0, dy: -120), on: page)
            }
        }

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let pdfView else { return }
            let location = gesture.location(in: pdfView)
            guard let page = pdfView.page(for: location, nearest: true),
                  let pageIndex = parent.paper.document.index(for: page) as Int? else { return }
            let pagePoint = pdfView.convert(location, to: page)
            if let chunk = parent.paper.chunkNearest(to: pagePoint, onPage: pageIndex) {
                parent.onSeek(chunk.id)
            }
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }
    }
}
