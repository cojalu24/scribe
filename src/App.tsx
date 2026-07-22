import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@fontsource-variable/space-grotesk'
import './App.css'
import { loadPaper, type LoadedPaper } from './lib/pdf'
import { PdfView } from './PdfView'
import { KokoroReader, type ReaderState } from './lib/tts'
import { MeetingView } from './MeetingView'

type Reader = KokoroReader
import { Recorder, Transcriber } from './lib/transcribe'
import { buildNotesDoc } from './lib/export'
import type { Capture, PaperMeta } from './types'

export default function App() {
  const [paper, setPaper] = useState<LoadedPaper | null>(null)
  const [meta, setMeta] = useState<PaperMeta>({ title: '', authors: '' })
  const [loadingPdf, setLoadingPdf] = useState(false)
  const pdfBytesRef = useRef<Uint8Array | null>(null)
  const [savingPdf, setSavingPdf] = useState(false)
  const [loadError, setLoadError] = useState('')
  // Which top-level screen when no paper is open.
  const [mode, setMode] = useState<'home' | 'meeting'>('home')

  const [readerState, setReaderState] = useState<ReaderState>('idle')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [modelPct, setModelPct] = useState(0)
  const [voice, setVoice] = useState('')
  const [voices, setVoices] = useState<{ id: string; label: string }[]>([])

  const [captures, setCaptures] = useState<Capture[]>([])
  const [recording, setRecording] = useState(false)
  const [whisperLoading, setWhisperLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  // Id of a just-added written thought that should open straight into editing.
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null)

  const readerRef = useRef<Reader | null>(null)
  const transcriberRef = useRef<Transcriber | null>(null)
  const recorderRef = useRef<Recorder | null>(null)
  const sessionStart = useRef<number>(0)
  const currentIndexRef = useRef(0)

  useEffect(() => {
    currentIndexRef.current = currentIndex
  }, [currentIndex])

  // Set up the reader + transcriber once.
  useEffect(() => {
    const reader: Reader = new KokoroReader()
    reader.onStateChange = setReaderState
    reader.onIndexChange = (i) => setCurrentIndex(i)
    readerRef.current = reader
    ;(window as any).__reader = reader // debug handle
    transcriberRef.current = new Transcriber()
    ;(window as any).__transcriber = transcriberRef.current // debug handle

    // Warm both models as soon as the app opens, so pressing Read aloud or
    // Capture never waits on a load. Staggered so they don't fight for
    // bandwidth on the very first run (when they're downloading).
    reader.loadModel((p) => setModelPct(Math.round(p))).catch(() => {})
    const warmStt = setTimeout(
      () => transcriberRef.current?.loadModel().catch(() => {}),
      1500,
    )

    return () => {
      clearTimeout(warmStt)
      reader.dispose()
    }
  }, [])

  const handleFile = useCallback(async (file: File) => {
    if (!file) return
    // Be permissive: some sources drop the MIME type, so also accept by name.
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      alert(`That file doesn't look like a PDF (got "${file.name}"). Please choose a .pdf file.`)
      return
    }
    setLoadingPdf(true)
    try {
      // Keep a pristine copy of the file for the annotated-PDF export
      // (pdf.js consumes the buffer we hand it, so read the file twice).
      pdfBytesRef.current = new Uint8Array(await file.arrayBuffer())
      const loaded = await loadPaper(file)
      setPaper(loaded)
      setMeta(loaded.meta)
      setCaptures([])
      setCurrentIndex(0)
      sessionStart.current = Date.now()
      readerRef.current?.setChunks(loaded.chunks)
      // (Both models are already warming from app start.)
    } catch (e: any) {
      console.error('failed to load PDF', e)
      // Full details on-screen so failures are diagnosable (esp. Safari).
      setLoadError(String(e?.stack || e?.message || e).slice(0, 1500))
      if (!location.search.includes('debugload')) {
        alert(
          "Couldn't read that PDF" +
            (e?.message ? `: ${e.message}` : '.') +
            ' If this is a password-protected or unusual file, try another copy of the paper.',
        )
      }
    } finally {
      setLoadingPdf(false)
    }
  }, [])

  // Debug hook: ?debugload makes the app fetch and open a bundled sample PDF
  // on startup, so browser-specific load failures can be reproduced hands-off.
  useEffect(() => {
    if (!location.search.includes('debugload')) return
    ;(async () => {
      const res = await fetch('sample.pdf')
      const buf = await res.arrayBuffer()
      await handleFile(new File([buf], 'sample.pdf', { type: 'application/pdf' }))
    })().catch((e) => setLoadError('debug fetch failed: ' + e))
  }, [handleFile])

  const onPlayPause = useCallback(async () => {
    const reader = readerRef.current
    if (!reader) return
    if (voice) reader.voice = voice
    try {
      if (!reader.modelLoaded) {
        await reader.loadModel((p) => setModelPct(Math.round(p)))
        setVoices(reader.listVoices())
        setVoice(reader.voice)
      }
      await reader.toggle()
    } catch (e) {
      console.error('reader failed', e)
      alert('The voice engine failed to load. Check your connection and try again.')
    }
  }, [voice])

  const onVoiceChange = useCallback((v: string) => {
    setVoice(v)
    if (readerRef.current) readerRef.current.voice = v
  }, [])

  // Voice capture: tapping starts recording (and pauses the reader so you can
  // speak); tapping again stops and kicks off transcription.
  const toggleCapture = useCallback(async () => {
    if (!recording) {
      readerRef.current?.pause()
      const rec = new Recorder()
      try {
        await rec.start()
      } catch (e: any) {
        if (e?.name === 'NotAllowedError') {
          alert(
            'Chrome needs microphone access. Click the mic/lock icon in the address bar and choose “Allow on every visit” so it stops asking.',
          )
        } else if (e?.name === 'NotReadableError') {
          alert('The microphone is busy in another app. Close it and try again.')
        } else {
          alert('Couldn’t start the microphone: ' + (e?.name || e))
        }
        return
      }
      recorderRef.current = rec
      setRecording(true)
      // Warm up Whisper in the background while the user talks.
      transcriberRef.current?.loadModel().catch(() => {})
    } else {
      const rec = recorderRef.current
      setRecording(false)
      if (!rec) return
      const anchorIndex = currentIndexRef.current
      const anchorText = paper?.chunks[anchorIndex]?.text || ''
      const id = crypto.randomUUID()
      const capture: Capture = {
        id,
        createdAt: Date.now() - sessionStart.current,
        anchorChunk: anchorIndex,
        anchorText,
        transcript: '',
        status: 'transcribing',
      }
      setCaptures((prev) => [...prev, capture])
      try {
        const audio = await rec.stop()
        setWhisperLoading(true)
        const transcriber = transcriberRef.current!
        let text: string
        try {
          text = await transcriber.transcribe(audio)
        } catch (e) {
          // The first attempt can fail while the model is still warming up —
          // retry once before giving up.
          console.warn('transcription failed, retrying once', e)
          text = await transcriber.transcribe(audio)
        }
        setCaptures((prev) =>
          prev.map((c) => (c.id === id ? { ...c, transcript: text, status: 'done' } : c)),
        )
      } catch (e) {
        console.error('transcription failed', e)
        setCaptures((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'error' } : c)))
      } finally {
        setWhisperLoading(false)
      }
    }
  }, [recording, paper])

  const onExport = useCallback(async () => {
    const doc = buildNotesDoc(meta, captures)
    try {
      await navigator.clipboard.writeText(doc)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copy your notes:', doc)
    }
  }, [meta, captures])

  // Save a copy of the original PDF with highlights + attached comments
  // (opens in Preview/Zotero/Acrobat with the notes intact).
  const onSavePdf = useCallback(async () => {
    if (!paper || !pdfBytesRef.current) return
    setSavingPdf(true)
    try {
      const { buildAnnotatedPdf } = await import('./lib/annotate')
      const bytes = await buildAnnotatedPdf(pdfBytesRef.current, paper.chunks, captures, meta)
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${(meta.title || 'paper').slice(0, 80)} (annotated).pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    } catch (e) {
      console.error('annotated pdf export failed', e)
      alert("Couldn't build the annotated PDF for this file.")
    } finally {
      setSavingPdf(false)
    }
  }, [paper, captures, meta])

  const isPlaying = readerState === 'playing' || readerState === 'buffering'
  const doneCaptures = useMemo(() => captures.filter((c) => c.status !== 'error'), [captures])

  // Edit a thought's text (fix a transcription, or write one from scratch).
  // Promotes an errored capture to 'done' so it exports normally. Clearing a
  // thought to empty removes it (also cleans up an abandoned written note).
  const updateCapture = useCallback((id: string, text: string) => {
    setCaptures((prev) =>
      text
        ? prev.map((c) => (c.id === id ? { ...c, transcript: text, status: 'done' } : c))
        : prev.filter((c) => c.id !== id),
    )
  }, [])

  const deleteCapture = useCallback((id: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== id))
  }, [])

  // Add a typed thought (no voice) anchored to the current highlighted spot,
  // and open it for editing right away.
  const addWrittenThought = useCallback(() => {
    if (!paper) return
    const anchorIndex = currentIndexRef.current
    const id = crypto.randomUUID()
    setCaptures((prev) => [
      ...prev,
      {
        id,
        createdAt: Date.now() - sessionStart.current,
        anchorChunk: anchorIndex,
        anchorText: paper.chunks[anchorIndex]?.text || '',
        transcript: '',
        status: 'done',
      },
    ])
    setFocusNoteId(id)
  }, [paper])

  // Keyboard shortcuts: Space = play/pause the reader, R = start/stop a
  // voice note. Ignored while typing in a form control.
  useEffect(() => {
    if (!paper) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      )
        return
      if (e.key === ' ') {
        e.preventDefault()
        onPlayPause()
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        toggleCapture()
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        addWrittenThought()
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        readerRef.current?.seekTo(currentIndexRef.current + 1)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        readerRef.current?.seekTo(currentIndexRef.current - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paper, onPlayPause, toggleCapture, addWrittenThought])

  if (!paper && mode === 'meeting') {
    return <MeetingView transcriber={transcriberRef.current!} onExit={() => setMode('home')} />
  }

  if (!paper) {
    return (
      <>
        <HomeScreen
          loading={loadingPdf}
          onFile={handleFile}
          onRecordMeeting={() => setMode('meeting')}
        />
        {loadError && (
          <pre
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              margin: 0,
              padding: 12,
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              background: '#fff4f4',
              color: '#a00',
              borderTop: '1px solid #e0b4b4',
              maxHeight: '45vh',
              overflow: 'auto',
            }}
          >
            {loadError}
          </pre>
        )}
      </>
    )
  }

  return (
    <div className="app">
      <div className="columns">
        <main className="reader" aria-label="Paper">
          <PdfView
            pdf={paper.pdf}
            pages={paper.pages}
            chunks={paper.chunks}
            activeIndex={currentIndex}
            onSeek={(i) => readerRef.current?.seekTo(i)}
          />
        </main>

        <aside className="notes" aria-label="Thoughts">
          <div className="notes-header">
            <h2 className="thoughts-heading">Thoughts</h2>
          </div>
          <ul>
            {captures.map((c) => (
              <li key={c.id} className="note">
                <div className="note-body">
                  {c.anchorText && <div className="note-anchor">“{c.anchorText}”</div>}
                  <NoteText
                    capture={c}
                    autoEdit={c.id === focusNoteId}
                    onSave={(text) => updateCapture(c.id, text)}
                  />
                </div>
                <button
                  className="note-delete"
                  onClick={() => deleteCapture(c.id)}
                  aria-label="Delete thought"
                  title="Delete"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <footer className="controls">
        <button
          className="btn"
          onClick={onPlayPause}
          disabled={readerState === 'loading-model'}
        >
          {readerState === 'loading-model'
            ? `Loading voice… ${modelPct}%`
            : isPlaying
              ? 'Pause'
              : 'Read aloud'}
          {readerState !== 'loading-model' && <kbd>space</kbd>}
        </button>
        {voices.length > 0 && (
          <select
            className="btn voice-select"
            value={voice}
            onChange={(e) => onVoiceChange(e.target.value)}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        )}

        <button
          className={'btn capture' + (recording ? ' recording' : '')}
          onClick={toggleCapture}
        >
          {recording ? 'Stop' : 'Capture'}
          <kbd>R</kbd>
        </button>

        <button className="btn" onClick={addWrittenThought}>
          Write
          <kbd>T</kbd>
        </button>

        <div className="controls-spacer" />

        <button className="btn ghost-btn" onClick={() => setPaper(null)}>
          New paper
        </button>
        <button
          className="btn"
          onClick={onSavePdf}
          disabled={doneCaptures.length === 0 || savingPdf}
        >
          {savingPdf ? 'Saving…' : 'Save PDF'}
        </button>
        <button className="btn" onClick={onExport} disabled={doneCaptures.length === 0}>
          {copied ? 'Copied' : `Copy notes${whisperLoading ? ' …' : ''}`}
        </button>
      </footer>
    </div>
  )
}

// A single thought's text. Click to edit — fix a mis-heard word, rewrite it,
// or type one in yourself. Cmd/Ctrl+Enter or clicking away saves; Esc cancels.
function NoteText({
  capture,
  onSave,
  autoEdit,
}: {
  capture: import('./types').Capture
  onSave: (text: string) => void
  autoEdit?: boolean
}) {
  const [editing, setEditing] = useState(!!autoEdit)
  const [draft, setDraft] = useState(capture.transcript)

  useEffect(() => {
    if (!editing) setDraft(capture.transcript)
  }, [capture.transcript, editing])

  if (capture.status === 'transcribing') {
    return (
      <div className="note-text">
        <em>transcribing…</em>
      </div>
    )
  }

  if (editing) {
    return (
      <textarea
        className="note-edit"
        value={draft}
        autoFocus
        rows={Math.max(2, Math.ceil((draft.length || 1) / 34))}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)}
        onBlur={() => {
          onSave(draft.trim())
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(capture.transcript)
            setEditing(false)
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.currentTarget.blur()
          }
        }}
      />
    )
  }

  const empty = !capture.transcript
  return (
    <div
      className={'note-text editable' + (empty ? ' empty' : '')}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {empty ? (
        <em className="err">
          {capture.status === 'error' ? 'couldn’t transcribe — click to write it' : 'click to write'}
        </em>
      ) : (
        capture.transcript
      )}
    </div>
  )
}

function HomeScreen({
  loading,
  onFile,
  onRecordMeeting,
}: {
  loading: boolean
  onFile: (f: File) => void
  onRecordMeeting: () => void
}) {
  const [drag, setDrag] = useState(false)
  return (
    <div className="upload-screen">
      <div className="upload-inner">
        <label
          className={'dropzone' + (drag ? ' drag' : '')}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            const f = e.dataTransfer.files[0]
            if (f) onFile(f)
            else
              alert(
                'That drop didn\'t contain a file — dragging from another browser tab only drops a link. Save the PDF to your computer first, then choose it here.',
              )
          }}
        >
          <input
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          {loading ? <span>Opening…</span> : <span>Open a paper</span>}
        </label>
        <button className="home-meeting" onClick={onRecordMeeting}>
          Record a meeting
        </button>
      </div>
    </div>
  )
}
