import { Transcriber } from './transcribe'

// One line of the running meeting transcript.
export interface Segment {
  id: string
  speaker: 'You' | 'Others'
  text: string
  t: number // ms since recording started (for ordering)
}

type SourceLabel = 'You' | 'Others'

interface Source {
  label: SourceLabel
  stream: MediaStream
  node: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  gain: GainNode
  buffers: Float32Array[]
}

// Records a meeting and turns it into a live, speaker-labeled transcript,
// entirely on-device. Your microphone is "You"; the system/meeting audio
// (everyone else, captured via loopback) is "Others" — a clean two-way split
// without fragile speaker-identification. Audio is sliced into windows,
// silence is skipped, and each window is transcribed by Whisper.
export class MeetingRecorder {
  private transcriber: Transcriber
  private ctx: AudioContext | null = null
  private sources: Source[] = []
  private running = false
  private startTime = 0
  private queue: Promise<void> = Promise.resolve()

  // Seconds of audio per transcription window. Longer = better accuracy and
  // fewer worker calls, but more lag before text appears.
  windowSec = 12
  // Skip windows quieter than this (avoids Whisper hallucinating on silence).
  silenceRms = 0.006

  onSegment?: (seg: Segment) => void
  onStatus?: (status: string) => void

  constructor(transcriber: Transcriber) {
    this.transcriber = transcriber
  }

  // Starts capture. Returns whether we got the "Others" (system) audio — if
  // false, only your mic is being transcribed.
  async start(): Promise<{ hasSystemAudio: boolean }> {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    })

    // System / meeting audio via display-media loopback (the Electron app
    // grants this automatically; a browser will prompt to share a screen/tab
    // with audio). Video is requested only to satisfy the API, then dropped.
    let system: MediaStream | null = null
    try {
      const disp = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      } as MediaStreamConstraints)
      disp.getVideoTracks().forEach((t) => t.stop())
      const audioTracks = disp.getAudioTracks()
      if (audioTracks.length) system = new MediaStream(audioTracks)
    } catch {
      // User cancelled the picker, or loopback isn't available here.
    }

    const AC: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext
    this.ctx = new AC()
    await this.ctx.resume().catch(() => {})
    this.startTime = performance.now()
    this.addSource(mic, 'You')
    if (system) this.addSource(system, 'Others')
    this.running = true
    this.loop()
    return { hasSystemAudio: !!system }
  }

  private addSource(stream: MediaStream, label: SourceLabel) {
    const ctx = this.ctx!
    const node = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const gain = ctx.createGain()
    gain.gain.value = 0 // process silently — never play the audio back
    const buffers: Float32Array[] = []
    processor.onaudioprocess = (e) => {
      if (!this.running) return
      buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    node.connect(processor)
    processor.connect(gain)
    gain.connect(ctx.destination)
    this.sources.push({ label, stream, node, processor, gain, buffers })
  }

  private async loop() {
    const rate = this.ctx!.sampleRate
    while (this.running) {
      await sleep(this.windowSec * 1000)
      for (const s of this.sources) {
        const chunks = s.buffers.splice(0, s.buffers.length)
        if (!chunks.length) continue
        const pcm = downsample(concat(chunks), rate, 16000)
        if (rms(pcm) < this.silenceRms) continue
        this.enqueue(pcm, s.label, performance.now() - this.startTime)
      }
    }
  }

  // Transcriptions run one at a time (single Whisper worker), in arrival order.
  private enqueue(pcm: Float32Array, speaker: SourceLabel, t: number) {
    this.queue = this.queue.then(async () => {
      if (!this.ctx) return
      try {
        const text = clean(await this.transcriber.transcribe(pcm))
        if (text) {
          this.onSegment?.({ id: crypto.randomUUID(), speaker, text, t })
        }
      } catch {
        // Drop this window; keep the meeting going.
      }
    })
  }

  async stop() {
    this.running = false
    await this.queue // let in-flight transcription finish
    for (const s of this.sources) {
      try {
        s.processor.disconnect()
        s.node.disconnect()
        s.gain.disconnect()
      } catch {
        /* already torn down */
      }
      s.stream.getTracks().forEach((t) => t.stop())
    }
    this.sources = []
    await this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function concat(chunks: Float32Array[]): Float32Array {
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Float32Array(len)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input
  const ratio = inRate / outRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.floor((i + 1) * ratio)
    let sum = 0
    let n = 0
    for (let j = start; j < end && j < input.length; j++) {
      sum += input[j]
      n++
    }
    out[i] = n ? sum / n : 0
  }
  return out
}

function rms(a: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * a[i]
  return Math.sqrt(sum / (a.length || 1))
}

// Whisper emits a few stock phrases on near-silence/noise; drop the obvious
// ones and anything with no real words.
const NOISE = new Set(['you', 'thank you', 'thanks for watching', 'thanks', '.', 'bye'])
function clean(text: string): string {
  const t = text.trim()
  if (!t) return ''
  if (!/[a-zA-Z0-9]/.test(t)) return ''
  if (NOISE.has(t.toLowerCase().replace(/[.!]$/, ''))) return ''
  return t
}

// Assemble a finished transcript into text for export / sending to Claude.
export function meetingToText(title: string, segments: Segment[]): string {
  const lines = segments
    .slice()
    .sort((a, b) => a.t - b.t)
    .map((s) => `${s.speaker}: ${s.text}`)
  return [
    title ? `Meeting: ${title}` : 'Meeting transcript',
    '',
    lines.join('\n'),
    '',
    '---',
    'Above is a raw meeting transcript. "You" is me; "Others" is everyone else on the call.',
    'Please turn it into clean notes: a short summary, key decisions, and action items (with owners if you can tell).',
  ].join('\n')
}
