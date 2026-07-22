import type { TextChunk } from './pdf'
import { speakable, type ReaderState } from './tts'

// Reads the paper with the operating system's built-in voices
// (speechSynthesis). Used where WebGPU is unavailable (Safari): the voices
// are plainer than Kokoro but speak INSTANTLY, so play/pause and tap-to-jump
// have zero latency. Mirrors KokoroReader's interface.
export class SystemReader {
  private chunks: TextChunk[] = []
  private currentIndex = 0
  private wantPlaying = false
  // Bumped on every play/pause/seek so stale utterance callbacks are ignored.
  private epoch = 0
  private systemVoices: SpeechSynthesisVoice[] = []

  voice = ''
  speed = 1.1
  state: ReaderState = 'idle'
  readonly device = 'system'

  onIndexChange?: (index: number) => void
  onStateChange?: (state: ReaderState) => void

  private setState(s: ReaderState) {
    this.state = s
    this.onStateChange?.(s)
  }

  get index() {
    return this.currentIndex
  }

  get modelLoaded() {
    return this.state !== 'idle' && this.state !== 'loading-model'
  }

  async loadModel(_onProgress?: (pct: number) => void) {
    if (this.modelLoaded) return
    this.setState('loading-model')
    // Voice list often populates asynchronously; wait briefly for it.
    await new Promise<void>((resolve) => {
      const have = () => speechSynthesis.getVoices().length > 0
      if (have()) return resolve()
      const done = () => resolve()
      speechSynthesis.addEventListener('voiceschanged', done, { once: true })
      setTimeout(done, 1500)
    })
    this.systemVoices = speechSynthesis
      .getVoices()
      .filter((v) => v.lang.toLowerCase().startsWith('en'))
    if (this.systemVoices.length === 0) this.systemVoices = speechSynthesis.getVoices()
    if (!this.voice || !this.findVoice(this.voice)) {
      // Prefer higher-quality installed voices when present.
      const preferred =
        this.systemVoices.find((v) => /premium|enhanced/i.test(v.name)) ||
        this.systemVoices.find((v) => /samantha|ava|allison|susan|zoe/i.test(v.name)) ||
        this.systemVoices.find((v) => v.default) ||
        this.systemVoices[0]
      this.voice = preferred?.voiceURI ?? ''
    }
    this.setState('ready')
  }

  listVoices(): { id: string; label: string }[] {
    return this.systemVoices.map((v) => ({ id: v.voiceURI, label: v.name }))
  }

  private findVoice(uri: string) {
    return this.systemVoices.find((v) => v.voiceURI === uri) ?? null
  }

  setChunks(chunks: TextChunk[]) {
    this.chunks = chunks
    this.currentIndex = 0
    this.epoch++
    speechSynthesis.cancel()
  }

  async play() {
    if (!this.chunks.length) return
    this.wantPlaying = true
    this.speakIndex(this.currentIndex)
  }

  private speakIndex(index: number) {
    const myEpoch = ++this.epoch
    if (index >= this.chunks.length) {
      this.wantPlaying = false
      this.setState('ready')
      return
    }
    this.currentIndex = index
    this.onIndexChange?.(index)

    const text = speakable(this.chunks[index].text) || '.'
    const utter = new SpeechSynthesisUtterance(text)
    const v = this.findVoice(this.voice)
    if (v) utter.voice = v
    utter.rate = this.speed
    utter.onend = () => {
      if (myEpoch !== this.epoch || !this.wantPlaying) return
      this.speakIndex(index + 1)
    }
    utter.onerror = () => {
      // Cancellation also lands here; only react if we're still current.
      if (myEpoch !== this.epoch) return
      this.wantPlaying = false
      this.setState('paused')
    }
    speechSynthesis.cancel()
    speechSynthesis.speak(utter)
    this.setState('playing')
  }

  pause() {
    this.epoch++
    this.wantPlaying = false
    speechSynthesis.cancel()
    this.setState('paused')
  }

  async toggle() {
    if (this.state === 'playing' || this.state === 'buffering') this.pause()
    else await this.play()
  }

  async seekTo(index: number) {
    const wasPlaying = this.wantPlaying
    this.epoch++
    speechSynthesis.cancel()
    this.currentIndex = Math.max(0, Math.min(index, this.chunks.length - 1))
    this.onIndexChange?.(this.currentIndex)
    if (wasPlaying) {
      this.wantPlaying = true
      this.speakIndex(this.currentIndex)
    } else this.setState('paused')
  }

  dispose() {
    this.epoch++
    speechSynthesis.cancel()
  }
}
