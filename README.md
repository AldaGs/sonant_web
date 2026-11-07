# Sonant

Browser-based caption editor for short videos, in English and Spanish. Transcribe speech, edit by deleting words, style animated captions, make basic cuts and export an MP4 with captions burned in. It is not a full video editor.

Everything runs locally in the browser. No server, no account, and your video never leaves your device.

## Features

- **Transcription:** Whisper running in the browser (WebGPU, falls back to WASM), English, Spanish or auto-detect, with word-level timing.
- **Text-based editing:**
  - Delete words to cut them from the video; struck words can be restored.
  - Remove filler words and trim silences.
  - Search the transcript.
  - Tag speakers by hand.
- **Captions:**
  - Edit text and timing per line; split, merge, add and delete lines.
  - Download SRT or VTT, which follow your cuts.
- **Styles:**
  - Presets: Bold pop, Boxed, Minimal, Editorial, Tall, Marker.
  - Animations: None, Fade up, Pop, Typewriter (letter by letter), Karaoke, Bounce.
  - Animation duration and easing.
  - Advanced: font, size, colors, outline, background box, uppercase, italic.
- **Fonts:** bundled free OFL fonts, plus your own fonts from your PC (Chrome/Edge) or uploaded files.
- **Timeline:**
  - Rows for video thumbnails, audio waveform, caption blocks and text animation, with a time ruler and zoom.
  - Split, delete, trim and undo/redo.
  - Drag caption blocks to retime them.
- **Export:**
  - MP4 (H.264) via WebCodecs.
  - Quality: Draft, Standard or High. Resolution: Original, 1080p, 720p, 540p or 480p.
  - Shape: 9:16, 16:9 or 1:1. Frame rate: 24, 30 or 60 fps.
- **Autosave:** the project is saved in the browser (IndexedDB) and restored on reload.
- **Interface:** English and Spanish.

## Run it

Requires Node 20+ and a recent Chrome or Edge. Firefox and Safari work, but slower.

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173. The first transcription downloads the Whisper model (~80 MB). The browser caches it for later runs.

```bash
npm run build      # production build in app/dist
npx svelte-check   # type check
```

## Tests

The logic modules have small assert-based tests that run directly in Node (TypeScript runs natively on Node 23.6+):

```bash
cd app
for t in captions render cuts export transcript waveform; do node src/lib/$t.test.ts; done
```

## Stack

| Piece | Tool |
|---|---|
| UI | Svelte 5 + Vite + TypeScript |
| Transcription | [transformers.js](https://github.com/huggingface/transformers.js) + Whisper (`onnx-community/whisper-base_timestamped`) in a Web Worker |
| Preview and caption rendering | Canvas 2D, shared by preview and export |
| Export | WebCodecs + [Mediabunny](https://github.com/Vanilagy/mediabunny) |
| Storage | IndexedDB |

## Project layout

```
app/src/
  App.svelte              layout, state, persistence, keyboard shortcuts
  lib/
    captions.ts           caption model, grouping, editing, SRT/VTT
    cuts.ts               kept segments, source↔output time mapping, word cuts
    transcript.ts         filler words, silences, search
    render.ts             caption drawing, presets, animations, easing
    export.ts             MP4 export (video + captions + audio)
    transcribe.ts         audio decode + worker bridge
    whisper.worker.ts     Whisper in a Web Worker
    waveform.ts           audio peaks, ruler ticks
    store.ts              IndexedDB key/value
    i18n.svelte.ts        English/Spanish strings
    *.svelte              TranscriptView, Timeline, StylePanel, ExportDialog
```

`PLAN.md` holds the original implementation plan. `DESIGN_FEATURES.md` tracks progress against the design mock (`Video Editor — Transcript, Captions & Animation.html`).

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play/pause |
| S | Split at playhead |
| Delete | Cut or restore selected words (Transcript tab), or delete the selected timeline segment |
| ← / → | Move the word selection (Shift extends it) |
| Ctrl+Z / Ctrl+Y | Undo / redo |

## Known limits

- Speaker labels are manual; there is no automatic speaker detection.
- Clips play whole and in sequence (cut inside them with the transcript or timeline); there is no overlap or transitions between clips.
- Music and voiceover play in output time, so cutting words does not move them; they are not transcribed.
- Very large files (> ~2 GB) can run out of browser memory.
- Filler removal only targets hesitation sounds (um, uh, eh…). Words like "like" or "este" are left alone.
