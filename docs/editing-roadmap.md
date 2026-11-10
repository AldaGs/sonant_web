# Pro editing roadmap

Goal: make Sonant a complete video editor with NLE-style (Premiere-like) editing, on top of the
multi-track timeline (V1/A1 main sequence, V2… layers, A2… music & VO, see `app/src/lib/tracks.ts`).

Phases are ordered by dependency: each one builds on helpers from the previous.

## Phase 1 — Razor across all tracks  ✅ done
- `splitOverlay` / `splitAudio` in `tracks.ts`: cut an item in two at an output time, keeping
  file offsets, keyframes, mask keyframes and title in/out animation consistent on both halves.
- **Shift+S** ("Split all tracks"): splits the main strip plus every unlocked layer and audio item
  under the playhead. **S** keeps splitting only the main strip.
- Toolbar button next to Split.

## Phase 2 — Free in/out on V1 clips  ✅ done
Before, a V1 clip always spanned its whole file and strips were "kept ranges" inside it.
Done: `Clip.in` + `len`, `clipBases` (file time = sequence time − base) used by the player, export, thumbnails,
waveform, transcription and AI jobs; `extendClip` (edge drag reveals/hides footage), `isolateStrip` +
drag-to-reorder strips on V1; trims inside a clip no longer cross into the neighbouring clip.

## Phase 3 — Ripple, roll, slip, and a razor tool  ✅ done (layers & audio)
Done: `tools.ts` (rippleTrim, rippleDelete, rollEdit, slip) with tests; tool switcher on the timeline
toolbar with keys V / C / B / R / Y (N stays snap). Razor also cuts V1 strips.
Still open: roll and slip on V1 strips (V1 trims already ripple, since the main sequence has no gaps).
- Tool mode on the timeline toolbar: Select (V), Razor (C), Ripple (B), Roll (R), Slip (Y).
- Razor tool: click an item to split it at the pointer (uses Phase 1 helpers).
- Ripple trim: trimming a layer/audio edge shifts later items on the same track.
- Ripple delete (Shift+Del on a gap/item for layers & audio; V1 already closes gaps).
- Roll: drag the cut between two adjacent items on one track (one grows, the other shrinks).
- Slip: drag inside a video layer / clip to change `offset` while keeping position and length (needs Phase 2 for V1).

## Phase 4 — Linked video and audio for layer videos  ✅ done
Done: `links.ts` (linkedAudio, linkLegacy, reconcile, unlink) with tests. A `link` id pairs a video layer with
its audio item; after every edit a reconcile step makes the partner follow whichever side changed (and
deletes it when one side is deleted). Splits give both right halves the same new link. Alt+drag to edit one
side is not done: use Unlink.
- A video layer's sound becomes its own `AudioItem` on an A track, linked by `link: string` (shared id).
- Moving / trimming / splitting / deleting one moves the other while linked; Alt+drag edits one side.
- "Unlink" / "Link" actions in the inspectors. Migration: existing `volume` → linked audio item.
- Player/export already handle audio items, so the layer video always plays muted.

## Phase 5 — Layer transitions and audio keyframes  ✅ done
Done: `layertrans.ts` (applyTrans, envelopeAt, setVolKey) with tests. `trIn`/`trOut` on layers, drawn in the shared
`drawOverlay` (preview + export); `fadeIn`/`fadeOut`/`volKf` on audio items, applied by the player per frame and
baked into the export mix as a gain curve. Linked layer sound now goes through the export's voice bus.
Still open: automatic cross-dissolve between touching items on a track (use fade out + fade in).
- Layer transitions: `transIn` / `transOut` on overlays (fade, slide, zoom, wipe) with a duration,
  drawn in `drawLayers` and the export renderer; cross-dissolve when two items on a track touch.
- Audio volume keyframes: `volKf: {t, v}[]` on audio items, a rubber-band line drawn in the clip,
  click to add points, drag to move; fades in/out as handles at the corners. Player applies
  per-frame gain; export bakes the envelope into the mix.

## Phase 6 — Drag media onto a track  ✅ done
Done: the Timeline finds the zone and track under the pointer while a media card is dragged (highlight + time
marker) and calls `dropAsset` (layers.svelte.ts) / `insertClip` (edit.svelte.ts). Files from the computer still
import as before.
- Media panel items become draggable; dropping on the timeline places video/image on the V track
  under the pointer (V1 = append/insert into the sequence) and audio on the A track, at the drop time.
- Dropping over an occupied spot opens a new track at that position (`moveToTrack` already does this).

## Next ideas
- Roll and slip on V1 strips; automatic cross-dissolve between touching items on a track.
- Alt+drag to edit one side of a linked pair. (Touch reordering is done: long-press the selected strip.)
- Nested sequences, adjustment layers, audio effects per track, and keyframes for color and effects.
