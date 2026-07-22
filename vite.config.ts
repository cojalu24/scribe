import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The on-device AI models (Kokoro TTS + Whisper) run faster when the page is
// "cross-origin isolated", which lets them use multiple CPU threads. These
// headers turn that on for the dev server.
const applyHeaders = (server: any) => {
  server.middlewares.use((_req: any, res: any, next: any) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    next()
  })
}

const crossOriginIsolation = {
  name: 'cross-origin-isolation',
  configureServer: applyHeaders,
  configurePreviewServer: applyHeaders,
}

export default defineConfig({
  // Served at the root of the bundled desktop app (its local server).
  base: '/',
  plugins: [react(), crossOriginIsolation],
  // These packages ship prebuilt WASM/ONNX artifacts that shouldn't be
  // pre-bundled by Vite's dev optimizer.
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'kokoro-js'],
  },
  worker: {
    format: 'es',
  },
})
