# Pro editing roadmap

Goal: move Sonant from a caption editor toward NLE-style (Premiere-like) editing, on top of the
multi-track timeline (V1/A1 main sequence, V2… layers, A2… music & VO, see `app/src/lib/tracks.ts`).

Phases are ordered by dependency: each one builds on helpers from the previous.

## Phase 1 — Razor across all tracks  ✅ started
- `splitOverlay` / `splitAudio` in `tracks.ts`: cut an item in two at an output time, keeping
  file offsets, keyframes, mask keyframes and title in/out animation consistent on both halves.
- **Shift+S** ("Split all tracks"): splits the main strip plus every unlocked layer and audio item
  under the playhead. **S** keeps splitting only the main strip.
- Toolbar button next to Split.

## Phase 2 — Free in/out on V1 clips
Today a V1 clip always spans its whole file and strips are "kept ranges" inside it.
- Add `in`/`out` to `Clip` (source trim), so a clip can start mid-file without a deleted region.
- `clipLen` = `out − in`; `clipAt` returns file time `in + local`. Migrate: absent = whole file.
- Edge-drag on a clip's first/last strip extends back into hidden media (currently clamped).
- Update `remapProject`, export (`export.ts`) and the player source mapping; tests in `project.test.ts`.

## Phase 3 — Ripple, roll, slip, and a razor tool
- Tool mode on the timeline toolbar: Select (V), Razor (C), Ripple (B), Roll (N→ move snap to another key), Slip (Y).
- Razor tool: click an item to split it at the pointer (uses Phase 1 helpers).
- Ripple trim: trimming a layer/audio edge shifts later items on the same track.
- Ripple delete (Shift+Del on a gap/item for layers & audio; V1 already closes gaps).
- Roll: drag the cut between two adjacent items on one track (one grows, the other shrinks).
- Slip: drag inside a video layer / clip to change `offset` while keeping position and length (needs Phase 2 for V1).

## Phase 4 — Linked video and audio for layer videos
- A video layer's sound becomes its own `AudioItem` on an A track, linked by `link: string` (shared id).
- Moving / trimming / splitting / deleting one moves the other while linked; Alt+drag edits one side.
- "Unlink" / "Link" actions in the inspectors. Migration: existing `volume` → linked audio item.
- Player/export already handle audio items, so the layer video always plays muted.

## Phase 5 — Layer transitions and audio keyframes
- Layer transitions: `transIn` / `transOut` on overlays (fade, slide, zoom, wipe) with a duration,
  drawn in `drawLayers` and the export renderer; cross-dissolve when two items on a track touch.
- Audio volume keyframes: `volKf: {t, v}[]` on audio items, a rubber-band line drawn in the clip,
  click to add points, drag to move; fades in/out as handles at the corners. Player applies
  per-frame gain; export bakes the envelope into the mix.

## Phase 6 — Drag media onto a track
- Media panel items become draggable; dropping on the timeline places video/image on the V track
  under the pointer (V1 = append/insert into the sequence) and audio on the A track, at the drop time.
- Dropping over an occupied spot opens a new track at that position (`moveToTrack` already does this).
