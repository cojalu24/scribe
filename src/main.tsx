import './polyfills'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// No StrictMode: its double-invoked effects would spin up two copies of the
// TTS/Whisper workers and load the models twice.
createRoot(document.getElementById('root')!).render(<App />)
