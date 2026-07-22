# Scribe

A Mac app for working through research and meetings — everything runs
**on your device**, nothing is uploaded.

- **Read a paper aloud** and capture your thoughts by voice or text as you go.
  The paper displays as the real PDF; the current sentence is highlighted as
  it's read; your notes anchor to the exact spot. Export a highlighted PDF or
  clean notes for Claude.
- **Record a meeting** and get a live, speaker-labeled transcript (your mic vs.
  the rest of the call), then export it for clean notes.

Speech-to-text (Whisper) and text-to-speech (Kokoro) run locally in the
browser engine via WebGPU; the models download once and are cached.

## Project layout

- `src/` — the app itself (React + Vite + TypeScript).
- `desktop/` — a small Electron wrapper that bundles the built app and serves
  it locally, so it runs fully self-contained with the fast GPU engine.

## Develop

```bash
npm install
npm run dev
```

## Build the Mac app

```bash
cd desktop
./build.sh
```

This builds the web app, bundles it into the Electron shell, ad-hoc signs it,
and produces `desktop/Scribe-mac.zip`.

> The app is not signed with a paid Apple certificate, so the first launch
> after downloading needs a right-click → Open (or System Settings → Privacy &
> Security → Open Anyway).

## License

MIT — see [LICENSE](LICENSE).
