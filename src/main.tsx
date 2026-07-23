import './polyfills'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// No StrictMode: its double-invoked effects would spin up two copies of the
// TTS/Whisper workers and load the models twice.
createRoot(document.getElementById('root')!).render(<App />)

// Offline support (installed web app on iPhone, GitHub Pages hosting).
// Skipped inside the desktop (Electron) shell, which serves everything
// locally and needs no caching layer.
const isElectron = /electron/i.test(navigator.userAgent)
if (import.meta.env.PROD && !isElectron && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {})
  // Ask the browser to protect our storage (the cached AI models) from
  // eviction — matters on iPhone.
  navigator.storage?.persist?.().catch(() => {})

  // Phones use q8 weights; evict any fp32 leftovers from before that switch
  // (a crashed first run could have cached hundreds of MB we'll never use).
  if (/iPhone|iPad|Android/i.test(navigator.userAgent) && 'caches' in window) {
    caches
      .open('transformers-cache')
      .then(async (cache) => {
        for (const req of await cache.keys()) {
          if (/fp32|fp16/.test(req.url)) cache.delete(req).catch(() => {})
        }
      })
      .catch(() => {})
  }
}
