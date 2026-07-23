// Scribe's offline layer.
//
// Two caches:
//  - shell: the app itself (HTML, hashed JS/CSS, fonts, pdf.js support files)
//  - models: the AI model downloads (Kokoro voice, Whisper) — large,
//    immutable-by-URL files fetched from HuggingFace's CDN. Cached forever so
//    the app works offline and never re-downloads them.
const SHELL_CACHE = 'scribe-shell-v1'
const MODEL_CACHE = 'scribe-models-v1'

const MODEL_HOSTS = ['huggingface.co', 'hf.co', 'xethub.hf.co', 'cas-bridge.xethub.hf.co']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['./', './index.html'])).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Model downloads: cache-first, permanent.
  if (MODEL_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    event.respondWith(cacheFirst(MODEL_CACHE, request))
    return
  }

  if (url.origin === self.location.origin) {
    // The app entry: network-first so updates arrive, cache fallback offline.
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(SHELL_CACHE, request, './index.html'))
      return
    }
    // Everything else same-origin (hashed assets, fonts, pdfjs, wasm):
    // cache-first — filenames change when content changes.
    event.respondWith(cacheFirst(SHELL_CACHE, request))
  }
})

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request, { ignoreVary: true })
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok || response.type === 'opaqueredirect') {
    cache.put(request, response.clone()).catch(() => {})
  }
  return response
}

async function networkFirst(cacheName, request, fallbackKey) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(fallbackKey, response.clone()).catch(() => {})
    return response
  } catch {
    const hit = (await cache.match(request)) || (await cache.match(fallbackKey))
    if (hit) return hit
    throw new Error('offline and not cached')
  }
}
