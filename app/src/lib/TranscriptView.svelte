<script lang="ts">
  import type { Caption, Word } from './captions';
  import { isCut, type Segment } from './cuts';
  import { isFiller, silenceRanges, search } from './transcript';
  import { t } from './i18n.svelte';

  type Range = [number, number];
  let { captions, segments, time, duration, speakers, onseek, oncut, onkeep, onspeaker, onrename }: {
    captions: Caption[]; segments: Segment[]; time: number; duration: number;
    speakers: string[]; // names; '' = default "Speaker N"
    onseek: (t: number) => void; oncut: (r: Range[]) => void; onkeep: (r: Range[]) => void;
    onspeaker: (captionIds: string[], k: number | undefined) => void; // k = speakers.length adds a new speaker
    onrename: (k: number, name: string) => void;
  } = $props();

  const words = $derived(captions.flatMap((c) => c.words));
  const capOf = $derived(captions.flatMap((c, ci) => c.words.map(() => ci))); // word index → caption index
  const cut = $derived(words.map((w) => isCut(segments, w)));
  const spk = (i: number) => captions[capOf[i]]?.speaker;

  // Paragraphs: break on pauses of 1s+, after ~30 words, or when the speaker changes. Holds word indices.
  const paragraphs = $derived.by(() => {
    const out: number[][] = [];
    words.forEach((w, i) => {
      const p = out.at(-1);
      if (p && w.start - words[i - 1].end < 1 && p.length < 30 && spk(i) === spk(i - 1)) p.push(i);
      else out.push([i]);
    });
    return out;
  });

  const COLORS = ['var(--speaker-1)', 'var(--speaker-2)', '#c8f560', '#ff7eb6', '#b39dff', '#5ee0c1'];
  const speakerColor = (k: number | undefined) => (k === undefined ? 'var(--muted)' : COLORS[k % COLORS.length]);
  const speakerName = (k: number) => speakers[k] || t('speakerN', { n: k + 1 });
  // Caption ids covered by a range of word indices.
  const capIds = (a: number, b: number) => [...new Set(capOf.slice(a, b + 1))].map((ci) => captions[ci].id);
  function pick(ids: string[], v: string) {
    onspeaker(ids, v === '' ? undefined : Number(v));
  }

  const current = $derived(words.findIndex((w) => time >= w.start && time < w.end));

  // Selection: anchor + focus word index (inclusive range).
  let anchor = $state(-1);
  let focus = $state(-1);
  const lo = $derived(Math.min(anchor, focus));
  const hi = $derived(Math.max(anchor, focus));
  const hasSel = $derived(anchor >= 0 && words.length > 0);
  const selAllCut = $derived(hasSel && cut.slice(lo, hi + 1).every(Boolean));

  // Selection indices go stale when captions change (re-transcribe, edits).
  $effect(() => {
    if (anchor >= words.length || focus >= words.length) anchor = focus = -1;
  });

  function select(i: number, extend: boolean) {
    if (extend && anchor >= 0) focus = i;
    else anchor = focus = i;
    onseek(words[i].start);
  }

  // Cut the selection, or restore it if every selected word is already cut.
  export function toggleSelection(): boolean {
    if (!hasSel) return false;
    const r: Range = [words[lo].start, words[hi].end];
    selAllCut ? onkeep([r]) : oncut([r]);
    return true;
  }

  function onclick(e: MouseEvent) {
    const i = Number((e.target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i);
    if (Number.isInteger(i)) select(i, e.shiftKey);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!words.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const from = focus < 0 ? (current >= 0 ? current : 0) : focus;
      const i = Math.max(0, Math.min(words.length - 1, from + (e.key === 'ArrowRight' ? 1 : -1)));
      select(i, e.shiftKey);
    } else if (e.key === 'Escape') anchor = focus = -1;
  }

  // Fillers and silences still in the video.
  const fillers = $derived(words.flatMap((w, i) => (isFiller(w) && !cut[i] ? [[w.start, w.end] as Range] : [])));
  const silences = $derived(
    silenceRanges(words, duration).filter(([a, b]) => !isCut(segments, { start: a, end: b })),
  );

  // Search
  let query = $state('');
  let hit = $state(0);
  const hits = $derived(search(words, query));
  const hitSet = $derived(new Set(hits));
  let box = $state<HTMLDivElement>();
  function nextHit(dir = 1) {
    if (!hits.length) return;
    hit = (hit + dir + hits.length) % hits.length;
    const i = hits[hit];
    anchor = focus = i;
    onseek(words[i].start);
    box?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  $effect(() => {
    query;
    hit = -1;
  });

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

<div class="tools">
  <div class="search">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
    <input type="search" bind:value={query} placeholder={t('searchTranscript')} aria-label={t('searchTranscript')}
      onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), nextHit(e.shiftKey ? -1 : 1))} />
    {#if query.trim()}
      <span class="count mono">{hits.length ? `${Math.max(hit, 0) + 1}/${hits.length}` : '0'}</span>
    {/if}
  </div>
  <div class="row">
    <button class="sm" disabled={!fillers.length} onclick={() => oncut(fillers)}>{t('removeFillers', { n: fillers.length })}</button>
    <button class="sm" disabled={!silences.length} onclick={() => oncut(silences)}>{t('trimSilences', { n: silences.length })}</button>
  </div>
  <p class="muted hint">{t('deleteHint')}</p>
  <details class="speakers">
    <summary>{t('speakers')} ({speakers.length})</summary>
    {#each speakers as name, k}
      <label class="spk-row">
        <span class="dot" style:background={speakerColor(k)}></span>
        <input value={name} placeholder={t('speakerN', { n: k + 1 })} aria-label={t('speakerName', { n: k + 1 })}
          onchange={(e) => onrename(k, e.currentTarget.value.trim())} />
      </label>
    {/each}
    <p class="muted hint">{t('speakersHint')}</p>
  </details>
  {#if hasSel}
    <div class="selbar">
      <span class="mono small">{fmt(words[lo].start)}–{fmt(words[hi].end)}</span>
      <select class="sm-select" aria-label={t('speakerFor')} value={spk(lo) ?? ''} onchange={(e) => pick(capIds(lo, hi), e.currentTarget.value)}>
        <option value="">{t('noSpeaker')}</option>
        {#each speakers as _, k}<option value={k}>{speakerName(k)}</option>{/each}
        <option value={speakers.length}>{t('newSpeaker')}</option>
      </select>
      <button class="sm" onclick={toggleSelection}>{selAllCut ? t('restoreSel') : t('cutSel')}</button>
      <button class="sm icon" onclick={() => (anchor = focus = -1)} aria-label={t('clearSel')}>✕</button>
    </div>
  {/if}
</div>

<!-- Listbox of words: click (mouse) or arrow keys on the focused list (keyboard). -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="words" bind:this={box} role="listbox" tabindex="0" aria-multiselectable="true" aria-label={t('transcriptAria')}
  aria-activedescendant={focus >= 0 ? `w${focus}` : undefined} {onclick} {onkeydown}>
  {#each paragraphs as p}
    {@const k = spk(p[0])}
    <div class="para" role="group" aria-label="{fmt(words[p[0]].start)} {k === undefined ? '' : speakerName(k)}"
      class:on={current >= p[0] && current <= p[p.length - 1]}>
      <div class="phead">
        <span class="mono muted small" aria-hidden="true">{fmt(words[p[0]].start)}</span>
        <select class="spk" style:color={speakerColor(k)} aria-label={t('speakerFor')} value={k ?? ''}
          onchange={(e) => pick(capIds(p[0], p[p.length - 1]), e.currentTarget.value)}>
          <option value="">{speakers.length ? t('noSpeaker') : t('addSpeaker')}</option>
          {#each speakers as _, j}<option value={j}>{speakerName(j)}</option>{/each}
          <option value={speakers.length}>{t('newSpeaker')}</option>
        </select>
      </div>
      <p>
        {#each p as i}<span id="w{i}" role="option" aria-selected={hasSel && i >= lo && i <= hi} data-i={i} class="w" class:cut={cut[i]}
            class:cur={i === current} class:sel={hasSel && i >= lo && i <= hi}
            class:hit={hitSet.has(i)} class:filler={isFiller(words[i])}>{words[i].text}</span>{' '}{/each}
      </p>
    </div>
  {/each}
</div>

<style>
  .tools { display: grid; gap: 10px; }
  .search { position: relative; display: flex; align-items: center; }
  .search svg { position: absolute; left: 12px; color: var(--muted); pointer-events: none; }
  .search input { width: 100%; height: 42px; padding-left: 38px; padding-right: 48px; }
  .count { position: absolute; right: 12px; font-size: 12px; color: var(--muted); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .hint { font-size: 12px; margin: 0; }
  .small { font-size: 12px; }
  .selbar { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: var(--surface); border: 1px solid var(--accent); border-radius: 10px; }
  .selbar .mono { flex: 1; }
  .sm-select { height: 30px; padding: 0 6px; font-size: 12px; max-width: 120px; }
  .phead { display: flex; align-items: center; gap: 10px; }
  .spk { background: none; border: 1px solid transparent; padding: 2px 4px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .spk:hover, .spk:focus-visible { border-color: var(--border); }
  .spk option { color: var(--text); background: var(--surface); }
  .speakers summary { cursor: pointer; font-size: 13px; color: var(--muted); }
  .speakers[open] { display: grid; gap: 6px; }
  .spk-row { display: flex; align-items: center; gap: 8px; }
  .spk-row input { flex: 1; height: 32px; padding: 4px 8px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
  .words { display: grid; gap: 10px; margin-top: 10px; border-radius: 10px; }
  .words:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .para { display: grid; gap: 6px; padding: 10px 12px; background: var(--card); border: 1px solid var(--border-soft); border-radius: 10px; }
  .para.on { border-color: var(--border); }
  p { margin: 0; font-size: 15px; line-height: 1.6; }
  .w { cursor: pointer; border-radius: 3px; padding: 0 1px; }
  .w:hover { background: var(--tab-on); }
  .w.cur { color: var(--accent); }
  .w.hit { background: rgb(200 245 96 / .18); }
  .w.sel { background: rgb(200 245 96 / .35); color: var(--text); }
  .w.cut { color: #6b6b6b; text-decoration: line-through; }
  .w.filler:not(.cut) { text-decoration: underline dotted #6b6b6b; }
</style>
