<script lang="ts">
  import { outDuration, toOutput, toSource, captionsForOutput, type Segment } from './cuts';
  import { startOf, endOf, type Caption } from './captions';
  import type { Thumb } from './thumbs';
  import { tickStep } from './waveform';
  import { t } from './i18n.svelte';

  let {
    segments, time, thumbs, peaks, duration, captions, animLabel, zoom = 1,
    selected = $bindable(-1), onseek, ontrim, oncommit, onmovecap,
  }: {
    segments: Segment[];
    time: number; // source time
    thumbs: Thumb[];
    peaks: Float32Array | null;
    duration: number; // source duration
    captions: Caption[]; // source time
    animLabel: string;
    zoom?: number; // 1 = whole video fits
    selected: number;
    onseek: (out: number) => void;
    ontrim: (i: number, start: number, end: number) => void; // live while dragging
    oncommit: () => void; // a drag started: snapshot for undo
    onmovecap: (id: string, start: number, end: number) => void; // live while dragging, source time
  } = $props();

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
    el.onpointerup = () => {
      el.onpointermove = el.onpointerup = null;
      if (!moved) onclick?.();
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

  // Waveform: one bar every 3px, height = loudest peak under it (cut parts skipped via output→source mapping).
  $effect(() => {
    const cv = wave, p = peaks, w = width, segs = segments, dur = duration, tot = total;
    if (!cv || !w) return;
    const dpr = devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(28 * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!p || !dur) return;
    ctx.fillStyle = '#6b6b6b';
    const bar = 3 * dpr, mid = cv.height / 2;
    for (let x = 0; x < cv.width; x += bar) {
      const a = toSource(segs, (x / cv.width) * tot), b = toSource(segs, ((x + bar) / cv.width) * tot);
      let m = 0;
      for (let i = Math.floor((a / dur) * p.length), end = Math.max(i + 1, Math.ceil((b / dur) * p.length)); i < end && i < p.length; i++) m = Math.max(m, p[i]);
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
  <div class="labels" aria-hidden="true">
    <span></span>
    <span>{t('videoTrack')}</span>
    <span>{t('audioTrack')}</span>
    <span>{t('captions')}</span>
    <span>{t('animTrack')}</span>
  </div>

  <div class="scroller" bind:this={scroller}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="inner" bind:this={inner} bind:clientWidth={width} style:width="{zoom * 100}%"
      role="slider" tabindex="0" aria-label={t('timeline')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={playhead ?? 0}
      onclick={seekAt}
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
            onclick={() => (selected = i)}>
            <div class="thumbs">
              {#each thumbs.filter((th) => th.t >= s.start && th.t < s.end) as th}<img src={th.url} alt="" />{/each}
            </div>
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
          <button class="cap" style:left={pct(startOf(c))} style:width={pct(Math.max(0.05, endOf(c) - startOf(c)))}
            title={c.words.map((w) => w.text).join(' ')} onpointerdown={(e) => moveCap(e, c.id)}
            onclick={(e) => e.stopPropagation()}>{t('lineN', { n: i + 1 })}</button>
        {/each}
      </div>

      <div class="row">
        {#if outCaps.length}
          <div class="animbar" style:left={pct(startOf(outCaps[0]))} style:right="{100 - (endOf(outCaps[outCaps.length - 1]) / total) * 100}%">
            {animLabel}
          </div>
        {/if}
      </div>

      {#if playhead !== null}<div class="playhead" style:left={pct(playhead)}></div>{/if}
    </div>
  </div>
</div>

<style>
  .tl { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 8px; }
  .labels, .inner { display: grid; grid-template-rows: 20px 48px 30px 22px 22px; row-gap: 6px; }
  .labels { font-size: 12px; color: var(--muted); align-items: center; }
  .scroller { overflow-x: auto; overflow-y: hidden; }
  .inner { position: relative; min-width: 100%; cursor: pointer; }
  .inner:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .row { position: relative; }
  .ruler { position: relative; border-bottom: 1px solid var(--border-soft); }
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
  .animbar { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; padding: 0 8px; font-size: 11px;
    background: var(--tab-on); border-radius: 6px; white-space: nowrap; overflow: hidden; }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent); pointer-events: none; transform: translateX(-1px); }
  .playhead::before { content: ''; position: absolute; top: -2px; left: -4px; border: 5px solid transparent; border-top-color: var(--accent); }
</style>
