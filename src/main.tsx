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
}
