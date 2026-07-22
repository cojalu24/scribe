// Runs Kokoro TTS off the main thread so speech generation never freezes the
// page. Messages in: {type:'load'} | {type:'generate', id, text, voice, speed}.
// Messages out: {type:'progress'|'loaded'|'audio'|'error', ...}.
import '../polyfills'
import { KokoroTTS } from 'kokoro-js'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

let tts: KokoroTTS | null = null
let device: 'webgpu' | 'wasm' = 'wasm'

async function load(progress: (p: number) => void) {
  const progress_callback = (p: any) => {
    if (p?.status === 'progress' && typeof p.progress === 'number') progress(p.progress)
  }
  // Prefer WebGPU — generation is many times faster, which is what makes
  // tap-to-jump feel instant. Fall back to WASM (q8) where unavailable
  // (e.g. Safari 18, which doesn't expose the GPU to web apps).
  if ((self.navigator as any)?.gpu) {
    try {
      const t = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'fp32',
        device: 'webgpu',
        progress_callback,
      })
      device = 'webgpu'
      return t
    } catch (e) {
      console.warn('kokoro webgpu failed, falling back to wasm', e)
    }
  }
  device = 'wasm'
  return await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback,
  })
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      if (!tts) {
        tts = await load((p) => self.postMessage({ type: 'progress', progress: p }))
      }
      self.postMessage({ type: 'loaded', device })
    } else if (msg.type === 'generate') {
      if (!tts) throw new Error('model not loaded')
      const audio = await tts.generate(msg.text, { voice: msg.voice, speed: msg.speed })
      self.postMessage({ type: 'audio', id: msg.id, blob: audio.toBlob() })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id ?? null, error: String(err) })
  }
}
