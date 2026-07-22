import { useCallback, useEffect, useRef, useState } from 'react'
import { MeetingRecorder, meetingToText, type Segment } from './lib/meeting'
import type { Transcriber } from './lib/transcribe'

type Phase = 'idle' | 'starting' | 'recording' | 'stopping' | 'done'

// Meeting mode: record a call, get a live speaker-labeled transcript on-device,
// then export it (or send to Claude for clean notes). "You" = your mic;
// "Others" = the meeting audio coming out of your computer.
export function MeetingView({
  transcriber,
  onExit,
}: {
  transcriber: Transcriber
  onExit: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [segments, setSegments] = useState<Segment[]>([])
  const [title, setTitle] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [hasSystemAudio, setHasSystemAudio] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const recRef = useRef<MeetingRecorder | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const isElectron = /electron/i.test(navigator.userAgent)

  // Running timer while recording.
  useEffect(() => {
    if (phase !== 'recording') return
    const started = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500)
    return () => clearInterval(id)
  }, [phase])

  // Keep the transcript scrolled to the latest line.
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [segments])

  useEffect(() => {
    return () => {
      recRef.current?.stop()
    }
  }, [])

  const start = useCallback(async () => {
    setError('')
    setPhase('starting')
    const rec = new MeetingRecorder(transcriber)
    rec.onSegment = (seg) => setSegments((prev) => [...prev, seg])
    recRef.current = rec
    try {
      // Start capturing immediately; load the model in the background so the
      // first windows just wait for it rather than delaying the recording.
      transcriber.loadModel().catch(() => {})
      const { hasSystemAudio } = await rec.start()
      setHasSystemAudio(hasSystemAudio)
      setSegments([])
      setPhase('recording')
    } catch (e: any) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Microphone (and screen/audio) access is needed to record a meeting. Grant it and try again.'
          : "Couldn't start recording: " + (e?.message || e),
      )
      setPhase('idle')
    }
  }, [transcriber])

  const stop = useCallback(async () => {
    setPhase('stopping')
    await recRef.current?.stop()
    recRef.current = null
    setPhase('done')
  }, [])

  const onCopy = useCallback(async () => {
    const text = meetingToText(title, segments)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copy the transcript:', text)
    }
  }, [title, segments])

  const onDownload = useCallback(() => {
    const text = meetingToText(title, segments)
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(title || 'meeting').slice(0, 60)} transcript.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  }, [title, segments])

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className="meeting">
      <header className="meeting-top">
        <button className="btn ghost-btn" onClick={onExit}>
          ← Home
        </button>
        <input
          className="meeting-title"
          placeholder="Meeting title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {phase === 'recording' && (
          <span className="rec-indicator">
            <span className="rec-dot" /> {mmss}
          </span>
        )}
      </header>

      {phase === 'idle' && (
        <div className="meeting-start">
          <h2>Record a meeting</h2>
          <p className="meeting-hint">
            Scribe transcribes on your device and labels who’s speaking — <strong>You</strong> (your
            mic) vs <strong>Others</strong> (everyone else on the call).
          </p>
          {!isElectron && (
            <p className="meeting-warn">
              For full-room audio, use the Scribe desktop app. In a browser you can only capture a
              screen/tab you share.
            </p>
          )}
          <button className="btn primary big" onClick={start}>
            Start recording
          </button>
          {error && <p className="meeting-error">{error}</p>}
        </div>
      )}

      {phase === 'starting' && <div className="meeting-status">Setting up…</div>}

      {(phase === 'recording' || phase === 'stopping' || phase === 'done') && (
        <>
          {!hasSystemAudio && phase !== 'done' && (
            <p className="meeting-warn inline">
              Only your microphone is being captured — the meeting audio (“Others”) wasn’t shared.
            </p>
          )}
          <div className="transcript" ref={transcriptRef}>
            {segments.length === 0 ? (
              <p className="transcript-empty">
                {phase === 'recording'
                  ? 'Listening… transcript appears every few seconds.'
                  : 'No speech was captured.'}
              </p>
            ) : (
              segments
                .slice()
                .sort((a, b) => a.t - b.t)
                .map((s) => (
                  <div key={s.id} className={'seg seg-' + s.speaker.toLowerCase()}>
                    <span className="seg-who">{s.speaker}</span>
                    <span className="seg-text">{s.text}</span>
                  </div>
                ))
            )}
          </div>

          <footer className="meeting-controls">
            {phase === 'recording' && (
              <button className="btn stop-btn" onClick={stop}>
                Stop recording
              </button>
            )}
            {phase === 'stopping' && <span className="meeting-status">Finishing…</span>}
            {phase === 'done' && (
              <>
                <button className="btn ghost-btn" onClick={onExit}>
                  Done
                </button>
                <div className="controls-spacer" />
                <button className="btn" onClick={onDownload} disabled={segments.length === 0}>
                  Download
                </button>
                <button className="btn" onClick={onCopy} disabled={segments.length === 0}>
                  {copied ? 'Copied' : 'Copy for Claude'}
                </button>
              </>
            )}
          </footer>
        </>
      )}
    </div>
  )
}
