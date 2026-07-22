// Metadata pulled from the PDF (best-effort — the user can edit it).
export interface PaperMeta {
  title: string
  authors: string
}

// One voice note the user recorded while reading.
export interface Capture {
  id: string
  // Milliseconds since the session started (for ordering / display).
  createdAt: number
  // Which chunk of the paper the reader was on when this was captured.
  anchorChunk: number
  // A short snippet of the paper text at that point, for context.
  anchorText: string
  // The transcribed voice note.
  transcript: string
  status: 'transcribing' | 'done' | 'error'
}
