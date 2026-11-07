# Sonant Roadmap: Pro editor features

Status from a code review (Nov 2026). ✅ done · 🟡 partly done · ⬜ not started.

## Already in place
| Feature | Status | Where |
|---|---|---|
| Undo / redo (Ctrl+Z, Ctrl+Y, buttons) | ✅ 100 full snapshots | `App.svelte` `commit/undo/redo` |
| Split at playhead (S), delete strip | ✅ | `cuts.ts` `splitAt/remove` |
| Multiple video clips, back to back | ✅ single video track | `project.ts` `Clip`, `clipAt` |
| Music / VO lanes, trim, volume | ✅ | `project.ts` `audioLanes`, `trimAudio` |
| Trim silences / remove fillers | 🟡 buttons in transcript tab; no thresholds UI or auto-run on import | `transcript.ts`, `TranscriptView.svelte` |
| Caption style presets | ✅ Classic + viral | `render.ts` `PRESETS` |
| Background removal / text behind person | ✅ per strip | `segment.ts` |
| Export aspect (source, 9:16, …), fps, quality | 🟡 no per-platform presets, crop is centre only | `ExportDialog.svelte`, `export.ts` |
| Autosave (IndexedDB) | 🟡 no version history | `App.svelte` autosave effect |
| Shortcuts | 🟡 Space, S, Del, Esc, undo/redo only; no cheat-sheet | `App.svelte` `keys()` |
| SRT / VTT export | ✅ | `captions.ts` |
| EN/ES UI | ✅ | `i18n.svelte.ts` |
| Smooth scrubbing (holds the last frame, combines seeks) | ✅ | `player.ts`, `App.svelte` draw loop |
| **Auto-select at playhead** (toggle, on by default) | ✅ | `App.svelte` `autoSelect` |

## Phase A: Timeline basics
1. ✅ **Snapping** to the playhead and to strip, caption and audio edges, with a yellow guide line. Hold Alt to drag freely; toggle with the magnet button or N.
2. 🟡 **Ripple delete**: deleting a strip or an I/O range (X / Del) already ripples. A "lift" mode that leaves a gap is moved to Phase B, because the model has no gaps until there are tracks.
3. ✅ **Trim strip edges by dragging**, now with a live preview: the preview shows the frame at the edge being trimmed.
4. ✅ **Shortcuts**: J (back 1s, Shift 5s) / K (pause) / L (play), ←/→ to step a frame, Shift+←/→ to step a second, Home/End, I/O to mark a range, X to cut it, A for auto-select, `?` for the cheat-sheet. Real reverse and multi-speed J/L come with Phase C speed control.
5. ⬜ **Undo memory**: still full snapshots (100 steps). Postponed until projects get big; revisit with the Phase B track model.

## Phase B: Tracks and layers
6. ✅ **Layer model**: `Overlay` (video, image or text) in output time, like music, so word cuts don't move layers. Array order is stacking order. Saved in the project, undoable. `lib/overlay.ts`.
7. ✅ **Picture-in-picture video and images**: images can be imported now. The ⧉ button on a video asset adds it as a layer. Layers are muted by default, with a volume slider, and their sound is mixed into the export.
8. ✅ **Text layers** separate from captions: the T+ button or T key, with editable text, font, colours, word animation from the caption renderer.
9. ✅ **Transform per layer**: drag to move (snaps to centre lines, Alt for free), corner handles to scale, top knob to rotate (snaps to 0/±90/180), arrow-key nudge. Inspector for size, rotation, opacity, crop (L/T/R/B), flip, bring forward / send backward, reset, delete.
10. ⬜ **Keyframes** for position, scale, rotation and opacity, with a "punch-in zoom" preset. Next.
11. ⬜ **Lift mode** (delete leaving a gap) and multiple main-video tracks. Next.
- Known gaps: importing a video always appends it to the main sequence (use ⧉ to add it as a layer instead); video layers show nothing for a moment while they seek; text layers use one preset look plus font and colours (the full style panel is caption-only).

## Phase C: Clip tools
11. **Speed**: 0.25–4× per strip (playbackRate in preview, resample frames in export, pitch-preserved audio), plus freeze frame.
12. **Transitions** between strips: cross-fade, dip to black, zoom, whip. These need two decoders live at the boundary (preload the next clip's `<video>`).
13. **Color**: brightness, contrast, saturation and temperature through canvas `filter` or a WebGL pass, plus .cube LUT import and filter presets.
14. **Reframe / auto-reframe**: pick the crop for 9:16 per strip and track the face with the existing segmenter mask centroid.

## Phase D: Smart features
15. **Silences and fillers**: threshold slider, preview of what will be cut, and an optional auto-run after transcription.
16. **Audio cleanup**: loudness normalize (-14 LUFS), noise reduction (RNNoise wasm), and auto-ducking of music under speech using word ranges.
17. **Beat sync**: onset detection on music peaks (`waveform.ts`), beat markers, "cut on beats".
18. **Translated captions**: a second caption language per project with a toggle in export (local model or user-supplied API key).
19. **Templates**: save and load style + layout + transitions as a template, plus built-in starters.

## Phase E: Accessibility and polish
20. **Caption accessibility preset** (high contrast, minimum size) and a **platform safe-area overlay** (TikTok, Reels, Shorts UI).
21. **Screen reader and keyboard access**: roving focus on timeline items, `aria-label`s everywhere, visible focus ring, and 44px touch targets on mobile.
22. **Version history**: keep the last N autosaves per project with restore.
23. **Export presets**: TikTok, Reels, Shorts, YouTube 1080p and 4K (aspect, fps, bitrate, loudness).
24. **Proxy media** for fast scrubbing on long or 4K files: a low-resolution, all-keyframe copy made with WebCodecs on import, used only for preview.

## Suggested order
A (1–4) → D15 → B (6–9) → C11, C12 → E20, E23 → B10 → C13, C14 → D16–19 → E21, E22, E24.
