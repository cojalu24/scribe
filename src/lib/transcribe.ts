// Whisper speech-to-text, run in a Web Worker so transcription never freezes
// the page (see transcribe.worker.ts).
export class Transcriber {
  private worker: Worker | null = null
  private loading: Promise<void> | null = null
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>()
  private nextId = 1

  loadModel(onProgress?: (pct: number) => void): Promise<void> {
    if (this.loading) return this.loading
    this.loading = (async () => {
      const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), {
        type: 'module',
      })
      this.worker = worker
      try {
        await new Promise<void>((resolve, reject) => {
          worker.onmessage = (e) => {
            const m = e.data
            if (m.type === 'progress') onProgress?.(m.progress)
            else if (m.type === 'loaded') resolve()
            else if (m.type === 'error') reject(new Error(m.error))
          }
          worker.onerror = (e) => reject(new Error(e.message || 'worker failed'))
          worker.postMessage({ type: 'load' })
        })
      } catch (e) {
        worker.terminate()
        this.worker = null
        this.loading = null
        throw e
      }
      worker.onmessage = (e) => {
        const m = e.data
        if (m.type === 'text') {
          this.pending.get(m.id)?.resolve(m.text)
          this.pending.delete(m.id)
        } else if (m.type === 'error' && m.id != null) {
          this.pending.get(m.id)?.reject(new Error(m.error))
          this.pending.delete(m.id)
        }
      }
    })()
    return this.loading
  }

  async transcribe(audio: Float32Array): Promise<string> {
    await this.loadModel()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error('model not loaded'))
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ type: 'transcribe', id, audio })
    })
  }
}

// Records from the microphone and returns 16 kHz mono audio (what Whisper wants).
export class Recorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start()
  }

  get isRecording() {
    return this.recorder?.state === 'recording'
  }

  // Stops recording and returns the audio decoded/resampled to 16 kHz mono.
  async stop(): Promise<Float32Array> {
    const rec = this.recorder
    if (!rec) throw new Error('not recording')
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType }))
    })
    rec.stop()
    const blob = await done
    this.cleanup()
    return decodeTo16k(blob)
  }

  cancel() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.cleanup()
  }

  private cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.recorder = null
  }
}

async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
  const tmpCtx = new AC()
  const decoded = await tmpCtx.decodeAudioData(arrayBuffer)
  tmpCtx.close()

  // Resample to 16 kHz mono using an offline context.
  const targetRate = 16000
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}
