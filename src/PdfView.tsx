import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ChunkRect, PageInfo, TextChunk } from './lib/pdf'

// Renders the real PDF pages (like Speechify) with a highlight overlay on the
// sentence currently being read. Clicking anywhere jumps the reader there.
export function PdfView({
  pdf,
  pages,
  chunks,
  activeIndex,
  playing,
  onSeek,
}: {
  pdf: PDFDocumentProxy
  pages: PageInfo[]
  chunks: TextChunk[]
  activeIndex: number
  playing: boolean
  onSeek: (chunkIndex: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const activeRef = useRef<HTMLDivElement | null>(null)

  // Track available width so pages fill the reader column.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(Math.min(el.clientWidth - 32, 900))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the highlighted sentence in view — while reading, and when the user
  // steps through sentences with the arrow keys.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIndex])

  const active = chunks[activeIndex]

  return (
    <div className="pdf-view" ref={containerRef}>
      {width > 0 &&
        pages.map((info, i) => {
          const pageNum = i + 1
          const scale = width / info.width
          return (
            <PdfPage
              key={pageNum}
              pdf={pdf}
              pageNum={pageNum}
              info={info}
              scale={scale}
              highlights={active?.page === pageNum ? active.rects : []}
              playing={playing}
              activeRef={active?.page === pageNum ? activeRef : undefined}
              onClickAt={(x, y) => {
                const idx = chunkAtPoint(chunks, pageNum, x, y)
                if (idx >= 0) onSeek(idx)
              }}
            />
          )
        })}
    </div>
  )
}

function PdfPage({
  pdf,
  pageNum,
  info,
  scale,
  highlights,
  playing,
  activeRef,
  onClickAt,
}: {
  pdf: PDFDocumentProxy
  pageNum: number
  info: PageInfo
  scale: number
  highlights: ChunkRect[]
  playing: boolean
  activeRef?: React.MutableRefObject<HTMLDivElement | null>
  onClickAt: (x: number, y: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    ;(async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const page = await pdf.getPage(pageNum)
      if (cancelled) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: scale * dpr })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      task = page.render({ canvasContext: ctx, viewport } as any)
      await task.promise
    })().catch((e: any) => {
      // Cancelled renders (component re-mounted / resized mid-paint) are fine.
      if (e?.name !== 'RenderingCancelledException') console.error('pdf render failed', e)
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, pageNum, scale])

  const w = info.width * scale
  const h = info.height * scale

  return (
    <div
      className="pdf-page"
      style={{ width: w, height: h }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onClickAt((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale)
      }}
    >
      <canvas ref={canvasRef} style={{ width: w, height: h }} />
      {highlights.map((r, i) => (
        <div
          key={i}
          ref={i === 0 && activeRef ? activeRef : undefined}
          className={'pdf-highlight' + (playing ? ' playing' : '')}
          style={{
            left: r.x * scale - 2,
            top: r.y * scale - 2,
            width: r.w * scale + 4,
            height: r.h * scale + 4,
          }}
        />
      ))}
    </div>
  )
}

// Find the sentence nearest to a clicked point on a page.
function chunkAtPoint(chunks: TextChunk[], page: number, x: number, y: number): number {
  let best = -1
  let bestDist = Infinity
  for (const c of chunks) {
    if (c.page !== page) continue
    for (const r of c.rects) {
      const dx = Math.max(r.x - x, 0, x - (r.x + r.w))
      const dy = Math.max(r.y - y, 0, y - (r.y + r.h))
      if (dx === 0 && dy === 0) return c.index
      // Weight vertical distance more: clicks in the margin should pick the
      // sentence on the same line.
      const d = dx * dx + dy * dy * 6
      if (d < bestDist) {
        bestDist = d
        best = c.index
      }
    }
  }
  return best
}
