import {
  PDFArray,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  StandardFonts,
  rgb,
} from 'pdf-lib'
import type { Capture, PaperMeta } from '../types'
import type { TextChunk } from './pdf'

const AUTHOR = 'Colby'
// Soft yellow, translucent — close to a real marker, doesn't drown the text.
const HIGHLIGHT_COLOR = [1, 0.92, 0.55] as const
const HIGHLIGHT_OPACITY = 0.35

// Writes the user's voice notes back INTO the original PDF as standard
// highlight annotations (Zotero/Acrobat/Preview-style): the anchored passage
// gets a soft highlight with the note attached as its comment, and a
// "Reading notes" summary page is appended listing every quote + note.
export async function buildAnnotatedPdf(
  originalBytes: Uint8Array,
  chunks: TextChunk[],
  captures: Capture[],
  meta?: PaperMeta,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true })
  const notes = captures.filter((c) => c.status === 'done' && c.transcript)

  // Several notes can anchor to the same passage. Merge them into ONE
  // highlight whose comment lists every note — stacked identical highlights
  // hide all but the topmost comment in most PDF viewers.
  const byChunk = new Map<number, Capture[]>()
  for (const cap of notes) {
    const group = byChunk.get(cap.anchorChunk)
    if (group) group.push(cap)
    else byChunk.set(cap.anchorChunk, [cap])
  }
  // Reading order.
  const groups = [...byChunk.entries()].sort((a, b) => a[0] - b[0])

  for (const [anchorChunk] of groups) {
    const chunk = chunks[anchorChunk]
    if (!chunk || chunk.rects.length === 0) continue
    const pageIdx = chunk.page - 1
    if (pageIdx < 0 || pageIdx >= doc.getPageCount()) continue
    const page = doc.getPage(pageIdx)
    const crop = page.getCropBox()

    // Our rects are in scale-1 page units with a top-left origin; PDF
    // annotations use absolute user space with a bottom-left origin.
    const quads: number[] = []
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const r of chunk.rects) {
      const pad = 1
      const x0 = crop.x + r.x - pad
      const x1 = crop.x + r.x + r.w + pad
      const yTop = crop.y + crop.height - r.y + pad
      const yBot = yTop - r.h - 2 * pad
      quads.push(x0, yTop, x1, yTop, x0, yBot, x1, yBot)
      minX = Math.min(minX, x0)
      maxX = Math.max(maxX, x1)
      minY = Math.min(minY, yBot)
      maxY = Math.max(maxY, yTop)
    }

    // Plain highlight only — no attached comment. The passage is marked as
    // "cared about"; the quotes and notes live on the summary page at the end.
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quads,
      C: HIGHLIGHT_COLOR,
      CA: HIGHLIGHT_OPACITY,
      F: 4, // print flag
      T: PDFHexString.fromText(AUTHOR),
    })
    const ref = doc.context.register(annot)

    const existing = page.node.lookup(PDFName.of('Annots'))
    if (existing instanceof PDFArray) existing.push(ref)
    else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
  }

  if (groups.length > 0) {
    await appendSummaryPages(doc, chunks, groups, meta)
  }

  return await doc.save()
}

// ---------- Summary page ----------

// The standard PDF fonts only cover Latin-1; swap the common typographic
// characters and drop anything else so drawText never throws.
function sanitize(s: string): string {
  return s
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, '-')
    .replace(/—/g, '--')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')
    .replace(/[ \t]+/g, ' ')
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

async function appendSummaryPages(
  doc: PDFDocument,
  chunks: TextChunk[],
  groups: [number, Capture[]][],
  meta?: PaperMeta,
) {
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const { width: pw, height: ph } = doc.getPage(0).getSize()
  const margin = 56
  const maxW = pw - margin * 2
  const gray = rgb(0.42, 0.42, 0.42)
  const black = rgb(0.07, 0.07, 0.07)

  let page = doc.addPage([pw, ph])
  let y = ph - margin

  const newPageIfNeeded = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([pw, ph])
      y = ph - margin
    }
  }

  // Header
  page.drawText('Reading notes', { x: margin, y: y - 16, size: 16, font: bold, color: black })
  y -= 24
  if (meta?.title) {
    for (const line of wrap(sanitize(meta.title), regular, 10.5, maxW)) {
      page.drawText(line, { x: margin, y: y - 12, size: 10.5, font: regular, color: gray })
      y -= 14
    }
  }
  y -= 14

  for (const [anchorChunk, group] of groups) {
    const chunk = chunks[anchorChunk]
    if (!chunk) continue

    const quoteLines = wrap(`"${sanitize(chunk.text)}"`, italic, 9.5, maxW - 14)
    const noteBlocks = group.map((c) => wrap(sanitize(c.transcript), regular, 10.5, maxW - 14))
    const blockHeight =
      quoteLines.length * 12 + noteBlocks.reduce((s, b) => s + b.length * 13 + 4, 0) + 26

    newPageIfNeeded(Math.min(blockHeight, ph - margin * 2))

    page.drawText(`p. ${chunk.page}`, { x: margin, y: y - 10, size: 9, font: bold, color: gray })
    y -= 14
    for (const line of quoteLines) {
      newPageIfNeeded(12)
      page.drawText(line, { x: margin + 14, y: y - 10, size: 9.5, font: italic, color: gray })
      y -= 12
    }
    y -= 4
    for (const block of noteBlocks) {
      for (const line of block) {
        newPageIfNeeded(13)
        page.drawText(line, { x: margin + 14, y: y - 11, size: 10.5, font: regular, color: black })
        y -= 13
      }
      y -= 4
    }
    y -= 12
  }
}
