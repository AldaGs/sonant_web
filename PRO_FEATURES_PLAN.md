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

## Phase 2: Chroma key, blend modes, masks ✅
All of it is in `lib/layerfx.ts` and goes through `drawOverlay`, so preview and export match.
- ✅ **Chroma key** for video and image layers: key colour, tolerance, edge softness and spill removal. Distance is measured in chroma, so dark and bright shades of the screen key out while greys, skin, black and white stay. It runs on the CPU at no more than 1280px per layer per frame. (I chose this over WebGL because it's simpler; move it to `grade.ts` if it's slow on 4K layers.)
- ✅ **Blend modes** on every layer, text too: normal, multiply, screen, overlay, add, darken, lighten, difference.
- ✅ **Masks** on media layers: ellipse, rectangle or linear, with size/angle/position, feather and invert.
- ✅ Layer inspector: a Blend menu, plus "Chroma key" and "Mask" sections. Saved and undoable like other layer edits.
- ✅ Tests: `node src/lib/layerfx.test.ts`. I also ran a browser check of the canvas masks and key.
- Later: masks that follow keyframes.

## Phase 2b: Performance settings, key eyedropper, green screen on strips ✅
- ✅ **Performance** dialog (⚙ in the editor header). It's per device and stored in localStorage (`lib/perf.ts`).
  - Shows the GPU name and whether WebGPU and WebGL2 are available.
  - Acceleration has three options. **Auto** uses the GPU unless it's software-only (SwiftShader, llvmpipe). **GPU** always uses it. **CPU only** never does.
  - Acceleration controls three things: Whisper (WebGPU or WASM, which switches on the next run), the person segmenter (MediaPipe GPU or CPU delegate) and the chroma key.
  - **Chroma key resolution**: Auto (full on GPU, 1280px on CPU), 1920, 1280 or 720.
- ✅ **GPU chroma key**: a WebGL2 shader with the same maths as the CPU key. A browser test shows identical pixels.
- ✅ **Key eyedropper**: "Pick from preview" switches keys off in the preview, and a click samples a 7×7 average there. Esc cancels. It works in every browser, unlike the system EyeDropper.
- ✅ **Chroma key on main-video strips**: the keyed area shows the strip's Background (colour, image or blur; black when it's set to Original). "Text behind" puts captions and layers under the keyed person with no segmentation model.
- ✅ Tests: `node src/lib/perf.test.ts`.

## Phase 3: AI noise reduction ✅
- ✅ **RNNoise** via `@shiguredo/rnnoise-wasm` (Apache-2.0; RNNoise itself is BSD). It runs in a worker (`lib/denoise.worker.ts`), and the ~5 MB WASM only downloads the first time it's used.
- ✅ **AI noise reduction** in the Sequence panel: Off, Light (50%), Medium (80%) or Strong (100% cleaned). It's saved with the project.
- ✅ Each video clip's sound is cleaned once per level at 48 kHz, with the model's 960-sample delay removed (measured in Chromium). The result is cached in IndexedDB (`clean:<asset>:<level>`) and removed when the project's media is deleted.
- ✅ The preview plays the cleaned copy in sync with the muted video: same rate, and it re-syncs if it drifts more than 80 ms. Export mixes the cleaned copy instead of the file's sound, so it can be combined with Voice cleanup and loudness.
- ✅ Tests: `node src/lib/denoise.test.ts` (framing, delay compensation, mix, WAV). In a browser test, a noisy clip on Medium went from −36 to −50 dB in a noise-only stretch.
- Note: RNNoise is trained on speech, so it also lowers music and pure tones. Use it on talking clips, not music.
- Later: apply it to video layers and voiceover items. Optionally a stronger model (DeepFilterNet) as a "High quality" choice when the GPU setting allows.

