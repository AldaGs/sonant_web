# Web Text Animator — Implementation Plan

Browser app: upload a video → auto-transcribe (EN/ES) → edit captions → animate text → basic cuts → export MP4.
Everything runs client-side. No server, no cost, video never leaves the device.

## Stack

| Piece | Choice | Why |
|---|---|---|
| UI framework | **Svelte 5 + Vite** | Compiles away, tiny runtime, fine-grained reactivity. Fast timeline/caption updates without virtual-DOM diffing. |
| Language | TypeScript | Catches timestamp/segment bugs early. |
| Transcription | transformers.js + Whisper (`whisper-base`, upgrade to `small`) on WebGPU, WASM fallback | Free, local, EN+ES, word timestamps. |
| Preview render | `<video>` + `<canvas>` 2D | One draw loop for video frame + captions = preview matches export. |
| Animation | Own keyframe/easing functions (anime.js only if needed) | Caption animations are simple math on time; no lib needed yet. |
| Export | WebCodecs + Mediabunny (MP4 mux) | Hardware encoding, far faster than ffmpeg.wasm. |
| Fallback export | ffmpeg.wasm | Only for browsers without WebCodecs (old Safari/Firefox). |
| Fonts | Bundled OFL fonts (self-hosted woff2) + optional user fonts via Local Font Access API (Chromium) or font file upload | Same look on every machine; user fonts as a bonus. |
| Storage | IndexedDB (project JSON + video blob) | Survive page reload. |

Speed rule: heavy work (Whisper, encoding) runs in **Web Workers**, never on the UI thread.

Browser target: Chrome/Edge first (WebGPU + WebCodecs). Others: degraded but working.

## Data model (the whole app hangs off this)

```ts
type Word    = { text: string; start: number; end: number };          // seconds
type Caption = { id: string; words: Word[]; styleId: string };
type Segment = { start: number; end: number };                        // kept ranges of source video
type Style   = { font: string; size: number; color: string; highlight: string;
                 animation: 'none'|'pop'|'karaoke'|'typewriter'|'bounce'; position: {x:number;y:number} };
type Project = { videoId: string; language: 'en'|'es'; segments: Segment[];
                 captions: Caption[]; styles: Style[] };
```

Cuts never touch caption timestamps: captions stay in source time, and segments map source → output time.

## Phases

### Phase 0 — Setup
- [x] `npm create vite@latest` (Svelte + TS)
- [x] Single page layout: video preview, caption list, timeline strip, export button
- [x] Load local video file → `<video>` via object URL

### Phase 1 — Transcription
- [x] Whisper worker (transformers.js), model downloads once and is cached by the browser
- [x] Language picker EN / ES / auto-detect
- [x] Progress bar while transcribing
- [x] Word-level timestamps → group into captions (max ~6 words or ~2.5s per line)
- **Check:** 1-min EN clip and 1-min ES clip transcribe with sensible words + timings

### Phase 2 — Caption editing
- [x] Caption list: edit text, split/merge lines, nudge start/end
- [x] Click caption → seek video
- [x] Export SRT / VTT
- **Check:** edited SRT loads correctly in VLC

### Phase 3 — Canvas preview + animation
- [x] rAF loop: draw video frame + active caption on canvas
- [x] Animations: pop, karaoke word highlight, typewriter, bounce (pure functions of time)
- [x] Style panel: font, size, color, highlight color, position (drag on canvas)
- [x] 4–6 built-in presets (our own designs)
- [x] Fonts: ship ~8–10 OFL fonts (e.g. Montserrat, Poppins, Bebas Neue, Anton, Inter, Roboto, Lobster, Permanent Marker) with full Latin + Spanish accents; load with `FontFace` before drawing
- [x] "Use my fonts" button: `queryLocalFonts()` in Chrome/Edge (asks permission); upload .ttf/.otf/.woff2 elsewhere. Saving uploaded fonts with the project → Phase 6
- **Check:** 60fps preview on a 1080p video on a mid laptop

### Phase 4 — Basic cuts
- [x] Timeline strip with thumbnails + playhead
- [x] Split at playhead, delete segment, trim segment edges
- [x] Preview plays only kept segments (skip gaps)
- [x] Undo/redo (snapshot history of `Project`)
- [x] **Check:** captions stay in sync after cutting the middle out (verified: SRT shifts, cut words dropped)

### Phase 5 — Export
- [x] Decode source → draw frame + captions → WebCodecs H.264 → Mediabunny MP4 (main thread, async; worker only if UI stutters during export)
- [x] Audio: re-encode only kept segments, silence-padded to stay in sync
- [x] Resolution options: source, 1080p, 720p; aspect presets 9:16 / 16:9 / 1:1; 24/30/60 fps
- [ ] ~~ffmpeg.wasm fallback~~ skipped: Chrome, Edge, Firefox and Safari all ship WebCodecs now; unsupported browsers get a clear message
- **Check:** 1-min 1080p export takes under ~1 min in Chrome; output plays in phone gallery

### Phase 6 — Persistence + polish
- [x] Save uploaded fonts to IndexedDB with the project
- [x] Autosave project to IndexedDB, restore on reload
- [x] Keyboard shortcuts: space play, S split, Del delete, Ctrl+Z
- [x] Spanish UI strings (simple key→string map, no i18n lib)

## Out of scope (for now)
- Multi-track timeline, transitions, effects, filters, music library
- Accounts / cloud sync / server-side transcription
- Add only if real users need them. Server Whisper (faster-whisper) is the first upgrade if browser transcription is too slow for long videos.

## Risks
- Whisper on weak laptops: slow for long videos → default to `whisper-base`, offer `small` as "accurate" mode.
- Files > ~2 GB: browser memory limits → warn the user.
- Safari/Firefox WebCodecs gaps → ffmpeg.wasm fallback, slower.
