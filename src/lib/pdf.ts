// The "legacy" build supports older Safari (the modern build needs features
// Safari only added recently and fails with cryptic errors there).
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PaperMeta } from '../types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// A rectangle on a PDF page, in scale-1 page units with a top-left origin —
// used to paint the "currently being read" highlight over the real page.
export interface ChunkRect {
  page: number
  x: number
  y: number
  w: number
  h: number
}

// A sentence-sized piece of the paper: the text we send to the voice, plus
// where it physically sits on the page.
export interface TextChunk {
  index: number
  text: string
  page: number
  rects: ChunkRect[]
}

export interface PageInfo {
  width: number
  height: number
}

export interface LoadedPaper {
  meta: PaperMeta
  chunks: TextChunk[]
  numPages: number
  pages: PageInfo[]
  pdf: PDFDocumentProxy
}

interface Span {
  start: number
  end: number
  rect: { x: number; y: number; w: number; h: number }
}

// Loads a PDF keeping BOTH the visual document (rendered as-is, like
// Speechify) and a positioned sentence map so we can highlight what's being
// read and let the user tap a sentence to jump there.
export async function loadPaper(file: File): Promise<LoadedPaper> {
  const data = new Uint8Array(await file.arrayBuffer())
  // The static assets (wasm image decoders, fonts, cmaps) are copied into
  // public/pdfjs/ — needed to render scanned papers (JBIG2/JPEG2000 images).
  const base = import.meta.env.BASE_URL
  const pdf = await pdfjsLib.getDocument({
    data,
    wasmUrl: `${base}pdfjs/wasm/`,
    standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
    cMapUrl: `${base}pdfjs/cmaps/`,
    cMapPacked: true,
    iccUrl: `${base}pdfjs/iccs/`,
  }).promise

  const pages: PageInfo[] = []
  const chunks: TextChunk[] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1 })
    pages.push({ width: viewport.width, height: viewport.height })

    const content = await page.getTextContent()
    const { pageText, spans } = buildPageText(content.items as any[], viewport.height)
    chunkPage(pageText, spans, pageNum, chunks)
  }

  const info = (await pdf.getMetadata().catch(() => null)) as
    | { info?: { Title?: string; Author?: string } }
    | null
  const meta: PaperMeta = {
    title: (info?.info?.Title || guessTitle(chunks) || file.name.replace(/\.pdf$/i, '')).trim(),
    authors: (info?.info?.Author || '').trim(),
  }

  return { meta, chunks, numPages: pdf.numPages, pages, pdf }
}

// Stitch pdf.js text items into one string per page, remembering each item's
// character range and on-page rectangle. Spaces are inserted based on the
// geometry (new line, or a visible gap between items on the same line).
function buildPageText(items: any[], pageHeight: number) {
  let pageText = ''
  const spans: Span[] = []
  let lastY: number | null = null
  let lastH = 0
  let lastEndX = 0

  for (const item of items) {
    if (!('str' in item)) continue
    const str: string = item.str
    if (!str || !str.trim()) continue

    const x: number = item.transform[4]
    const yBottom: number = item.transform[5]
    const w: number = item.width || 0
    const h: number = item.height || Math.abs(item.transform[3]) || 10
    const top = pageHeight - yBottom - h

    // "Same line" is generous vertically so raised superscripts (footnote
    // markers, affiliation stars) don't read as new lines.
    const refH = Math.max(h, lastH, 8)
    const sameLine = lastY !== null && Math.abs(yBottom - lastY) < Math.max(3, refH * 0.55)
    if (pageText) {
      if (!sameLine) {
        // Hard layout break (never let a "sentence" span it) when:
        //  - text moves UP the page (column change / new region),
        //  - the gap is far beyond normal leading (section gap), or
        //  - the font size changes markedly (title → authors → body).
        const gap = lastY !== null ? lastY - yBottom : 0
        const sizeChanged = lastH > 0 && Math.max(h, lastH) / Math.min(h, lastH) > 1.3
        pageText += gap < 0 || gap > refH * 2.2 || sizeChanged ? '\n' : ' '
      } else if (x - lastEndX > 1.2) pageText += ' '
    }

    const start = pageText.length
    pageText += str
    spans.push({ start, end: pageText.length, rect: { x, y: top, w, h } })

    lastY = yBottom
    lastH = h
    lastEndX = x + w
  }
  return { pageText, spans }
}

// Split a page's text into sentence-ish chunks and attach the page rectangles
// each chunk covers (slicing item rects proportionally when a sentence starts
// or ends mid-item).
function chunkPage(pageText: string, spans: Span[], page: number, out: TextChunk[]) {
  const MAX_LEN = 300
  const ranges: { s: number; e: number }[] = []

  // A chunk ends at sentence punctuation OR a hard layout break (\n).
  const re = /[^.!?\n]+(?:[.!?]+["')\]]*[ \t]*|\n|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pageText))) {
    let s = m.index
    const e = m.index + m[0].length
    // Break very long sentences at commas/semicolons so chunks stay short.
    while (e - s > MAX_LEN) {
      const slice = pageText.slice(s, s + MAX_LEN)
      let cut = slice.lastIndexOf(', ')
      if (cut < 60) cut = slice.lastIndexOf('; ')
      if (cut < 60) cut = MAX_LEN
      ranges.push({ s, e: s + cut + 1 })
      s = s + cut + 1
    }
    if (e > s) ranges.push({ s, e })
  }

  for (const { s, e } of ranges) {
    const text = pageText.slice(s, e).trim()
    // Skip empty fragments and symbol-only noise (footnote markers etc).
    if (!text || !/[a-zA-Z0-9]/.test(text)) continue
    const rects: ChunkRect[] = []
    for (const span of spans) {
      const os = Math.max(s, span.start)
      const oe = Math.min(e, span.end)
      if (oe <= os) continue
      const len = span.end - span.start
      const f0 = (os - span.start) / len
      const f1 = (oe - span.start) / len
      rects.push({
        page,
        x: span.rect.x + span.rect.w * f0,
        y: span.rect.y,
        w: span.rect.w * (f1 - f0),
        h: span.rect.h,
      })
    }
    out.push({ index: out.length, text, page, rects: mergeLineRects(rects) })
  }
}

// Merge the many per-fragment rectangles of a sentence into one smooth bar
// per text line (fragments whose vertical centers are close belong to the
// same line). This is what makes the highlight look clean instead of ragged.
function mergeLineRects(rects: ChunkRect[]): ChunkRect[] {
  if (rects.length <= 1) return rects
  const lines: ChunkRect[][] = []
  for (const r of rects.slice().sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const last = lines[lines.length - 1]
    if (last) {
      const ref = last[0]
      const cy = r.y + r.h / 2
      const refCy = ref.y + ref.h / 2
      if (Math.abs(cy - refCy) < Math.max(ref.h, r.h) * 0.6) {
        last.push(r)
        continue
      }
    }
    lines.push([r])
  }
  return lines.map((group) => {
    const x0 = Math.min(...group.map((r) => r.x))
    const x1 = Math.max(...group.map((r) => r.x + r.w))
    const y0 = Math.min(...group.map((r) => r.y))
    const y1 = Math.max(...group.map((r) => r.y + r.h))
    return { page: group[0].page, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  })
}

function guessTitle(chunks: TextChunk[]): string {
  for (const c of chunks.slice(0, 6)) {
    if (c.text.length > 20 && c.text.length < 200 && !/^(abstract|introduction)/i.test(c.text)) {
      return c.text
    }
  }
  return ''
}
