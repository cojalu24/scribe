import Foundation
import PDFKit
import NaturalLanguage

// One sentence-sized piece of the paper: what the voice reads, plus where it
// sits on the page (one rect per text line, in PDF page space).
struct Chunk: Identifiable {
    let id: Int
    let pageIndex: Int
    let text: String
    let lineRects: [CGRect]
}

// An open paper: the PDF document plus its sentence map.
final class Paper {
    let document: PDFDocument
    let title: String
    let chunks: [Chunk]

    init(document: PDFDocument, title: String) {
        self.document = document
        self.title = title
        self.chunks = Paper.extractChunks(from: document)
    }

    // Split each page's text into sentences (Apple's language-aware tokenizer)
    // and map every sentence back to its on-page line rectangles via PDFKit
    // selections.
    private static func extractChunks(from document: PDFDocument) -> [Chunk] {
        var chunks: [Chunk] = []
        let tokenizer = NLTokenizer(unit: .sentence)

        for pageIndex in 0..<document.pageCount {
            guard let page = document.page(at: pageIndex),
                  let pageText = page.string, !pageText.isEmpty else { continue }

            tokenizer.string = pageText
            tokenizer.enumerateTokens(in: pageText.startIndex..<pageText.endIndex) { range, _ in
                let raw = pageText[range]
                let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                // Skip empties and symbol-only fragments (footnote markers etc).
                guard text.count > 1,
                      text.rangeOfCharacter(from: .alphanumerics) != nil else { return true }

                let nsRange = NSRange(range, in: pageText)
                guard let selection = page.selection(for: nsRange) else { return true }

                let lineRects: [CGRect] = selection.selectionsByLine().compactMap { line in
                    let bounds = line.bounds(for: page)
                    return bounds.isEmpty ? nil : bounds
                }
                guard !lineRects.isEmpty else { return true }

                chunks.append(Chunk(
                    id: chunks.count,
                    pageIndex: pageIndex,
                    text: String(text),
                    lineRects: lineRects
                ))
                return true
            }
        }
        return chunks
    }

    // The chunk nearest to a tapped point on a page (used for tap-to-seek).
    func chunkNearest(to point: CGPoint, onPage pageIndex: Int) -> Chunk? {
        var best: Chunk?
        var bestDistance = CGFloat.greatestFiniteMagnitude
        for chunk in chunks where chunk.pageIndex == pageIndex {
            for rect in chunk.lineRects {
                if rect.contains(point) { return chunk }
                let dx = max(rect.minX - point.x, 0, point.x - rect.maxX)
                let dy = max(rect.minY - point.y, 0, point.y - rect.maxY)
                // Weight vertical distance so margin taps pick the same line.
                let d = dx * dx + dy * dy * 6
                if d < bestDistance {
                    bestDistance = d
                    best = chunk
                }
            }
        }
        return best
    }
}
