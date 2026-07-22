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
  if ((self.navigator as any)?.gpu) {
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
      const out = await pipe(msg.audio, {
        language: 'en',
        task: 'transcribe',
        // Voice notes can run past 30s; chunk so nothing gets cut off.
        chunk_length_s: 30,
      })
      self.postMessage({ type: 'text', id: msg.id, text: (out?.text || '').trim() })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id ?? null, error: String(err) })
  }
}