## Phase 4: Effects pack 🟡
- ✅ **Effects in the colour shader** (`grade.ts`, WebGL2, preview and export): vignette, film grain (changes 24 times a second), glow/bloom and RGB split. Each has a slider in the strip's Color panel and on the phone colour sheet. There are new looks too: Film, Dreamy, Glitch and VHS.
- ✅ **Camera shake**: a **Shake** menu on each strip (none, subtle, medium or strong handheld wobble). Auto-zoom has a **Shake as each zoom lands** option, a 0.45s burst. The frame is enlarged slightly so no edges show (`autozoom.ts`).
- ✅ **Zoom blur** on the zoom transition, for both the outgoing and incoming frames. The whip transition already had blur.
- ✅ **Progress bar** template: a layer across the whole video. Its colour, track, thickness and top/bottom position can be changed.
- ✅ **Stickers** templates: 🔥, 😱 WOW, 👍 Like & subscribe and 👉. These are emoji text layers that pop in. Stickers and the progress bar leave the caption style alone.
- ✅ Tests: shake bounds and coverage (`autozoom.test.ts`), bar placement and progress (`templates.test.ts`). In a browser test, every shader effect changed the pixels as expected, and the bar and sticker rendered over a video.
- ⬜ **Reverse strip**: postponed. The browser can't play a `<video>` backwards, so the preview would have to step through frames one at a time, which is choppy without decoding to a reversed proxy first. Plan: build a reversed proxy (WebCodecs, like `proxy.ts`) and reversed audio, then use them in both preview and export.

## Phase 5: Text-to-speech voiceover ✅ (synthesis not tested here)
- ✅ **Two local engines** (`lib/tts.ts`). Both download on first use and are cached by the browser.
  - **Kokoro** (`kokoro-js`, Apache-2.0): 10 English voices, US and UK, picked from its best-graded ones. It runs in a worker (`tts.worker.ts`): WebGPU fp32 (~330 MB) when the Performance setting allows the GPU, otherwise WASM q8 (~90 MB). It has a speed control.
  - **Piper** (`@mintplex-labs/piper-tts-web`, MIT): 4 English voices and 4 Spanish (MX: Claude ★, Ald; ES: Sharvard, Davefx), 60–120 MB each.
- ✅ Defaults: Spanish uses Piper Claude. English uses Kokoro Heart on a device with fast WebGPU, otherwise Piper (Kokoro on CPU is slow).
- ✅ **AI voiceover** panel (Assets panel, under the clip audio):
  - **Script** mode adds one clip at the playhead.
  - **Captions (dub)** mode reads each caption (only the selected ones, if any are selected) and places each clip at that caption's time. With translation shown, it reads the translation, which makes a dub.
  - **Preview voice** plays a sample sentence.
  - Long text is split into sentences of ≤400 characters, and the pieces are joined with short pauses.
  - Clips go on the Music & VO track as ordinary audio assets, in one undo step, so they can be trimmed, ducked and exported.
- ✅ Tests: `node src/lib/tts.test.ts` (catalogue, defaults, splitting, joining). In a browser, the panel, voice lists and error handling work. Downloads from Hugging Face are blocked in this sandbox, so **real synthesis hasn't been heard yet**.
- Notes:
  - Both engines use eSpeak NG (GPL-3) for pronunciation, which is fine for a free app.
  - Piper voices each have their own dataset licence (see each voice's MODEL_CARD); check them before any commercial release.
  - Piper also loads its runtime from jsDelivr and cdnjs.
- Later: put Kokoro's Spanish voices in once kokoro-js supports them. Per-caption speed fitting, so a dub fits each caption's time.

## Phase 6: Auto-clips (long video → shorts) ⬜
- Score transcript sentences for hooks, questions, numbers, emphasis (Phase 0) and audio energy. Suggest 15–60s ranges.
- "Make short" duplicates the project trimmed to that range, in 9:16 with Follow person on.

## Phase 7: Automatic speaker detection ⬜
- Speaker embeddings (an ONNX model in a worker) plus clustering on Whisper segments. This fills in `Caption.speaker`, which is tagged by hand today.

## Phase 8: Stabilization and the rest ⬜
- Stabilization: estimate motion frame to frame (block matching on the proxy), smooth it, then crop. Run once and cache it like the proxy.
- Voice changer (pitch via `stretch.ts`). Pack LUTs into `.sonant` files. Web Share for the exported MP4.
