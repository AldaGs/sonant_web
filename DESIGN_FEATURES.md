# Design → Feature List

Source: `Video Editor — Transcript, Captions & Animation.html` ("Sonant" mock).
Status compares against the current app in `app/`.

**Legend:** ✅ have it · 🟡 partly there, needs work · ❌ missing

---

## 1. Layout & shell
| # | Feature | Status | Notes |
|---|---|---|---|
| 1.1 | 4-zone layout: Assets (left) · Transcript/Captions (center-left) · Preview (center) · Style (right) · Timeline (bottom) | ✅ | Today: preview + one side panel + footer timeline. Needs re-layout. |
| 1.2 | Brand header: logo + name ("Sonant") | ✅ | Rename from "Text Animator", add icon. |
| 1.3 | Editable project name in header | ✅ | Store in project doc. |
| 1.4 | "Saved" status pill (Saving… / Saved) | ✅ | Autosave exists; no visible status. |
| 1.5 | Collapsible Assets panel (header toggle + ‹ button) | ✅ | |
| 1.6 | Visual theme: dark UI, lime accent (#d4f56a-ish), monospace timecodes | ✅ | Swap CSS tokens in `app.css`. |
| 1.7 | Mobile layout: panels stack vertically | ✅ | Basic stacking exists; match design order. |

## 2. Assets panel (media library)
| # | Feature | Status | Notes |
|---|---|---|---|
| 2.1 | "+ Import media" (multiple files, video + audio) | 🟡 | Today: one video at a time. |
| 2.2 | Filter tabs: All / Video / Audio | ❌ | |
| 2.3 | Asset grid with thumbnail + duration badge + filename | ❌ | Thumbnail code exists (`thumbs.ts`). |
| 2.4 | Drag asset onto timeline to add | ❌ | |
| 2.5 | Persist all imported assets (IndexedDB) | 🟡 | Today stores one video. |

## 3. Transcript tab (text-based editing)
| # | Feature | Status | Notes |
|---|---|---|---|
| 3.1 | Transcript shown as paragraphs with timestamp | ✅ | Words + timings already exist; need paragraph grouping. |
| 3.2 | Speaker labels (Speaker 1 / Speaker 2, colored) | ✅ | Manual tagging: per paragraph or per selected words; rename speakers; colors. Automatic detection not built. |
| 3.3 | Delete a word → cuts that time range from the video | ✅ | Maps to `cuts.ts` (remove word's start–end). Core feature of the design. |
| 3.4 | Struck-through display of removed words (restorable) | ✅ | Click struck word to restore. |
| 3.5 | Search transcript | ✅ | Highlight matches, jump to time. |
| 3.6 | "Remove filler words (N)" with count | ✅ | Word list EN (um, uh, like, you know…) + ES (eh, este, o sea, pues, bueno…). |
| 3.7 | "Trim silences" | ✅ | Use gaps between word timestamps (> ~0.6s) → cuts. |
| 3.8 | Click a word → seek to it; current word highlighted while playing | ✅ | |

## 4. Captions tab
| # | Feature | Status | Notes |
|---|---|---|---|
| 4.1 | Caption line list with start/end timecodes (00:00.00) | ✅ | Restyle to match. |
| 4.2 | Edit text and timing per line | ✅ | |
| 4.3 | Active line highlighted | ✅ | |
| 4.4 | "+ Add caption line" | ✅ | Insert at playhead with default 2s. |
| 4.5 | Captions generated from transcript, split by phrase | ✅ | `groupWords`. |
| 4.6 | Split / merge / delete per line | ✅ | Not shown in design; keep in a hover menu. |

## 5. Preview & transport
| # | Feature | Status | Notes |
|---|---|---|---|
| 5.1 | Canvas preview with animated captions | ✅ | |
| 5.2 | "Animation: Karaoke" badge on preview | ✅ | Trivial. |
| 5.3 | Rewind / Play / Forward buttons | ✅ | Have play; add skip back/forward (±5s or prev/next caption). |
| 5.4 | Timecode with milliseconds `00:00:08.12 / 00:01:42.00` | ✅ | Today `m:ss`. |
| 5.5 | Preview zoom −/+ and Fit toggle | ✅ | CSS scale on canvas. |

## 6. Caption style panel (right)
| # | Feature | Status | Notes |
|---|---|---|---|
| 6.1 | Style preset cards with "Aa" preview: Bold pop, Boxed, Minimal, Editorial | ✅ | Have 6 presets as plain buttons; design wants 4 visual cards. |
| 6.2 | **Boxed** style (text on a background box) | ✅ | Needs background-box rendering in `render.ts`. |
| 6.3 | **Editorial** style (serif italic) | ✅ | Add a serif OFL font (e.g. Playfair Display / DM Serif). |
| 6.4 | Text animation list with descriptions | ✅ | Have a dropdown; restyle as list. |
| 6.5 | Animation: None, Pop, Karaoke | ✅ | |
| 6.6 | Animation: **Fade up** (line rises in) | ✅ | New in `wordState`. |
| 6.7 | Animation: **Typewriter letter by letter** | ✅ | Ours is word by word. |
| 6.8 | Timing: Duration (ms) input | ✅ | Animation duration is hardcoded (180ms pop etc.). |
| 6.9 | Timing: Easing select (Ease out, Linear, Ease in-out, Back…) | ✅ | |
| 6.10 | Font, size, colors, uppercase, position drag | ✅ | Not in design → keep under "Advanced" or drop. |

## 7. Timeline
| # | Feature | Status | Notes |
|---|---|---|---|
| 7.1 | Time ruler with labels (0:00, 0:20 …) | ✅ | |
| 7.2 | Zoom −/+ (horizontal scroll when zoomed) | ✅ | |
| 7.3 | Split at playhead | ✅ | |
| 7.4 | Video track with **multiple clips** in sequence | ❌ | Today: one source video, cut into segments. Big change: multi-source model + export concatenation. |
| 7.5 | Audio track with waveform | ✅ | Compute peaks from decoded audio (already decoded for Whisper). |
| 7.6 | Separate audio files (voiceover, music bed) mixed in | ❌ | Needs multi-track audio mix in export (OfflineAudioContext). |
| 7.7 | Captions track (one block per line, draggable) | ✅ | |
| 7.8 | Text-anim track ("Karaoke · all captions") — animation per range | 🟡 | Track shows the one global animation; per-range overrides still to do. Implies per-caption animation overrides; today one global style. |
| 7.9 | Playhead line spanning all tracks | ✅ | Have one on the video strip. |
| 7.10 | Trim handles, delete, undo/redo | ✅ | Not shown in design; keep. |

## 8. Export dialog
| # | Feature | Status | Notes |
|---|---|---|---|
| 8.1 | Quality: Draft / Standard / High (+ description) | ✅ | Map to bitrate (QUALITY_LOW/MEDIUM/HIGH). |
| 8.2 | Resolution: Original / 720p / 540p / 480p | ✅ | Have Original/1080/720; add 540/480. |
| 8.3 | Summary line "1920×1080 · MP4 (H.264) · captions burned in" | ✅ | |
| 8.4 | Cancel / Export | ✅ | |
| 8.5 | Shape (9:16 etc.) and fps | ✅ | **Not in design** — decide: keep (useful for Reels/TikTok) or hide. |

## 9. Share
| # | Feature | Status | Notes |
|---|---|---|---|
| 9.1 | Share button | ❌ | **Needs a decision**: app is fully local today. Options: (a) Web Share API to send the exported MP4 (no server), (b) upload + link (needs hosting/storage, e.g. Supabase). |

## 10. Things the app has that the design doesn't show
- EN/ES interface switch and Whisper language picker (Auto/English/Español) — **needed** for the bilingual goal; add to header/transcript tab.
- "Use my fonts" / upload font.
- SRT/VTT download — fits naturally in the Export dialog or Captions tab.
- New project.

---

## Suggested build order

> Step 1 done (re-skin + layout). Step 2 done (transcript editing; fillers = hesitation sounds only, not "like"/"este"). Step 3 done (Boxed, Editorial, Fade up, letter-by-letter Typewriter, duration + easing). Step 4 done (ruler, zoom, waveform, draggable captions track, text-anim track, full-height playhead). Step 5 done (manual speaker tagging). Note 6.1: cards show our 6 presets; Boxed + Editorial arrive in step 3. Share (9.1) left out until decided.
1. **Re-skin + layout** (1.1–1.6, 5.2–5.5, 6.1, 6.4, 8.1–8.3) — visual match, mostly UI work, low risk.
2. **Transcript editing** (3.1, 3.3–3.8) — delete words to cut, fillers, silences, search. Builds on existing cuts + word timings. Biggest value.
3. **New styles & animations** (6.2, 6.3, 6.6–6.9).
4. **Timeline upgrade** (7.1, 7.2, 7.5, 7.7, 7.9) — ruler, zoom, waveform, captions track.
5. **Speakers** (3.2) — manual tagging first; automatic diarization later if needed.
6. **Multi-clip + extra audio** (2.x, 7.4, 7.6, 7.8) — biggest change; it moves the app toward a full editor, past the "basic cuts" scope in PLAN.md. Confirm before building.
7. **Share** (9.1) — after deciding local vs hosted.
