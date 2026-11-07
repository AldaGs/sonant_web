# Sonant

Browser-based caption editor for short videos, in English and Spanish. Transcribe speech, edit by deleting words, style animated captions, combine clips with music or voiceover, make basic cuts and export an MP4 with the captions burned in. It is not a full video editor.

Everything runs locally in the browser. No server, no account, and your media never leaves your device.

## Features

- **Projects:**
  - Home page listing every project with a thumbnail, last edit and length.
  - Open, rename, duplicate, save to file or delete.
  - Autosaved in the browser. See [Projects and saving](#projects-and-saving).
- **Media:**
  - Import several videos and audio files at once by picking or dropping them.
  - Videos play back to back as a sequence; reorder or remove them from the Sequence list.
  - Audio goes onto a separate **Music & VO** track, with its own volume and a volume for the clips' own sound.
- **Transcription:**
  - Whisper runs in the browser (WebGPU, falls back to WASM).
  - English, Spanish or auto-detect, with word-level timing.
  - Transcribe **all clips or one clip**. One clip only replaces captions on that clip.
- **Text-based editing:**
  - Delete words to cut them from the video; struck words can be restored.
  - Remove filler words and trim silences.
  - Search the transcript.
  - Tag speakers by hand.
- **Captions:**
  - Edit text and timing per line; split, merge, add and delete lines.
  - Download SRT or VTT, which follow your cuts.
- **Caption styles:** the style panel has three tabs.
  - **Style:** presets. Viral pop, Active pill, Smooth rise, Cyber glitch, Neon pulse, Kinetic wave, Bold pop, Boxed, Minimal, Editorial, Tall, Marker.
  - **Animation:** None, Fade up, Pop, Elastic pop, Slide up, Slide in, Wave, Glitch, Active pill, Neon pulse, Karaoke, Typewriter (letter by letter), Bounce. Each has a duration and an easing.
  - **Text:** an inspector with:
    - Font, weight, size (px at 1080p), line height and letter spacing.
    - Text and highlight color, with a contrast check.
    - Alignment and case.
    - Fill (background box), opacity, corner radius and border.
    - Position: a 3×3 anchor grid plus exact X/Y.
- **Per-caption styles:**
  - Select one or more captions (Ctrl/⌘+click to add, Shift+click for a range) to style just those.
  - Turn on **Apply to all captions** to send changes to every caption instead.
- **Color picker:**
  - Saturation/brightness square, hue slider and hex input.
  - Eyedropper (Chrome/Edge), brand swatches and recent colors.
  - Live preview, with one undo step per drag.
- **Positioning on the preview:**
  - Drag the caption box (or its round handle) to move it. Touch gets a larger grab area.
  - Arrow keys nudge it; Shift moves it further.
- **Animated titles:** **Animated title** in the toolbar adds a text layer on top of the stack that fades and scales in, then out, while travelling left to right along a horizontal S curve. In the layer inspector, set the in and out times, how far it travels and how deep the curve bends, or switch to plain in & out with no path. The curve is shown as a dashed guide in the preview; drag the layer to move the whole path.
- **Fonts:** bundled free OFL fonts, plus your own fonts from your PC (Chrome/Edge) or uploaded files.
- **Timeline:**
  - Rows for video thumbnails, clip waveform, caption blocks, text animation, and Music & VO lanes. Overlapping audio stacks into lanes.
  - Time ruler and zoom.
  - Split, delete, trim and undo/redo.
  - Drag caption and audio blocks to move them, or drag their **edges** to retime captions and trim audio.
- **Export:**
  - MP4 (H.264) via WebCodecs. Audio mixes the clips' sound with the music and voiceover.
  - Quality: Draft, Standard or High.
  - Resolution: Original, 1080p, 720p, 540p or 480p.
  - Shape: 9:16, 16:9 or 1:1.
  - Frame rate: 24, 30 or 60 fps.
- **Interface:** English and Spanish. Works on desktop and phone-sized screens.

## Projects and saving

- **Home page** (`#/`): every project as a card. Click to open it (`#/p/<id>`). The ⋯ menu renames, duplicates, saves to file or deletes it. Duplicates share media files, so they take no extra space.
- **Autosave**: each project is saved in the browser (IndexedDB) about half a second after every change.
- **Project files** (`.sonant`): one file with the media and all edits.
  - **Save file** (Ctrl/⌘+S) writes it.
  - In Chrome/Edge later saves go to the same file, and Shift+Ctrl+S picks a new one. Other browsers download it.
  - **Open project file** on the home page, or dropping the file on the page, loads it on any computer.
  - Damaged or non-Sonant files are rejected.
- **Storage protection**:
  - The app asks the browser not to auto-delete projects. The home page shows space used and whether projects are protected.
  - Browsers decide whether to grant this; Chrome usually does for sites you use often, bookmark or install. Keep project files as backups.
- **Upgrading**: projects from the older single-project version are moved to the home page automatically on first load.

## Run it

Requires Node 20+ and a recent Chrome or Edge. Firefox and Safari work, but slower; the eyedropper and installed-font access are Chrome/Edge only.

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173. The first transcription downloads the Whisper model (~80 MB), which the browser caches for later runs.

```bash
npm run build      # production build in app/dist
npm run check      # type check
```

## Tests

The logic modules have small assert-based tests that run directly in Node (TypeScript runs natively on Node 23.6+):

```bash
cd app
for t in captions render cuts export transcript waveform project projects; do node src/lib/$t.test.ts; done
```

## Stack

| Piece | Tool |
|---|---|
| UI | Svelte 5 + Vite + TypeScript |
| Transcription | [transformers.js](https://github.com/huggingface/transformers.js) + Whisper (`onnx-community/whisper-base_timestamped`) in a Web Worker |
| Preview and caption rendering | Canvas 2D, shared by preview and export |
| Playback | One clock driving a hidden `<video>` per clip and an `<audio>` per music/VO item |
| Export | WebCodecs + [Mediabunny](https://github.com/Vanilagy/mediabunny); audio mixed with `OfflineAudioContext` |
| Color picker | [vanilla-colorful](https://github.com/web-padawan/vanilla-colorful) |
| Storage | IndexedDB; `.sonant` files for backup and sharing |

## Project layout

```
app/src/
  main.ts                 mounts Root
  Root.svelte             routing: home (#/) or editor (#/p/<id>); first-run migration
  App.svelte              the editor: layout, state, playback loop, autosave, shortcuts
  lib/
    Home.svelte           project list, open/new/import, storage status
    TranscriptView.svelte transcript with word cutting, search, fillers, speakers
    Timeline.svelte       ruler, video/audio/caption/animation/music rows, drag & trim
    StylePanel.svelte     Style / Animation / Text tabs, per-caption scope
    ColorField.svelte     color picker popover
    ExportDialog.svelte   export settings and progress
    projects.ts           project list, docs, duplicate/delete, .sonant pack/unpack, storage
    project.ts            clip sequence, remapping on reorder, audio lanes and trimming
    player.ts             multi-clip playback clock
    assets.ts             media import, probing, file-type detection
    captions.ts           caption model, grouping, editing, SRT/VTT
    cuts.ts               kept segments, sequence↔output time mapping, word cuts
    transcript.ts         filler words, silences, search
    render.ts             caption drawing, presets, animations, easing, drag box
    export.ts             MP4 export (video + captions + mixed audio)
    transcribe.ts         audio decode + worker bridge
    whisper.worker.ts     Whisper in a Web Worker
    waveform.ts           audio peaks, ruler ticks
    thumbs.ts             video thumbnails
    fonts.ts              bundled, installed and uploaded fonts
    store.ts              IndexedDB key/value
    i18n.svelte.ts        English/Spanish strings
public/                   favicon, app icon, web app manifest
icon/                     (repo root) Sonant mark, lockups and usage guide
```

`PLAN.md` holds the original implementation plan. `DESIGN_FEATURES.md` tracks progress against the design mock (`Video Editor — Transcript, Captions & Animation.html`).

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play/pause |
| S | Split at playhead |
| Delete | Cut or restore selected words (Transcript tab), remove the selected audio item, or delete the selected timeline segment |
| ← / → | Move the word selection in the transcript (Shift extends it) |
| Arrows (preview focused) | Nudge the caption; Shift for bigger steps |
| Esc | Clear the caption selection |
| Ctrl/⌘+click, Shift+click | Add a caption to the selection, or select a range |
| Ctrl/⌘+S | Save the project file (Shift picks a new file) |
| Ctrl/⌘+Z / Ctrl/⌘+Y | Undo / redo |

## Known limits

- Speaker labels are manual; there is no automatic speaker detection.
- Clips play whole and in sequence (cut inside them with the transcript or timeline); there are no overlaps or transitions between clips.
- Music and voiceover play in output time, so cutting words does not move them, and they are not transcribed.
- Projects live in one browser on one device; use `.sonant` files to move or back them up. There is no cloud sync.
- Very large files (over ~2 GB) can run out of browser memory or storage quota.
- Filler removal only targets hesitation sounds (um, uh, eh…). Words like "like" or "este" are left alone.
