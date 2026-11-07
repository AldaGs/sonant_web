# Sonant: "Pro" features plan

These are features CapCut keeps behind Pro. Sonant can offer them for free because everything runs in the browser. The list comes from a code review (Nov 2026) and skips anything already in `ROADMAP.md`.

The order goes from cheapest and most reusable to biggest. Each phase reuses code from earlier ones: word timings, the WebGL2 shader, the audio pipeline and the project model.

Status: ✅ done · 🟡 partly done · ⬜ not started.

## Phase 0: Auto-emphasis on keywords ✅
Captions already have word timings and a highlight color. This phase adds the part that picks the words.
- ✅ `Word.em` flag. An emphasized word is always drawn in the highlight color, in preview and export (`render.ts`).
- ✅ `lib/keywords.ts`: scores each word using numbers and money, proper nouns, long words, words in caps and words after "!". It skips English and Spanish stop words and fillers. It marks up to *N* words per caption (1 by default).
- ✅ **Auto-emphasis** and **Clear** buttons in the Captions tab, each one undo step.
- ✅ Tests: `node src/lib/keywords.test.ts`.
- Later: let users mark or unmark one word by clicking it in the caption list. Optional scale or colour for emphasized words (an `emScale` style field). Translated captions don't carry the emphasis over yet.

## Phase 1: Smart auto-zoom ✅
Builds on Phase 0.
- ✅ `lib/autozoom.ts`: a zoom moment at each emphasized word, and optionally at sentence starts, with a minimum gap. Each one eases in over 0.18s, holds until 0.6s after the word, then eases out over 0.35s. Zooms never overlap.
- ✅ It stacks on top of the strip punch-in and focus point, and it's the same in preview and export. Moments are in sequence time, so cutting a word drops its zoom.
- ✅ Captions tab: **Auto-zoom on key words**, with strength (+5–35%), minimum gap (1–8s), "also at sentence starts" and a zoom count. Saved with the project.
- ✅ Tests: `node src/lib/autozoom.test.ts`.
- Later: show the zooms on the timeline, and let a single zoom be removed or nudged. Zoom toward the speaker's face (reuse the segmenter) instead of the frame centre.

## Phase 2: Chroma key, blend modes, masks ⬜
These live in the shader and layer code.
- Chroma key for video and image layers: pick the key colour with the eyedropper, plus tolerance, softness and spill controls, in `grade.ts` (WebGL2).
- `Overlay.blend`: normal, multiply, screen, overlay, add, using canvas `globalCompositeOperation`.
- Masks: rectangle, ellipse and linear, with feather and invert, in `overlay.ts`.

## Phase 3: AI noise reduction / voice isolation ⬜
- RNNoise (WASM) in an AudioWorklet for the preview, and offline in export (`audio.ts`). Include a strength mix.
- Replace or extend the current "Voice cleanup" (rumble filter plus compressor), which only applies on export.

## Phase 4: Effects pack ⬜
- Vignette, film grain, glow/bloom, RGB split and camera shake on punch-ins, in the `grade.ts` shader. Motion blur on zoom and whip transitions (`transitions.ts`).
- Reverse strip, which needs reversed frame decoding in export, plus a proxy for the preview.
- Progress-bar and emoji/sticker layers as built-in templates (`templates.ts`).

## Phase 5: Text-to-speech voiceover ⬜
- A local TTS model (Kokoro or Piper, ONNX in a worker, the same pattern as Whisper). It turns a script or the selected captions into a clip on the Music & VO track. Voices in EN and ES.

## Phase 6: Auto-clips (long video → shorts) ⬜
- Score transcript sentences for hooks, questions, numbers, emphasis (Phase 0) and audio energy. Suggest 15–60s ranges.
- "Make short" duplicates the project trimmed to that range, in 9:16 with Follow person on.

## Phase 7: Automatic speaker detection ⬜
- Speaker embeddings (an ONNX model in a worker) plus clustering on Whisper segments. This fills in `Caption.speaker`, which is tagged by hand today.

## Phase 8: Stabilization and the rest ⬜
- Stabilization: estimate motion frame to frame (block matching on the proxy), smooth it, then crop. Run once and cache it like the proxy.
- Voice changer (pitch via `stretch.ts`). Pack LUTs into `.sonant` files. Web Share for the exported MP4.
