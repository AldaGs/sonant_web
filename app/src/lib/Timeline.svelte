<script lang="ts">
  import { outDuration, toOutput, toSource, captionsForOutput, type Segment } from './cuts';
  import { startOf, endOf, type Caption } from './captions';
  import type { Thumb } from './thumbs';
  import { tickStep } from './waveform';
  import { clipAt, clipStarts, itemLen, audioLanes, trimAudio, type AudioItem, type Clip } from './project';
  import { t } from './i18n.svelte';

  let {
    segments, time, clips, durations, names, thumbs, peaks, duration, captions, audios, animLabel, zoom = 1,
    selected = $bindable(-1), selectedCapIds = new Set<string>(), selectedAudio = $bindable(''), onselectcap,
    onseek, ontrim, oncommit, onmovecap, onaudio,
  }: {
    segments: Segment[];
    time: number; // sequence time
    clips: Clip[];
    durations: Map<string, number>; // assetId → seconds
    names: Map<string, string>; // assetId → file name
    thumbs: Record<string, Thumb[]>; // assetId → thumbnails (asset-local time)
    peaks: Record<string, Float32Array>; // assetId → waveform peaks
    duration: number; // sequence duration
    captions: Caption[]; // sequence time
    audios: AudioItem[]; // output time
    animLabel: string;
    zoom?: number; // 1 = whole video fits
    selected: number;
    selectedCapIds?: Set<string>; // captions selected for styling
    onselectcap: (id: string, e: MouseEvent) => void; // Ctrl/⌘ toggles, Shift selects a range
    selectedAudio: string;
    onseek: (out: number) => void;
    ontrim: (i: number, start: number, end: number) => void; // live while dragging
    oncommit: () => void; // a drag started: snapshot for undo
    onmovecap: (id: string, start: number, end: number) => void; // move or retime a caption, live, sequence time
    onaudio: (id: string, patch: Partial<AudioItem>) => void; // move or trim an audio item, live, output time
  } = $props();

  const starts = $derived(clipStarts(clips, durations));
  // Thumbnails for a kept segment: those of its clip that fall inside it.
  function segThumbs(s: Segment): Thumb[] {
    const at = clipAt(clips, durations, (s.start + s.end) / 2);
    if (!at) return [];
    const off = starts[at.index];
    return (thumbs[clips[at.index].assetId] ?? []).filter((th) => th.t >= s.start - off && th.t < s.end - off);
  }
  const clipName = (s: Segment) => {
    const at = clipAt(clips, durations, (s.start + s.end) / 2);
    return at ? names.get(clips[at.index].assetId) ?? '' : '';
  };

  function moveAudio(e: PointerEvent, item: AudioItem) {
    selectedAudio = item.id;
    const a = item.at;
    drag(e, (d) => onaudio(item.id, { at: Math.max(0, Math.min(total - 0.1, a + d)) }));
  }
  // Drag an audio item's edge to trim it (the left edge also moves its start).
  function audEdge(e: PointerEvent, item: AudioItem, side: 'start' | 'end') {
    selectedAudio = item.id;
    const dur = durations.get(item.assetId) ?? 0;
    drag(e, (d) => onaudio(item.id, trimAudio(item, dur, side, d)));
  }
  const audLen = (a: AudioItem) => itemLen(a, durations.get(a.assetId) ?? 0);
  // Overlapping audio items stack into lanes; the Music & VO row grows to fit them.
  const lanes = $derived(audioLanes(audios, (id) => durations.get(id) ?? 0));
  const laneCount = $derived(Math.max(1, ...[...lanes.values()].map((l) => l + 1)));

  let scroller = $state<HTMLDivElement>();
  let inner = $state<HTMLDivElement>();
  let wave = $state<HTMLCanvasElement>();
  let width = $state(0); // inner width in px
  const total = $derived(outDuration(segments) || 1);
  const playhead = $derived(toOutput(segments, time));
  const pct = (s: number) => `${(s / total) * 100}%`;

  // Segment positions in output time.
  const segPos = $derived.by(() => {
    let acc = 0;
    return segments.map((s) => {
      const p = { start: acc, len: s.end - s.start };
      acc += p.len;
      return p;
    });
  });
  const outCaps = $derived(captionsForOutput(captions, segments));
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
  // On touch, a zoomed timeline pans natively from the tracks; the ruler and playhead knob still scrub.
  function scrub(e: PointerEvent) {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    if (e.pointerType === 'touch' && zoom !== 1 && !(e.target as Element).closest('.ruler')) return;
    getSelection()?.removeAllRanges(); // and don't extend a selection made elsewhere on the page
    const x0 = e.clientX;
    let on = false;
    const move = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId || (!on && Math.abs(m.clientX - x0) < 3)) return;
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

  // Generic horizontal drag: calls move(deltaSeconds) live; a press without movement runs onclick.
  function drag(e: PointerEvent, move: (d: number) => void, onclick?: () => void) {
    e.stopPropagation();
    const x0 = e.clientX, perPx = total / inner!.clientWidth;
    const el = e.currentTarget as HTMLElement;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    el.onpointermove = (m) => {
      if (!moved && Math.abs(m.clientX - x0) < 3) return;
      if (!moved) ((moved = true), oncommit());
      move((m.clientX - x0) * perPx);
    };
    el.onpointerup = el.onpointercancel = (u) => {
      el.onpointermove = el.onpointerup = el.onpointercancel = null;
      if (u.type === 'pointerup' && !moved) onclick?.();
    };
  }

  function edge(e: PointerEvent, i: number, side: 'start' | 'end') {
    const s0 = segments[i];
    drag(e, (d) => (side === 'start' ? ontrim(i, s0.start + d, s0.end) : ontrim(i, s0.start, s0.end + d)));
  }

  function moveCap(e: PointerEvent, id: string) {
    const c = sourceById.get(id);
    if (!c) return;
    const a = startOf(c), b = endOf(c);
    drag(e, (d) => {
      const dd = Math.max(-a, Math.min(duration - b, d));
      onmovecap(id, a + dd, b + dd);
    }, () => onseek(toOutput(segments, a) ?? 0));
  }
  // Drag a caption's edge to change when it starts or ends (min 0.1s).
  function capEdge(e: PointerEvent, id: string, side: 'start' | 'end') {
    const c = sourceById.get(id);
    if (!c) return;
    const a = startOf(c), b = endOf(c);
    drag(e, (d) => (side === 'start'
      ? onmovecap(id, Math.max(0, Math.min(b - 0.1, a + d)), b)
      : onmovecap(id, a, Math.max(a + 0.1, Math.min(duration, b + d)))));
  }

  // Waveform of the clips' own audio: one bar every 3px, height = loudest peak under it.
  // Output x → sequence time (skipping cuts) → clip + local time → that asset's peaks.
  $effect(() => {
    const cv = wave, w = width, segs = segments, tot = total, cl = clips, durs = durations, pk = peaks;
    if (!cv || !w) return;
    const dpr = devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(28 * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#6b6b6b';
    const bar = 3 * dpr, mid = cv.height / 2;
    for (let x = 0; x < cv.width; x += bar) {
      const a = toSource(segs, (x / cv.width) * tot), b = toSource(segs, ((x + bar) / cv.width) * tot);
      const at = clipAt(cl, durs, a);
      if (!at) continue;
      const id = cl[at.index].assetId, p = pk[id], dur = durs.get(id) ?? 0;
      if (!p || !dur) continue;
      const la = at.local, lb = Math.min(dur, at.local + Math.max(0, b - a));
      let m = 0;
      for (let i = Math.floor((la / dur) * p.length), end = Math.max(i + 1, Math.ceil((lb / dur) * p.length)); i < end && i < p.length; i++) m = Math.max(m, p[i]);
      const h = Math.max(dpr, m * (cv.height - 2 * dpr));
      ctx.fillRect(x, mid - h / 2, Math.max(dpr, bar - dpr), h);
    }
  });

  // While zoomed, keep the playhead in view.
  $effect(() => {
    if (playhead === null || !scroller || zoom === 1) return;
    const x = (playhead / total) * width, sl = scroller.scrollLeft, vw = scroller.clientWidth;
    if (x < sl || x > sl + vw - 20) scroller.scrollLeft = Math.max(0, x - vw / 3);
  });
</script>

<div class="tl">
  <div class="labels" aria-hidden="true" style:--music="{laneCount * 28 - 4}px">
    <span></span>
    <span>{t('videoTrack')}</span>
    <span>{t('audioTrack')}</span>
    <span>{t('captions')}</span>
    <span>{t('animTrack')}</span>
    <span>{t('musicTrack')}</span>
  </div>

  <div class="scroller" bind:this={scroller}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="inner" style:--music="{laneCount * 28 - 4}px" bind:this={inner} bind:clientWidth={width} style:width="{zoom * 100}%" class:zoomed={zoom !== 1}
      role="slider" tabindex="0" aria-label={t('timeline')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={playhead ?? 0}
      onclick={seekAt} onpointerdown={scrub}
      onkeydown={(e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) (e.preventDefault(), onseek(Math.max(0, (playhead ?? 0) + d)));
      }}>
      <div class="ruler">
        {#each ticks as s}<span class="tick mono" style:left={pct(s)}>{label(s)}</span>{/each}
      </div>

      <div class="row">
        {#each segments as s, i}
          <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events (segment select is mouse-only; keyboard users split/delete via shortcuts) -->
          <div class="seg" class:sel={i === selected} style:left={pct(segPos[i].start)} style:width={pct(segPos[i].len)}
            onclick={() => (selected = i)} title={clipName(s)}>
            <div class="thumbs">
              {#each segThumbs(s) as th}<img src={th.url} alt="" draggable="false" />{/each}
            </div>
            <span class="cname">{clipName(s)}</span>
            {#if i === selected}
              <div class="handle l" role="slider" tabindex="-1" aria-label={t('trimStart')} aria-valuenow={s.start}
                onpointerdown={(e) => edge(e, i, 'start')}></div>
              <div class="handle r" role="slider" tabindex="-1" aria-label={t('trimEnd')} aria-valuenow={s.end}
                onpointerdown={(e) => edge(e, i, 'end')}></div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="row"><canvas bind:this={wave} class="wave"></canvas></div>

      <div class="row">
        {#each outCaps as c, i (c.id)}
          <button class="cap" class:sel={selectedCapIds.has(c.id)}
            style:left={pct(startOf(c))} style:width={pct(Math.max(0.05, endOf(c) - startOf(c)))}
            title={c.words.map((w) => w.text).join(' ')}
            onpointerdown={(e) => moveCap(e, c.id)}
            onclick={(e) => { e.stopPropagation(); onselectcap(c.id, e); }}>
            <span class="edge l" aria-hidden="true" onpointerdown={(e) => capEdge(e, c.id, 'start')}></span>{t('lineN', { n: i + 1 })}<span class="edge r" aria-hidden="true" onpointerdown={(e) => capEdge(e, c.id, 'end')}></span></button>
        {/each}
      </div>

      <div class="row">
        {#each outCaps as c (c.id)}
          {@const anim = sourceById.get(c.id)?.style?.animation}
          <button class="animbar" class:sel={selectedCapIds.has(c.id)}
            style:left={pct(startOf(c))} style:width={pct(Math.max(0.05, endOf(c) - startOf(c)))}
            title={anim ? t('anim.' + anim) : animLabel}
            onclick={(e) => { e.stopPropagation(); onselectcap(c.id, e); }}>
            {anim ? t('anim.' + anim) : animLabel}
          </button>
        {/each}
      </div>

      <div class="row music">
        {#each audios as item (item.id)}
          <button class="aud" class:sel={item.id === selectedAudio} style:left={pct(item.at)}
            style:top="{(lanes.get(item.id) ?? 0) * 28}px" style:width={pct(Math.min(audLen(item), total - item.at))}
            title={names.get(item.assetId)} aria-pressed={item.id === selectedAudio}
            onpointerdown={(e) => moveAudio(e, item)} onclick={(e) => e.stopPropagation()}>
            <span class="edge l" aria-hidden="true" onpointerdown={(e) => audEdge(e, item, 'start')}></span>♪ {names.get(item.assetId)}<span class="edge r" aria-hidden="true" onpointerdown={(e) => audEdge(e, item, 'end')}></span></button>
        {/each}
      </div>

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
  .tl { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 8px; user-select: none; -webkit-user-select: none;
    -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
  .labels, .inner { display: grid; grid-template-rows: 20px 48px 30px 22px 22px var(--music, 24px); row-gap: 6px; }
  /* Music & VO sits in its own area under a divider. */
  .labels > span:last-child, .inner > .row.music { border-top: 1px dashed var(--border); padding-top: 4px; margin-top: 2px; align-self: start; }
  .labels { font-size: 12px; color: var(--muted); align-items: center; }
  .scroller { overflow-x: auto; overflow-y: hidden; }
  .inner { position: relative; min-width: 100%; cursor: pointer; touch-action: pan-y pinch-zoom; }
  /* Zoomed: horizontal swipes on the tracks scroll the timeline; the ruler and knob keep scrubbing. */
  .inner.zoomed { touch-action: pan-x pan-y pinch-zoom; }
  .inner:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .row { position: relative; }
  .ruler { position: relative; border-bottom: 1px solid var(--border-soft); touch-action: none; }
  .tick { position: absolute; top: 0; font-size: 11px; color: var(--muted); transform: translateX(-50%); white-space: nowrap; }
  .tick:first-child { transform: none; }
  .seg { position: absolute; top: 0; bottom: 0; overflow: hidden; border-radius: 6px; background: var(--surface); border: 2px solid var(--border-soft); }
  .seg.sel { border-color: var(--accent); }
  .thumbs { display: flex; height: 100%; overflow: hidden; pointer-events: none; }
  .thumbs img { height: 100%; width: 0; flex: 1; object-fit: cover; opacity: .8; }
  .handle { position: absolute; top: 0; bottom: 0; width: 10px; background: var(--accent); cursor: ew-resize; touch-action: none; }
  .handle.l { left: 0; } .handle.r { right: 0; }
  .wave { width: 100%; height: 28px; display: block; background: var(--card); border-radius: 6px; }
  .cap { position: absolute; top: 0; height: 22px; min-width: 6px; padding: 0 6px; justify-content: flex-start; overflow: hidden;
    white-space: nowrap; text-overflow: ellipsis; font-size: 11px; border-radius: 6px; border: 1px solid rgb(200 245 96 / .35);
    background: rgb(200 245 96 / .12); color: var(--accent); cursor: grab; touch-action: none; }
  .cap:active { cursor: grabbing; }
  .cap.sel { border-color: var(--accent); background: rgb(200 245 96 / .35); font-weight: 700; z-index: 2; box-shadow: 0 0 0 1px var(--accent); }
  .animbar { position: absolute; top: 0; height: 22px; display: flex; align-items: center; padding: 0 6px; font-size: 11px;
    background: var(--tab-on); border-radius: 6px; white-space: nowrap; overflow: hidden; border: 1px solid transparent; cursor: pointer; }
  .animbar.sel { border-color: var(--accent); background: rgb(200 245 96 / .2); color: var(--accent); font-weight: 700; z-index: 2; }
  .cname { position: absolute; left: 6px; bottom: 3px; font-size: 11px; color: #fff; text-shadow: 0 1px 2px #000; pointer-events: none; white-space: nowrap; overflow: hidden; max-width: calc(100% - 12px); }
  .aud { position: absolute; top: 0; height: 24px; min-width: 8px; padding: 0 8px; justify-content: flex-start; overflow: hidden;
    white-space: nowrap; text-overflow: ellipsis; font-size: 11px; border-radius: 6px; border: 1px solid rgb(106 184 255 / .4);
    background: rgb(106 184 255 / .12); color: var(--speaker-1); cursor: grab; touch-action: none; }
  .aud.sel { border-color: var(--speaker-1); background: rgb(106 184 255 / .25); }
  /* Edge handles: drag to retime/trim. Wide enough for touch, invisible until hovered. */
  .edge { position: absolute; top: 0; bottom: 0; width: 8px; cursor: ew-resize; touch-action: none; z-index: 1; }
  .edge.l { left: 0; border-radius: 6px 0 0 6px; } .edge.r { right: 0; border-radius: 0 6px 6px 0; }
  .cap:hover .edge, .cap.sel .edge { background: rgb(200 245 96 / .55); }
  .aud:hover .edge, .aud.sel .edge { background: rgb(106 184 255 / .55); }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent); pointer-events: none; transform: translateX(-1px); }
  .playhead::before { content: ''; position: absolute; top: -2px; left: -4px; border: 5px solid transparent; border-top-color: var(--accent); }
  /* Grab area around the playhead's head, wider than it looks so a finger can catch it. */
  .knob { position: absolute; top: -4px; left: -12px; width: 26px; height: 26px; pointer-events: auto; touch-action: none; cursor: ew-resize; z-index: 3; }
  @media (pointer: coarse) { .knob { left: -16px; width: 34px; height: 34px; } }
</style>
