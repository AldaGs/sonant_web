<script lang="ts">
  // The timeline: numbered video tracks (V1 at the bottom of the group, higher tracks above, drawn on top),
  // the captions and their animation, then the audio tracks (A1 first). Every track works the same way:
  // items move in time and between tracks, trim at their edges, and the tools (razor, ripple, roll, slip) apply.
  // Everything here is in output time.
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  import { startOf, endOf, type Caption } from './captions';
  import type { Thumb } from './thumbs';
  import { tickStep } from './waveform';
  import { itemLen, trimAudio, type AudioItem } from './project';
  import { t } from './i18n.svelte';
  import { trimOverlay, type Overlay } from './overlay';
  import { envelopeAt, hasEnvelope, type VolKey } from './layertrans';
  import { fits, trackCount, trackOf, NO_TRACKS, type Tracks, type TrackFlags } from './tracks';
  import { fileAt, srcLen } from './model';

  let {
    overlays = [], audios, captions, durations, names, thumbs, peaks, duration, animLabel, zoom = $bindable(1),
    selectedOverlay = $bindable(''), selectedAudio = $bindable(''), selectedCapIds = new Set<string>(), onselectcap,
    onseek, oncommit, onmovecap, onaudio, onoverlay = () => {}, snap = true, range = null,
    pending = [], beats, out = 0, zooms = [], onzoom,
    ondropasset = () => {}, ondropfiles = () => {}, tool = 'select', ontool = () => {}, onrazor = () => {},
    tracks = NO_TRACKS, onretrack = () => {}, ontrack = () => {}, onaddtrack = () => {}, ondroptrack = () => false,
  }: {
    overlays?: Overlay[]; // items on the video tracks (track 0 = V1)
    audios: AudioItem[]; // items on the audio tracks (track 0 = A1)
    captions: Caption[]; // as they play, without cut words
    durations: Map<string, number>; // assetId → seconds
    names: Map<string, string>; // assetId → file name
    thumbs: Record<string, Thumb[]>; // assetId → thumbnails (file time)
    peaks: Record<string, Float32Array>; // assetId → waveform peaks
    duration: number; // where the timeline ends
    animLabel: string;
    zoom?: number; // 1 = whole timeline fits
    selectedOverlay?: string;
    selectedAudio: string;
    selectedCapIds?: Set<string>; // captions selected for styling
    onselectcap: (id: string, e: MouseEvent) => void; // Ctrl/⌘ toggles, Shift selects a range
    onseek: (out: number) => void;
    oncommit: () => void; // a drag started: snapshot for undo
    onmovecap: (id: string, start: number, end: number) => void; // move or retime a caption, live
    onaudio: (id: string, patch: Partial<AudioItem>) => void; // move or trim an audio item, live
    onoverlay?: (id: string, patch: Partial<Overlay>) => void; // move or trim a video-track item, live
    snap?: boolean; // snap drags to edges and the playhead (hold Alt to bypass)
    range?: [number | null, number | null] | null; // I/O marks
    pending?: [number, number][]; // clean-up preview: ranges that would be cut
    beats?: Map<string, number[]>; // assetId → beat times in the file (music)
    out?: number; // the playhead
    zooms?: import('./autozoom').ZoomMoment[]; // auto-zoom moments
    onzoom?: (key: string, start: number | null) => void; // move or remove (null) a zoom, live
    ondropasset?: (assetId: string, zone: 'v' | 'a', track: number, out: number) => void; // media card dropped on a track
    ondropfiles?: (files: FileList, zone: 'v' | 'a', track: number, out: number) => void; // files from the computer dropped on a track
    tool?: import('./tools').Tool;
    ontool?: (kind: 'v' | 'a', id: string, op: 'ripple' | 'roll' | 'slip', side: 'start' | 'end', d: number) => void; // live, from drag start
    onrazor?: (kind: 'v' | 'a', id: string, out: number) => void; // cut an item at that time
    tracks?: Tracks; // track switches (hide/mute, lock)
    onretrack?: (kind: 'v' | 'a', id: string, track: number) => void; // move an item to another track, live
    ontrack?: (kind: 'v' | 'a', track: number, patch: TrackFlags) => void;
    onaddtrack?: (kind: 'v' | 'a') => void;
    ondroptrack?: (kind: 'v' | 'a', track: number) => boolean; // delete an empty track
  } = $props();

  // Thumbnails of the part of its file an item shows (pictures: their image across it).
  function itemThumbs(o: Overlay): Thumb[] {
    const th = thumbs[o.assetId ?? ''] ?? [];
    if (o.kind === 'image') return th.slice(0, Math.max(1, Math.min(12, Math.round(o.len / 1.5))));
    const a = o.offset ?? 0, b = a + Math.max(srcLen(o), 0.05);
    const inside = th.filter((x) => x.t >= a - 1e-3 && x.t < b);
    return inside.length ? (o.fx?.rev ? inside.toReversed() : inside) : th.filter((x) => x.t <= a).slice(-1);
  }
  // A waveform for an audio item: the loudest peak around each of WAVE_N points across it, mirrored.
  const WAVE_N = 64;
  function wavePath(a: AudioItem): string {
    const p = peaks[a.assetId], dur = durations.get(a.assetId) ?? 0, len = audLen(a);
    if (!p || !dur || !len) return '';
    const m = { ...a, len }, top: string[] = [], bot: string[] = [];
    for (let i = 0; i <= WAVE_N; i++) {
      const f0 = fileAt(m, a.at + (i / WAVE_N) * len), f1 = fileAt(m, a.at + Math.min(1, (i + 1) / WAVE_N) * len);
      let v = 0;
      for (let k = Math.floor((Math.min(f0, f1) / dur) * p.length), e = Math.max(k + 1, Math.ceil((Math.max(f0, f1) / dur) * p.length)); k < e && k < p.length; k++) v = Math.max(v, p[k]);
      const x = (i / WAVE_N) * 100, h = Math.max(0.02, v) * 45;
      top.push(`${x},${50 - h}`);
      bot.unshift(`${x},${50 + h}`);
    }
    return [...top, ...bot].join(' ');
  }
  const waves = $derived(new Map(audios.map((a) => [a.id, wavePath(a)])));

  // Auto-zoom chips: drag to move a zoom, Delete / double-click to remove it.
  function moveZoom(e: PointerEvent, z: import('./autozoom').ZoomMoment) {
    if (!onzoom || !z.key) return;
    drag(e, (d) => onzoom!(z.key!, Math.max(0, Math.min(total - 0.05, z.start + d))));
  }
  // Drag sideways to move in time, up/down to change track. Nothing lands on top of another item:
  // a move that would overlap on that track is skipped, so the item stops at its neighbour.
  function moveAudio(e: PointerEvent, item: AudioItem) {
    ((selectedAudio = item.id), (selectedOverlay = '')); // one selection at a time, so Delete hits what you clicked
    if (isLocked('a', item)) return void e.stopPropagation();
    if (toolBody(e, 'a', item.id)) return;
    const a = item.at, len = audLen(item), pts = outPoints(item.id), k0 = trackOf(item);
    drag(e, (d, on, dy) => {
      const cur = audios.find((x) => x.id === item.id) ?? item;
      const want = Math.max(0, k0 + Math.round(dy / A_ROW));
      if (want !== trackOf(cur) && !tracks.a[want]?.locked && (want >= aCount || fits(audios, audLen, item.id, want, cur.at, len))) onretrack('a', item.id, want);
      const at0 = a + d, at = Math.max(0, Math.min(total - 0.1, at0 + nearest([at0, at0 + len], pts, on, idOut)));
      const k = trackOf(audios.find((x) => x.id === item.id) ?? cur);
      if (fits(audios, audLen, item.id, k, at, len)) onaudio(item.id, { at });
    });
  }
  // Drag an audio item's edge to trim it (the left edge also moves its start).
  function audEdge(e: PointerEvent, item: AudioItem, side: 'start' | 'end') {
    selectedAudio = item.id;
    const dur = durations.get(item.assetId) ?? 0, pts = outPoints(item.id);
    const x = side === 'start' ? item.at : item.at + audLen(item);
    if (isLocked('a', item)) return void e.stopPropagation();
    if (toolEdge(e, 'a', item.id, side)) return;
    drag(e, (d, on) => {
      const p = { ...item, ...trimAudio(item, dur, side, d + nearest([x + d], pts, on, idOut)) };
      if (fits(audios, audLen, item.id, trackOf(item), p.at, audLen(p))) onaudio(item.id, p);
    });
  }
  // Layers: same gestures as audio items (drag to move, edges to trim), snapping in output time.
  // Layers: drag sideways to move in time, up/down to change track (up = higher track = drawn on top).
  function moveOverlay(e: PointerEvent, o: Overlay) {
    if (isLocked('v', o)) return void e.stopPropagation();
    ((selectedOverlay = o.id), (selectedAudio = ''));
    if (toolBody(e, 'v', o.id)) return;
    const a = o.at, pts = outPoints(o.id), k0 = trackOf(o);
    drag(e, (d, on, dy) => {
      const cur = overlays.find((x) => x.id === o.id) ?? o;
      const want = Math.max(0, k0 - Math.round(dy / V_ROW));
      if (want !== trackOf(cur) && !tracks.v[want]?.locked && (want >= vCount || fits(overlays, ovLen, o.id, want, cur.at, o.len))) onretrack('v', o.id, want);
      const at0 = a + d, at = Math.max(0, Math.min(total - 0.1, at0 + nearest([at0, at0 + o.len], pts, on, idOut)));
      const k = trackOf(overlays.find((x) => x.id === o.id) ?? cur);
      if (fits(overlays, ovLen, o.id, k, at, o.len)) onoverlay(o.id, { at });
    });
  }
  function ovEdge(e: PointerEvent, o: Overlay, side: 'start' | 'end') {
    selectedOverlay = o.id;
    const dur = o.kind === 'video' && !o.fx?.hold ? durations.get(o.assetId ?? '') ?? Infinity : Infinity, pts = outPoints(o.id);
    const x = side === 'start' ? o.at : o.at + o.len;
    if (isLocked('v', o)) return void e.stopPropagation();
    if (toolEdge(e, 'v', o.id, side)) return;
    drag(e, (d, on) => {
      const p = trimOverlay(o, side, d + nearest([x + d], pts, on, idOut), dur), n = { ...o, ...p };
      if (fits(overlays, ovLen, o.id, trackOf(o), n.at, n.len)) onoverlay(o.id, p);
    });
  }
  // The link of the selected item: its partner on the other track is outlined too.
  const selLink = $derived(overlays.find((o) => o.id === selectedOverlay)?.link ?? audios.find((a) => a.id === selectedAudio)?.link);
  // ---- Dropping media cards on tracks ----
  // Which track is under the pointer: a video track (above the top one opens a new track) or an audio track
  // (below the last opens a new one). Null over the caption rows.
  let dropAt = $state<{ zone: 'v' | 'a'; track: number; out: number; top: number; h: number } | null>(null);
  function dropTarget(e: DragEvent): typeof dropAt {
    const ir = inner!.getBoundingClientRect(), y = e.clientY;
    const out = Math.max(0, Math.min(total, ((e.clientX - ir.left) / ir.width) * total));
    const vid = vRow!.getBoundingClientRect(), mus = aRow!.getBoundingClientRect();
    if (y < vid.bottom + 3) {
      const k = Math.max(0, Math.min(vCount, vCount - 1 - Math.floor((y - vid.top) / V_ROW)));
      return { zone: 'v', track: k, out, top: vid.top - ir.top + (vCount - 1 - k) * V_ROW, h: V_ROW - 4 };
    }
    if (y >= mus.top - 3) {
      const k = Math.max(0, Math.floor((y - mus.top) / A_ROW));
      return { zone: 'a', track: k, out, top: mus.top - ir.top + Math.min(k, aCount) * A_ROW, h: A_ROW - 4 };
    }
    return null;
  }
  const isCard = (e: DragEvent) => !!e.dataTransfer?.types.includes('text/x-asset');
  const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  function dragOverTracks(e: DragEvent) {
    if (!isCard(e) && !isFiles(e)) return;
    e.preventDefault();
    dropAt = dropTarget(e);
  }
  function dropOnTracks(e: DragEvent) {
    const at = isCard(e) || isFiles(e) ? dropTarget(e) : null, id = e.dataTransfer?.getData('text/x-asset');
    dropAt = null;
    if (!at) return; // let the timeline area handle it (the default place, or import only)
    e.preventDefault();
    e.stopPropagation();
    if (id) ondropasset(id, at.zone, at.track, at.out);
    else if (e.dataTransfer?.files.length) ondropfiles(e.dataTransfer.files, at.zone, at.track, at.out); // imported, then placed here
  }
  // ---- Volume line on audio items ----
  // The item's volume envelope (fades and points) as a line: top = 150%, bottom = silent.
  const ENV_N = 48;
  const envPath = (a: AudioItem) => {
    const len = audLen(a) || 1;
    return Array.from({ length: ENV_N + 1 }, (_, i) => `${(i / ENV_N) * 100},${(1 - envelopeAt(a, (i / ENV_N) * len, len) / 1.5) * 100}`).join(' ');
  };
  // Drag a volume point up or down (and along, between its neighbours).
  function dragVolKey(e: PointerEvent, a: AudioItem, k: number) {
    e.stopPropagation();
    if (isLocked('a', a)) return;
    const el = e.currentTarget as HTMLElement, box = el.parentElement!.getBoundingClientRect();
    const kf = a.volKf!, k0 = kf[k], x0 = e.clientX, y0 = e.clientY, len = audLen(a);
    let moved = false;
    el.setPointerCapture(e.pointerId);
    el.onpointermove = (m) => {
      if (!moved) ((moved = true), oncommit());
      const lo = k > 0 ? kf[k - 1].t + 0.01 : 0, hi = k < kf.length - 1 ? kf[k + 1].t - 0.01 : len;
      const t0 = Math.max(lo, Math.min(hi, k0.t + ((m.clientX - x0) / box.width) * len));
      const v = Math.max(0, Math.min(1.5, k0.v - ((m.clientY - y0) / box.height) * 1.5));
      onaudio(a.id, { volKf: kf.map((x, i): VolKey => (i === k ? { t: t0, v: Math.round(v * 100) / 100 } : x)) });
    };
    el.onpointerup = el.onpointercancel = () => (el.onpointermove = el.onpointerup = el.onpointercancel = null);
  }
  // ---- Tools ----
  const outAt = (e: PointerEvent) => {
    const r = inner!.getBoundingClientRect();
    return Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total));
  };
  // Pointer down on a layer / audio item body with a tool other than select. Returns true when handled.
  function toolBody(e: PointerEvent, kind: 'v' | 'a', id: string): boolean {
    if (tool === 'razor') {
      e.stopPropagation();
      eatNextClick();
      onrazor(kind, id, outAt(e));
      return true;
    }
    if (tool === 'slip') {
      // Dragging right shows earlier footage (the file slides right under the item), like an NLE.
      drag(e, (d) => ontool(kind, id, 'slip', 'end', -d));
      return true;
    }
    return false;
  }
  // Edge drag with ripple / roll.
  function toolEdge(e: PointerEvent, kind: 'v' | 'a', id: string, side: 'start' | 'end'): boolean {
    if (tool !== 'ripple' && tool !== 'roll') return false;
    const op = tool;
    drag(e, (d) => ontool(kind, id, op, side, d));
    return true;
  }
  // ---- Tracks ----
  // Video tracks are drawn top-down from the highest (V2 above V1, like an NLE); audio tracks A1, A2… go down.
  const V_ROW = 40, A_ROW = 32;
  let vRow = $state<HTMLDivElement>(), aRow = $state<HTMLDivElement>();
  const ovLen = (o: Overlay) => o.len;
  const vCount = $derived(trackCount(overlays, tracks.v));
  const aCount = $derived(trackCount(audios, tracks.a));
  const ovTop = (o: Overlay) => (vCount - 1 - trackOf(o)) * V_ROW;
  const isLocked = (k: 'v' | 'a', x: { track?: number }) => !!tracks[k][trackOf(x)]?.locked;
  const usedV = $derived(new Set(overlays.map(trackOf)));
  const usedA = $derived(new Set(audios.map(trackOf)));
  const ovLabel = (o: Overlay) => (o.bar ? t('tpl.b-progress') : o.kind === 'text' ? o.text ?? '' : names.get(o.assetId ?? '') ?? '');
  const ovIcon = (o: Overlay) => (o.kind === 'text' ? 'title' : o.kind === 'image' ? 'image' : o.fill ? 'movie' : 'picture_in_picture_alt') as IconName;
  // Effects worth a glance on the item itself: freeze, speed, punch-in.
  const fxTag = (o: Overlay) => {
    const fx = o.fx;
    if (!fx) return '';
    if (fx.hold) return `❄ ${o.len.toFixed(1)}s`;
    return (fx.speed || fx.speedEnd ? `${fx.speed ?? 1}×${fx.speedEnd ? `→${fx.speedEnd}×` : ''}` : '') + (fx.rev ? ' ⟲' : '');
  };

  // Beat times of an audio item in output time (only the part that plays).
  const beatsOf = (a: AudioItem) => {
    const b = beats?.get(a.assetId) ?? [], off = a.offset ?? 0, len = audLen(a);
    return b.flatMap((x) => (x >= off && x < off + len ? [a.at + x - off] : []));
  };
  // Keyboard: with a timeline item focused, ←/→ move it by 0.1s (Shift: 1s); one undo step per press.
  function keyMove(e: KeyboardEvent, move: (d: number) => void) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    oncommit();
    move((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.1));
  }
  const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const audLen = (a: AudioItem) => itemLen(a, durations.get(a.assetId) ?? 0);


  let scroller = $state<HTMLDivElement>();
  // Touch devices: the playhead stays fixed in the centre and the timeline scrolls under it
  // (a swipe anywhere scrubs). Mouse devices keep the free playhead.
  const mq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
  let centered = $state(mq?.matches ?? false);
  $effect(() => {
    if (!mq) return;
    const on = () => (centered = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  // Centred mode: the tracks are translated so `view` sits under the fixed centre line.
  // While a finger swipes (or momentum coasts) `swipeT` leads, so the strip never waits on the video seek.
  let vw = $state(0); // scroller width in px
  let swipeT = $state<number | null>(null);
  let coast = 0;
  let inner = $state<HTMLDivElement>();
  let width = $state(0); // inner width in px
  // While a drag is live the scale is frozen at its starting length (it only grows), so the edge
  // being dragged stays under the pointer instead of the whole timeline rescaling.
  let held = $state<number | null>(null);
  const live = $derived(duration || 1);
  // Empty room after the end, so clips and layers can be dropped or dragged past it (the timeline then grows).
  const roomy = (x: number) => Math.max(10, x * 1.25 + 2);
  const total = $derived(held === null ? roomy(live) : Math.max(held, roomy(live)));
  const playhead = $derived(out);
  const view = $derived(swipeT ?? playhead ?? 0);
  const shift = $derived(vw / 2 - (view / total) * width);
  const pct = (s: number) => `${(s / total) * 100}%`;

  const sourceById = $derived(new Map(captions.map((c) => [c.id, c])));

  const step = $derived(tickStep(total, width));
  const ticks = $derived(Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step));
  const label = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}${step < 1 && s % 1 ? '.5' : ''}`;

  // Click anywhere on the tracks (not on a draggable) to seek.
  function seekAt(e: MouseEvent) {
    const r = inner!.getBoundingClientRect();
    onseek(Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total)));
  }

  // Swallow the click that follows a drag, so finishing a scrub doesn't also select the strip under the finger.
  function eatNextClick() {
    const eat = (c: Event) => (c.stopPropagation(), c.preventDefault());
    addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', eat, { capture: true }), 0);
  }

  // Press and drag on the tracks (not on a draggable or button) to scrub the playhead.
  // Listens on window and only scrubs past 3px, so a plain click still selects strips and seeks.
  // On touch: a press that starts on a layer (strip, caption, audio, overlay) pans the timeline;
  // a press that starts on empty track space or the ruler scrubs the playhead.
  function scrub(e: PointerEvent) {
    if (e.button !== 0) return;
    if (e.pointerType === 'touch' && centered) return pan(e);
    if (e.pointerType === 'touch' && (e.target as Element).closest(LAYER)) return pan(e);
    if ((e.target as Element).closest('button')) return;
    getSelection()?.removeAllRanges(); // and don't extend a selection made elsewhere on the page
    const x0 = e.clientX;
    let on = false;
    const move = (m: PointerEvent) => {
      if (pinching || m.pointerId !== e.pointerId || (!on && Math.abs(m.clientX - x0) < 3)) return;
      on = true;
      seekAt(m);
    };
    const end = (u: PointerEvent) => {
      if (u.pointerId !== e.pointerId) return;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      if (on && u.type === 'pointerup') eatNextClick();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }

  const LAYER = '.cap, .aud, .ov, .animbar';
  // Touch pan of a zoomed timeline (done by hand so empty space can scrub instead of scrolling).
  // A tap without movement runs ontap; a pan swallows the click so it doesn't select anything.
  let panAt = 0; // last manual pan, so auto-follow doesn't yank the view away from the finger
  function pan(e: PointerEvent, ontap?: () => void) {
    const x0 = e.clientX, sl0 = scroller?.scrollLeft ?? 0, t0 = view, perPx = total / (width || 1);
    cancelAnimationFrame(coast);
    let on = false, lx = x0, lt = performance.now(), vel = 0; // vel in px/ms
    const clampT = (v: number) => Math.max(0, Math.min(total, v));
    const move = (m: PointerEvent) => {
      if (pinching || m.pointerId !== e.pointerId || (!on && Math.abs(m.clientX - x0) < 3)) return;
      on = true;
      panAt = performance.now();
      if (!centered) { if (scroller) scroller.scrollLeft = sl0 - (m.clientX - x0); return; }
      const now = performance.now();
      vel = 0.8 * ((m.clientX - lx) / Math.max(1, now - lt)) + 0.2 * vel;
      lx = m.clientX; lt = now;
      swipeT = clampT(t0 - (m.clientX - x0) * perPx);
      onseek(swipeT);
    };
    const release = () => {
      if (!centered || swipeT === null) return void (swipeT = null);
      if (performance.now() - lt > 80) vel = 0;
      let prev = performance.now();
      const step = (now: number) => {
        const dt = now - prev; prev = now;
        vel *= Math.pow(0.995, dt);
        if (Math.abs(vel) < 0.02 || swipeT === null) { swipeT = null; return; }
        swipeT = clampT(swipeT - vel * dt * perPx);
        onseek(swipeT);
        coast = requestAnimationFrame(step);
      };
      coast = requestAnimationFrame(step);
    };
    const end = (u: PointerEvent) => {
      if (u.pointerId !== e.pointerId) return;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      if (on) release();
      if (u.type !== 'pointerup') return;
      if (on) eatNextClick();
      else ontap?.();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }

  // Drag the playhead's knob directly (a big touch target above the ruler).
  function grabPlayhead(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.onpointermove = (m) => seekAt(m);
    el.onpointerup = el.onpointercancel = () => (el.onpointermove = el.onpointerup = el.onpointercancel = null);
  }

  // ---- Snapping ----
  // Drags snap to strip edges, caption edges, audio edges and the playhead when within SNAP_PX.
  // Hold Alt (Option) while dragging to place freely. A guide line marks the snap.
  const SNAP_PX = 8;
  let guide = $state<number | null>(null); // output time of the active snap line
  const tol = () => (SNAP_PX * total) / (inner?.clientWidth || 1);
  // Snap points in output time (audio items live there).
  const outPoints = (skipAudio = '') => [0, duration, playhead,
    ...captions.flatMap((c) => [startOf(c), endOf(c)]),
    ...audios.filter((a) => a.id !== skipAudio).flatMap((a) => [a.at, a.at + audLen(a)]),
    ...overlays.filter((o) => o.id !== skipAudio).flatMap((o) => [o.at, o.at + o.len]),
    ...audios.filter((a) => a.id !== skipAudio).flatMap(beatsOf)];
  // Nearest point within tolerance: returns the shift to apply (0 = no snap) and sets the guide.
  function nearest(vals: number[], pts: number[], on: boolean, toOut: (v: number) => number | null = idOut): number {
    guide = null;
    if (!on) return 0;
    let best = 0, bd = tol();
    for (const v of vals) for (const p of pts) {
      const d = Math.abs(p - v);
      if (d < bd) ((bd = d), (best = p - v), (guide = toOut(p)));
    }
    return best;
  }
  function idOut(v: number) { return v; }

  // Generic horizontal drag: calls move(deltaSeconds, snapOn) live; a press without movement runs onclick.
  // On touch, only a selected item drags; an unselected one pans the timeline (tap still selects).
  function drag(e: PointerEvent, move: (d: number, snapOn: boolean, dy: number) => void, onclick?: () => void) {
    e.stopPropagation();
    if (e.pointerType === 'touch' && !(e.currentTarget as Element).closest('.sel')) return pan(e, onclick);
    const x0 = e.clientX, y0 = e.clientY, perPx = total / inner!.clientWidth;
    const el = e.currentTarget as HTMLElement;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    el.onpointermove = (m) => {
      if (!moved && Math.abs(m.clientX - x0) < 3 && Math.abs(m.clientY - y0) < 6) return;
      if (!moved) ((moved = true), (held = total), oncommit());
      move((m.clientX - x0) * perPx, snap && !m.altKey, m.clientY - y0);
    };
    el.onpointerup = el.onpointercancel = (u) => {
      el.onpointermove = el.onpointerup = el.onpointercancel = null;
      guide = null;
      held = null;
      if (u.type === 'pointerup' && !moved) onclick?.();
    };
  }

  function moveCap(e: PointerEvent, id: string) {
    const c = sourceById.get(id);
    if (!c) return;
    const a = startOf(c), b = endOf(c), pts = outPoints(id);
    drag(e, (d0, on) => {
      const d = d0 + nearest([a + d0, b + d0], pts, on);
      const dd = Math.max(-a, Math.min(total - b, d));
      onmovecap(id, a + dd, b + dd);
    }, () => onseek(a));
  }
  // Drag a caption's edge to change when it starts or ends (min 0.1s).
  function capEdge(e: PointerEvent, id: string, side: 'start' | 'end') {
    const c = sourceById.get(id);
    if (!c) return;
    const a = startOf(c), b = endOf(c), pts = outPoints(id);
    drag(e, (d0, on) => {
      const d = d0 + nearest([(side === 'start' ? a : b) + d0], pts, on);
      if (side === 'start') onmovecap(id, Math.max(0, Math.min(b - 0.1, a + d)), b);
      else onmovecap(id, a, Math.max(a + 0.1, Math.min(total, b + d)));
    });
  }

  // Scroll wheel / trackpad scrolls scrub the playhead; Ctrl/⌘+wheel (trackpad pinch) and
  // two-finger pinch zoom the timeline, anchored on the point under the cursor/fingers.
  const ZMIN = 1, ZMAX = 16;
  let pinching = false;
  function zoomTo(z: number, clientX: number) {
    z = Math.max(ZMIN, Math.min(ZMAX, z));
    if (!scroller || z === zoom) return;
    const r = scroller.getBoundingClientRect(), px = clientX - r.left;
    const frac = (scroller.scrollLeft + px) / (width || 1);
    zoom = z;
    panAt = performance.now();
    requestAnimationFrame(() => { if (scroller) scroller.scrollLeft = frac * width - px; });
  }
  $effect(() => {
    const el = scroller;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return zoomTo(zoom * Math.exp(-e.deltaY * 0.01), e.clientX);
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const px = e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * el.clientWidth : d;
      onseek(Math.max(0, Math.min(total, (playhead ?? 0) + px * (total / (width || 1)))));
    };
    let d0 = 0, z0 = 1;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const tstart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinching = true; d0 = dist(e.touches) || 1; z0 = zoom;
      cancelAnimationFrame(coast); swipeT = null;
    };
    const tmove = (e: TouchEvent) => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault();
      zoomTo(z0 * dist(e.touches) / d0, (e.touches[0].clientX + e.touches[1].clientX) / 2);
    };
    const tend = (e: TouchEvent) => { if (e.touches.length < 2) pinching = false; };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('touchstart', tstart, { passive: true });
    el.addEventListener('touchmove', tmove, { passive: false });
    el.addEventListener('touchend', tend);
    el.addEventListener('touchcancel', tend);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('touchstart', tstart);
      el.removeEventListener('touchmove', tmove);
      el.removeEventListener('touchend', tend);
      el.removeEventListener('touchcancel', tend);
    };
  });

  // While zoomed, keep the playhead in view (unless the user just panned by hand).
  $effect(() => {
    if (centered || playhead === null || !scroller || zoom === 1 || performance.now() - panAt < 1500) return;
    const x = (playhead / total) * width, sl = scroller.scrollLeft, vw = scroller.clientWidth;
    if (x < sl || x > sl + vw - 20) scroller.scrollLeft = Math.max(0, x - vw / 3);
  });
</script>

<div class="tl">
  <div class="labels" style:--music="{aCount * A_ROW - 4}px" style:--ov="{vCount * V_ROW - 4}px">
    <span class="thead" aria-hidden="true">
      <button class="tadd" onclick={() => onaddtrack('v')} title={t('addVTrack')} aria-label={t('addVTrack')}><Icon name="add" size={12} />V</button>
      <button class="tadd" onclick={() => onaddtrack('a')} title={t('addATrack')} aria-label={t('addATrack')}><Icon name="add" size={12} />A</button>
    </span>
    <div class="tracks">
      {#each Array.from({ length: vCount }, (_, i) => vCount - 1 - i) as k (k)}
        {@render header('v', k, `V${k + 1}`, V_ROW)}
      {/each}
    </div>
    <span aria-hidden="true">{t('captions')}</span>
    <span aria-hidden="true">{t('animTrack')}</span>
    <div class="tracks">
      {#each Array.from({ length: aCount }, (_, i) => i) as k (k)}
        {@render header('a', k, `A${k + 1}`, A_ROW)}
      {/each}
    </div>
  </div>
  {#snippet header(kind: 'v' | 'a', k: number, name: string, h: number)}
    {@const f = tracks[kind][k] ?? {}}
    {@const off = kind === 'v' ? f.hidden : f.muted}
    {@const empty = !(kind === 'v' ? usedV : usedA).has(k)}
    <div class="th" class:off style:height="{h - 4}px" style:margin-bottom="4px">
      <button class="tname mono" disabled={!empty || (kind === 'v' ? vCount : aCount) === 1} title={empty ? t('deleteTrack', { n: name }) : t('trackTip')}
        ondblclick={() => ondroptrack(kind, k)} onkeydown={(e) => (e.key === 'Delete' || e.key === 'Backspace') && ondroptrack(kind, k)}>{name}</button>
      <button class="tbtn" class:on={off} aria-pressed={!!off}
        onclick={() => ontrack(kind, k, kind === 'v' ? { hidden: !f.hidden || undefined } : { muted: !f.muted || undefined })}
        title={t(kind === 'v' ? (off ? 'showTrack' : 'hideTrack') : off ? 'unmuteTrack' : 'muteTrack', { n: name })}
        aria-label={t(kind === 'v' ? (off ? 'showTrack' : 'hideTrack') : off ? 'unmuteTrack' : 'muteTrack', { n: name })}>
        <Icon name={kind === 'v' ? (off ? 'visibility_off' : 'visibility') : off ? 'volume_off' : 'volume_up'} size={13} /></button>
      <button class="tbtn" class:on={f.locked} aria-pressed={!!f.locked} onclick={() => ontrack(kind, k, { locked: !f.locked || undefined })}
        title={t(f.locked ? 'unlockTrack' : 'lockTrack', { n: name })} aria-label={t(f.locked ? 'unlockTrack' : 'lockTrack', { n: name })}>
        <Icon name={f.locked ? 'lock' : 'lock_open'} size={13} /></button>
    </div>
  {/snippet}

  <div class="scroller" class:centered bind:this={scroller} bind:clientWidth={vw}>
    {#if centered}<div class="centerline" aria-hidden="true"></div>{/if}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="inner" style:--music="{aCount * A_ROW - 4}px" style:--ov="{vCount * V_ROW - 4}px" bind:this={inner} bind:clientWidth={width} style:width="{zoom * 100}%" class:zoomed={zoom !== 1} class:t-razor={tool === 'razor'} class:t-slip={tool === 'slip'} style:transform={centered ? `translateX(${shift}px)` : null}
      role="slider" tabindex="0" aria-label={t('timeline')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={playhead ?? 0}
      onclick={seekAt} onpointerdown={scrub} ondragover={dragOverTracks} ondrop={dropOnTracks} ondragleave={(e) => !inner?.contains(e.relatedTarget as Node) && (dropAt = null)}
      onkeydown={(e) => {
        const d = (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) * (e.shiftKey ? 1 : 1 / 30);
        if (d) (e.preventDefault(), onseek(Math.max(0, (playhead ?? 0) + d)));
      }}>
      <div class="ruler">
        {#each ticks as s}<span class="tick mono" style:left={pct(s)}>{label(s)}</span>{/each}
      </div>

      <div class="row layers" bind:this={vRow}>
        {#each Array.from({ length: vCount }, (_, i) => i) as i}<div class="lane" style:top="{i * V_ROW}px" style:height="{V_ROW - 4}px" aria-hidden="true"></div>{/each}
        {#each overlays as o (o.id)}
          {@const media = o.kind !== 'text' && !o.bar}
          <button class="ov" class:sel={o.id === selectedOverlay} class:pair={!!o.link && o.link === selLink} class:txt={o.kind === 'text'} class:media
            class:locked={isLocked('v', o)} class:off={tracks.v[trackOf(o)]?.hidden} style:left={pct(o.at)}
            style:top="{ovTop(o)}px" style:width={pct(Math.max(0.05, o.len))}
            title={ovLabel(o)} aria-pressed={o.id === selectedOverlay}
            onpointerdown={(e) => moveOverlay(e, o)} onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => !isLocked('v', o) && keyMove(e, (d) => fits(overlays, ovLen, o.id, trackOf(o), Math.max(0, o.at + d), o.len) && onoverlay(o.id, { at: Math.max(0, o.at + d) }))}
            aria-label={t('a11y.item', { name: ovLabel(o), a: fmtT(o.at) })}>
            {#if media}
              <span class="thumbs" aria-hidden="true">{#each itemThumbs(o) as th}<img src={th.url} alt="" draggable="false" />{/each}</span>
            {/if}
            {#if o.fx?.trans}<span class="trn" title={t('trans.' + o.fx.trans)} aria-hidden="true"><Icon name="transition_fade" size={12} /></span>{/if}
            {#each o.kf ?? [] as k}<span class="kd" style:left="{(k.t / o.len) * 100}%" aria-hidden="true"><Icon name="diamond" size={10} /></span>{/each}
            <span class="edge l" aria-hidden="true" onpointerdown={(e) => ovEdge(e, o, 'start')}></span>
            <span class="cname"><Icon name={ovIcon(o)} size={12} />{#if o.link}<Icon name="link" size={11} />{/if} {ovLabel(o)}{#if fxTag(o)} <b>{fxTag(o)}</b>{/if}{#if o.fx?.zoom} <Icon name="zoom_in" size={11} />{/if}</span>
            <span class="edge r" aria-hidden="true" onpointerdown={(e) => ovEdge(e, o, 'end')}></span></button>
        {/each}
      </div>

      <div class="row">
        {#each zooms as z (z.key)}
          {#if z.key}
            <button class="zchip" style:left={pct(z.start)} title={t('zoomChipTip')} aria-label={t('a11y.zoom', { a: fmtT(z.start) })}
              onpointerdown={(e) => moveZoom(e, z)} onclick={(e) => e.stopPropagation()} ondblclick={(e) => (e.stopPropagation(), onzoom?.(z.key!, null))}
              onkeydown={(e) => (e.key === 'Delete' || e.key === 'Backspace') && (e.preventDefault(), e.stopPropagation(), onzoom?.(z.key!, null))}>◎</button>
          {/if}
        {/each}
        {#each captions as c, i (c.id)}
          <button class="cap" class:sel={selectedCapIds.has(c.id)}
            style:left={pct(startOf(c))} style:width={pct(Math.max(0.05, endOf(c) - startOf(c)))}
            title={c.words.map((w) => w.text).join(' ')}
            onpointerdown={(e) => moveCap(e, c.id)} onkeydown={(e) => keyMove(e, (d) => onmovecap(c.id, Math.max(0, startOf(c) + d), Math.min(total, endOf(c) + d)))}
            aria-label={t('a11y.cap', { n: i + 1, a: fmtT(startOf(c)), b: fmtT(endOf(c)), text: c.words.map((w) => w.text).join(' ') })}
            onclick={(e) => { e.stopPropagation(); onselectcap(c.id, e); }}>
            <span class="edge l" aria-hidden="true" onpointerdown={(e) => capEdge(e, c.id, 'start')}></span>{t('lineN', { n: i + 1 })}<span class="edge r" aria-hidden="true" onpointerdown={(e) => capEdge(e, c.id, 'end')}></span></button>
        {/each}
      </div>

      <div class="row">
        {#each captions as c (c.id)}
          {@const anim = c.style?.animation}
          <button class="animbar" class:sel={selectedCapIds.has(c.id)}
            style:left={pct(startOf(c))} style:width={pct(Math.max(0.05, endOf(c) - startOf(c)))}
            title={anim ? t('anim.' + anim) : animLabel}
            onclick={(e) => { e.stopPropagation(); onselectcap(c.id, e); }}>
            {anim ? t('anim.' + anim) : animLabel}
          </button>
        {/each}
      </div>

      <div class="row music" bind:this={aRow}>
        {#each Array.from({ length: aCount }, (_, i) => i) as i}<div class="lane" style:top="{i * A_ROW}px" style:height="{A_ROW - 4}px" aria-hidden="true"></div>{/each}
        {#each audios as item (item.id)}
          <button class="aud" class:sel={item.id === selectedAudio} class:pair={!!item.link && item.link === selLink} class:locked={isLocked('a', item)} class:off={tracks.a[trackOf(item)]?.muted} style:left={pct(item.at)}
            style:top="{trackOf(item) * A_ROW}px" style:width={pct(Math.max(0.05, audLen(item)))}
            title={names.get(item.assetId)} aria-pressed={item.id === selectedAudio}
            onpointerdown={(e) => moveAudio(e, item)} onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => !isLocked('a', item) && keyMove(e, (d) => fits(audios, audLen, item.id, trackOf(item), Math.max(0, item.at + d), audLen(item)) && onaudio(item.id, { at: Math.max(0, item.at + d) }))}
            aria-label={t('a11y.item', { name: names.get(item.assetId) ?? '', a: fmtT(item.at) })}>
            {#if waves.get(item.id)}
              <svg class="wav" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={waves.get(item.id)} /></svg>
            {/if}
            {#if hasEnvelope(item) || item.id === selectedAudio}
              <svg class="env" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline points={envPath(item)} vector-effect="non-scaling-stroke" />
              </svg>
              {#each item.volKf ?? [] as k, ki}
                <span class="vk" style:left="{(k.t / (audLen(item) || 1)) * 100}%" style:top="calc(2px + {(1 - k.v / 1.5)} * (100% - 4px))"
                  title="{Math.round(k.v * 100)}%" aria-hidden="true" onpointerdown={(e) => dragVolKey(e, item, ki)}></span>
              {/each}
            {/if}
            {#each beatsOf(item) as b}<span class="beat" style:left="{((b - item.at) / audLen(item)) * 100}%" aria-hidden="true"></span>{/each}
            <span class="edge l" aria-hidden="true" onpointerdown={(e) => audEdge(e, item, 'start')}></span><span class="aname"><Icon name={item.link ? 'link' : 'music_note'} size={12} /> {names.get(item.assetId)}{#if item.fx?.speed || item.fx?.speedEnd} <b>{item.fx.speed ?? 1}×</b>{/if}</span><span class="edge r" aria-hidden="true" onpointerdown={(e) => audEdge(e, item, 'end')}></span></button>
        {/each}
      </div>

      {#if range && (range[0] !== null || range[1] !== null)}
        {@const a = range[0] ?? range[1]!}
        {@const b = range[1] ?? range[0]!}
        <div class="range" style:left={pct(Math.min(a, b))} style:width={pct(Math.abs(b - a))} aria-hidden="true">
          {#if range[0] !== null}<span class="mk in">I</span>{/if}{#if range[1] !== null}<span class="mk out">O</span>{/if}
        </div>
      {/if}
      {#each pending as [a, b]}
        <div class="pend" style:left={pct(a)} style:width={pct(Math.max(0.01, b - a))} aria-hidden="true"></div>
      {/each}
      {#if dropAt}<div class="dropzone" style:top="{dropAt.top}px" style:height="{dropAt.h}px" aria-hidden="true"><span class="dropmark" style:left={pct(dropAt.out)}></span></div>{/if}
      {#if guide !== null}<div class="guide" style:left={pct(guide)} aria-hidden="true"></div>{/if}
      {#if playhead !== null}
        <div class="playhead" style:left={pct(playhead)}>
          <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events (the timeline itself is the keyboard slider) -->
          <div class="knob" aria-hidden="true" onpointerdown={grabPlayhead} onclick={(e) => e.stopPropagation()}></div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .tl { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 8px; user-select: none; -webkit-user-select: none;
    -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
  .labels, .inner { display: grid; grid-template-rows: 20px var(--ov, 36px) 22px 22px var(--music, 28px); row-gap: 6px; }
  /* Audio tracks sit in their own area under a divider. */
  .inner > .row.music { border-top: 1px dashed var(--border); padding-top: 4px; margin-top: 2px; align-self: start; }
  .labels { font-size: 12px; color: var(--muted); align-items: center; }
  .labels > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .labels > .tracks { align-self: start; }
  .labels > .tracks:last-child { border-top: 1px dashed var(--border); padding-top: 4px; margin-top: 2px; }
  .thead { display: flex; gap: 2px; }
  .tadd, .tname, .tbtn { padding: 0 3px; min-height: 0; height: 18px; font-size: 11px; border-radius: 4px; background: none; border: none; color: var(--muted); }
  .tadd { display: inline-flex; align-items: center; border: 1px solid var(--border-soft); }
  .th { display: flex; align-items: center; gap: 1px; }
  .tname { width: 24px; text-align: left; color: var(--text, inherit); }
  .tname:disabled { opacity: 1; cursor: default; }
  .tbtn.on { color: var(--accent); }
  .th.off .tname { opacity: .5; }
  .lane { position: absolute; left: 0; right: 0; border-radius: 6px; background: rgb(255 255 255 / .025); pointer-events: none; }
  .ov.off, .aud.off { opacity: .35; }
  .ov.locked, .aud.locked { cursor: not-allowed; background-image: repeating-linear-gradient(135deg, transparent 0 5px, rgb(255 255 255 / .06) 5px 10px); }
  .scroller { overflow-x: auto; overflow-y: hidden; }
  /* Horizontal touch gestures are handled in JS: from a layer they pan, from empty space they scrub. */
  .inner { position: relative; min-width: 100%; cursor: pointer; touch-action: pan-y; }
  .inner:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .row { position: relative; }
  .ruler { position: relative; border-bottom: 1px solid var(--border-soft); touch-action: none; }
  .tick { position: absolute; top: 0; font-size: 11px; color: var(--muted); transform: translateX(-50%); white-space: nowrap; }
  .tick:first-child { transform: none; }
  .t-razor .ov, .t-razor .aud { cursor: crosshair; }
  .t-slip .ov, .t-slip .aud { cursor: ew-resize; }
  .ov.pair:not(.sel), .aud.pair:not(.sel) { box-shadow: 0 0 0 1px currentColor; }
  .env { position: absolute; inset: 2px 0; width: 100%; height: calc(100% - 4px); overflow: visible; pointer-events: none; }
  .env polyline { fill: none; stroke: #ffd84d; stroke-width: 1.5; opacity: .85; }
  .vk { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: #ffd84d; border: 1px solid #111; cursor: move; touch-action: none; z-index: 2; }
  .dropzone { position: absolute; left: 0; right: 0; border-radius: 6px; background: rgb(255 255 255 / .12); outline: 1px dashed var(--accent); pointer-events: none; z-index: 4; }
  .dropmark { position: absolute; top: -3px; bottom: -3px; width: 2px; transform: translateX(-1px); background: var(--accent); }
  .thumbs { position: absolute; inset: 0; display: flex; overflow: hidden; pointer-events: none; }
  .thumbs img { height: 100%; width: 0; flex: 1; object-fit: cover; opacity: .75; }
  .cap { position: absolute; top: 0; height: 22px; min-width: 6px; padding: 0 6px; justify-content: flex-start; overflow: hidden;
    white-space: nowrap; text-overflow: ellipsis; font-size: 11px; border-radius: 6px; border: 1px solid rgb(255 255 255 / .35);
    background: rgb(255 255 255 / .12); color: var(--accent); cursor: grab; touch-action: none; }
  .cap:active { cursor: grabbing; }
  .cap.sel { border-color: var(--accent); background: rgb(255 255 255 / .35); font-weight: 700; z-index: 2; box-shadow: 0 0 0 1px var(--accent); }
  .animbar { position: absolute; top: 0; height: 22px; display: flex; align-items: center; padding: 0 6px; font-size: 11px;
    background: var(--tab-on); border-radius: 6px; white-space: nowrap; overflow: hidden; border: 1px solid transparent; cursor: pointer; }
  .animbar.sel { border-color: var(--accent); background: rgb(255 255 255 / .2); color: var(--accent); font-weight: 700; z-index: 2; }
  .cname { position: relative; display: inline-flex; align-items: center; gap: 2px; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .ov.media .cname { position: absolute; left: 6px; bottom: 2px; color: #fff; text-shadow: 0 1px 2px #000; max-width: calc(100% - 12px); }
  .aname { position: relative; display: inline-flex; align-items: center; gap: 2px; pointer-events: none; white-space: nowrap; overflow: hidden; }
  .wav { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .wav polygon { fill: rgb(106 184 255 / .35); }
  .aud { position: absolute; top: 0; height: 28px; min-width: 8px; padding: 0 8px; justify-content: flex-start; overflow: hidden;
    white-space: nowrap; text-overflow: ellipsis; font-size: 11px; border-radius: 6px; border: 1px solid rgb(106 184 255 / .4);
    background: rgb(106 184 255 / .12); color: var(--speaker-1); cursor: grab; touch-action: none; }
  .ov { position: absolute; top: 0; height: 36px; min-width: 8px; padding: 0 8px; justify-content: flex-start; overflow: hidden;
    white-space: nowrap; text-overflow: ellipsis; font-size: 11px; border-radius: 6px; border: 1px solid rgb(190 140 255 / .45);
    background: rgb(190 140 255 / .14); color: #c9a6ff; cursor: grab; touch-action: none; }
  .beat { position: absolute; top: 3px; bottom: 3px; width: 1px; background: rgb(106 184 255 / .7); pointer-events: none; }
  .trn { position: absolute; left: 2px; top: 2px; font-size: 11px; color: #fff; background: rgb(0 0 0 / .6); border-radius: 4px; padding: 0 3px; z-index: 1; pointer-events: none; }
  .kd { position: absolute; top: 50%; transform: translate(-50%, -50%); font-size: 9px; color: #ffd84d; pointer-events: none; text-shadow: 0 0 2px #000; }
  .ov.media { border-color: var(--border-soft); background: var(--surface); color: #fff; padding: 0; }
  .ov.media.sel { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .ov.txt { border-color: rgb(255 170 90 / .5); background: rgb(255 170 90 / .14); color: #ffbf80; }
  .ov.sel { box-shadow: 0 0 0 1px currentColor; font-weight: 700; z-index: 2; }
  .ov:hover .edge, .ov.sel .edge { background: rgb(255 255 255 / .35); }
  .aud.sel { border-color: var(--speaker-1); background: rgb(106 184 255 / .25); }
  /* Edge handles: drag to retime/trim. Wide enough for touch, invisible until hovered. */
  .edge { position: absolute; top: 0; bottom: 0; width: 8px; cursor: ew-resize; touch-action: none; z-index: 1; }
  .edge.l { left: 0; border-radius: 6px 0 0 6px; } .edge.r { right: 0; border-radius: 0 6px 6px 0; }
  .cap:hover .edge, .cap.sel .edge { background: rgb(255 255 255 / .55); }
  .aud:hover .edge, .aud.sel .edge { background: rgb(106 184 255 / .55); }
  .zchip { position: absolute; top: -9px; z-index: 3; transform: translateX(-50%); width: 18px; height: 18px; padding: 0; border-radius: 50%;
    font-size: 12px; line-height: 16px; background: var(--accent); color: #111; border: 1px solid #0006; cursor: ew-resize; }
  .pend { position: absolute; top: 20px; bottom: 0; pointer-events: none; z-index: 1;
    background: repeating-linear-gradient(45deg, rgb(255 107 107 / .35) 0 4px, rgb(255 107 107 / .12) 4px 8px); border-left: 1px solid #ff6b6b; border-right: 1px solid #ff6b6b; }
  .guide { position: absolute; top: 0; bottom: 0; width: 1px; background: #ffd84d; pointer-events: none; z-index: 4; box-shadow: 0 0 4px #ffd84d; }
  .range { position: absolute; top: 0; bottom: 0; background: rgb(255 216 77 / .12); border-left: 1px solid #ffd84d; border-right: 1px solid #ffd84d;
    pointer-events: none; z-index: 1; min-width: 1px; }
  .mk { position: absolute; top: 2px; font-size: 10px; font-weight: 700; color: #1a1a1a; background: #ffd84d; border-radius: 3px; padding: 0 3px; }
  .mk.in { left: 2px; } .mk.out { right: 2px; }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent); pointer-events: none; transform: translateX(-1px); }
  .playhead::before { content: ''; position: absolute; top: -2px; left: -4px; border: 5px solid transparent; border-top-color: var(--accent); }
  /* Grab area around the playhead's head, wider than it looks so a finger can catch it. */
  .knob { position: absolute; top: -4px; left: -12px; width: 26px; height: 26px; pointer-events: auto; touch-action: none; cursor: ew-resize; z-index: 3; }
  /* On touch, unselected items pan (in JS) instead of dragging, so let vertical scroll through. */
  @media (pointer: coarse) { .cap:not(.sel), .aud:not(.sel), .ov:not(.sel), :not(.sel) > .edge { touch-action: pan-y; } }
  /* Centred playhead: half-width spacers let time 0 and the end both reach the centre line;
     swipes anywhere (tracks, ruler) scroll natively, and scroll position is the playhead time. */
  .scroller.centered { position: relative; overflow: hidden; }
  .scroller.centered .inner { will-change: transform; }
  .scroller.centered .ruler { touch-action: pan-y; }
  .scroller.centered .playhead { display: none; }
  .centerline { position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; transform: translateX(-1px); background: var(--accent); pointer-events: none; z-index: 5; }
  .centerline::before { content: ''; position: absolute; top: -2px; left: -4px; border: 5px solid transparent; border-top-color: var(--accent); }
  @media (pointer: coarse) { .knob { left: -16px; width: 34px; height: 34px; } }
</style>
