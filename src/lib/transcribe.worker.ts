// Runs Whisper off the main thread. Messages in: {type:'load'} |
// {type:'transcribe', id, audio: Float32Array}. Messages out:
// {type:'progress'|'loaded'|'text'|'error', ...}.
import '../polyfills'
import { pipeline } from '@huggingface/transformers'

// Best-in-browser accuracy, needs WebGPU. ~1GB one-time download, then cached.
const LARGE_MODEL = 'onnx-community/whisper-large-v3-turbo'
// Lightweight fallback for devices without WebGPU.
const SMALL_MODEL = 'onnx-community/whisper-base'

let pipe: any = null

async function load(progress: (p: number) => void) {
  const progress_callback = (p: any) => {
    if (p?.status === 'progress' && typeof p.progress === 'number') progress(p.progress)
  }
  // Phones get the small model: the 1GB turbo download and its memory
  // footprint are unreasonable on a handset.
  const isPhone = /iPhone|iPad|Android/i.test(self.navigator?.userAgent || '')
  if ((self.navigator as any)?.gpu && !isPhone) {
    try {
      return await pipeline('automatic-speech-recognition', LARGE_MODEL, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
        progress_callback,
      })
    } catch (e) {
      console.warn('whisper webgpu failed, falling back to wasm', e)
    }
  }
  return await pipeline('automatic-speech-recognition', SMALL_MODEL, {
    device: 'wasm',
    // Note: fully-q8 whisper is broken in current onnxruntime (missing
    // quantization scales in the decoder) — keep the decoder fp32.
    dtype: { encoder_model: 'q8', decoder_model_merged: 'fp32' },
    progress_callback,
  })
}

// Safety net for Whisper's repetition loops: if a word or short phrase repeats
// 3+ times back to back, keep two and drop the rest. Token-based (not regex) so
// it stays fast even on a pathological 2,000-word output.
function collapseRepeats(text: string): string {
  const words = text.split(/\s+/).filter(Boolean)
  const norm = (s: string) => s.toLowerCase().replace(/[.,!?;:"']/g, '')
  const out: string[] = []
  let i = 0
  while (i < words.length) {
    let collapsed = false
    for (let n = 1; n <= 5 && !collapsed; n++) {
      if (i + n * 2 > words.length) continue
      const phrase = words.slice(i, i + n).map(norm).join(' ')
      if (!phrase) continue
      let reps = 1
      let j = i + n
      while (j + n <= words.length && words.slice(j, j + n).map(norm).join(' ') === phrase) {
        reps++
        j += n
      }
      if (reps >= 3) {
        out.push(...words.slice(i, i + n * 2)) // keep two occurrences
        i = j
        collapsed = true
      }
    }
    if (!collapsed) {
      out.push(words[i])
      i++
    }
  }
  return out.join(' ')
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      if (!pipe) {
        pipe = await load((p) => self.postMessage({ type: 'progress', progress: p }))
      }
      self.postMessage({ type: 'loaded' })
    } else if (msg.type === 'transcribe') {
      if (!pipe) throw new Error('model not loaded')
      // Whisper can fall into runaway repetition loops ("blah, blah, blah…"
      // hundreds of times). Cap output length to what the audio could possibly
      // contain and penalise repeats.
      const seconds = msg.audio.length / 16000
      const out = await pipe(msg.audio, {
        language: 'en',
        task: 'transcribe',
        // Voice notes can run past 30s; chunk so nothing gets cut off.
        chunk_length_s: 30,
        max_new_tokens: Math.min(440, Math.max(48, Math.ceil(seconds * 10))),
        repetition_penalty: 1.15,
        no_repeat_ngram_size: 8,
      })
      const text = collapseRepeats((out?.text || '').trim())
      self.postMessage({ type: 'text', id: msg.id, text })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id ?? null, error: String(err) })
  }
}
