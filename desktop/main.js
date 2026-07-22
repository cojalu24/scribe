// Scribe desktop app — fully self-contained. The built web app is bundled
// inside the app and served from a tiny local HTTP server on 127.0.0.1, with
// the cross-origin-isolation headers the on-device AI models need. Nothing is
// loaded from the internet except the (one-time) model downloads, so the app
// works on its own with no website dependency.
const { app, BrowserWindow, desktopCapturer, session, shell } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')

// Where the bundled site lives: alongside main.js in dev, in Resources/dist
// once packaged.
const DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'dist')
  : path.join(__dirname, 'dist')

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.pdf': 'application/pdf',
  '.data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
}

// A FIXED port matters: browser storage (where the AI models are cached) is
// keyed by origin, including the port. A random port would make every launch a
// fresh origin and re-download ~1.3GB of models every time.
const PREFERRED_PORTS = [41599, 41600, 41601, 41602]

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      if (urlPath === '/') urlPath = '/index.html'
      // Keep requests inside DIST.
      const full = path.normalize(path.join(DIST, urlPath))
      if (!full.startsWith(DIST)) {
        res.writeHead(403)
        return res.end()
      }
      fs.readFile(full, (err, data) => {
        const send = (buf, ext) => {
          res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          })
          res.end(buf)
        }
        if (err) {
          // SPA fallback: serve index.html for unknown paths.
          fs.readFile(path.join(DIST, 'index.html'), (e2, idx) => {
            if (e2) {
              res.writeHead(404)
              res.end()
            } else send(idx, '.html')
          })
          return
        }
        send(data, path.extname(full))
      })
    })
    let attempt = 0
    const tryListen = () => {
      const port = PREFERRED_PORTS[attempt]
      if (port === undefined) return reject(new Error('no free port for the local server'))
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
          attempt++
          tryListen()
        } else reject(err)
      })
      server.listen(port, '127.0.0.1', () => resolve(port))
    }
    tryListen()
  })
}

async function createWindow() {
  const port = await startServer()

  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    title: 'Scribe',
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })

  // Meeting mode: hand back the screen for video (dropped by the renderer)
  // plus 'loopback' system audio to capture everyone else on a call.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' })
      })
    },
    { useSystemPicker: false },
  )

  // Real external links open in the user's browser; app navigation stays in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1')) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.loadURL(`http://127.0.0.1:${port}/`)
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
