<script lang="ts">
  // Text panel: transcription controls, then the Transcript (word-level editing) or Captions (line list) tab.
  import Icon from './Icon.svelte';
  import TranscriptView from './TranscriptView.svelte';
  import { t } from './i18n.svelte';
  import { captionText, setText, setRange, split, mergeNext, startOf, endOf, setSpeaker, type Caption } from './captions';
  import { autoEmphasis, clearEmphasis, hasEmphasis } from './keywords';
  import type { Segment } from './cuts';
  import type { Clip } from './project';
  import type { Style } from './render';
  import type { Dir } from './translate';

  let { tab = $bindable(), language = $bindable(), transcribeTarget = $bindable(), transcriptView = $bindable(), speakers = $bindable(),
    trDir = $bindable(), showTr = $bindable(), style = $bindable(),
    notice, busy, status, pct, error, hasMedia, captions, clips, names, segments, time, duration,
    trBusy, hasTr, selectedSet, run, seek, cutRanges, keepRanges, setCaps, translateAll, active, selectCap, update, addLine, onclose }: {
    tab: 'transcript' | 'captions'; language: 'english' | 'spanish' | null; transcribeTarget: string;
    transcriptView: TranscriptView | undefined; speakers: string[]; trDir: Dir; showTr: boolean; style: Style;
    notice: string; busy: boolean; status: string; pct: number; error: string; hasMedia: boolean;
    captions: Caption[]; clips: Clip[]; names: Map<string, string>; segments: Segment[]; time: number; duration: number;
    trBusy: boolean; hasTr: boolean; selectedSet: Set<string>;
    run: () => void; seek: (s: number) => void; cutRanges: (r: [number, number][]) => void; keepRanges: (r: [number, number][]) => void;
    setCaps: (c: Caption[]) => void; translateAll: () => void; active: (c: Caption) => boolean;
    selectCap: (id: string, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
    update: (i: number, c: Caption) => void; addLine: () => void; onclose: () => void;
  } = $props();
</script>

<div class="tabs" role="tablist">
  <button role="tab" aria-selected={tab === 'transcript'} class:on={tab === 'transcript'} onclick={() => (tab = 'transcript')}>{t('transcript')}</button>
  <button role="tab" aria-selected={tab === 'captions'} class:on={tab === 'captions'} onclick={() => (tab = 'captions')}>{t('captions')}</button>
  <button class="icon sm sheet-x" onclick={onclose} aria-label={t('ex.close')}><Icon name="close" /></button>
</div>
<div class="scroll">
  {#if notice}<p class="notice">{t(notice)}</p>{/if}
  <div class="row">
    <select bind:value={language} disabled={busy} aria-label={t('language')}>
      <option value={null}>{t('auto')}</option>
      <option value="english">English</option>
      <option value="spanish">Español</option>
    </select>
    <button onclick={run} disabled={!hasMedia || busy}>{captions.length ? t('retranscribe') : t('transcribe')}</button>
  </div>
  {#if clips.length > 1}
    <select class="target" bind:value={transcribeTarget} disabled={busy} aria-label={t('transcribeWhich')}>
      <option value="all">{t('allClips')}</option>
      {#each clips as c, i (c.id)}<option value={c.id}>{i + 1}. {names.get(c.assetId)}</option>{/each}
    </select>
  {/if}
  {#if busy}
    <p class="muted small">{t(status)}</p>
    <progress max="100" value={pct}></progress>
  {/if}
  {#if error}<p class="error small">{t(error)}</p>{/if}

  {#if tab === 'transcript'}
    {#if !captions.length && !busy}<p class="muted small">{t('transcriptEmpty')}</p>{/if}
    {#if captions.length}
      <TranscriptView bind:this={transcriptView} {captions} {segments} {time} {duration}
        {speakers} onseek={seek} oncut={cutRanges} onkeep={keepRanges}
        onspeaker={(ids, k) => { if (k === speakers.length) speakers = [...speakers, '']; setCaps(setSpeaker(captions, new Set(ids), k)); }}
        onrename={(k, n) => (speakers = speakers.with(k, n))}
        onemphasis={(starts, on) => { const set = new Set(starts); setCaps(captions.map((c) => (c.words.some((w) => set.has(w.start)) ? { ...c, words: c.words.map((w) => (set.has(w.start) ? (on ? { ...w, em: true } : (({ em: _, ...r }) => r)(w)) : w)) } : c))); }} />
    {/if}
  {:else}
    <p class="muted small">{t('captionsHint')} {t('selectHint')}</p>
    {#if captions.length}
      <div class="trbox">
        <select bind:value={trDir} disabled={trBusy} aria-label={t('trDir')}>
          <option value="en-es">English → Español</option>
          <option value="es-en">Español → English</option>
        </select>
        <button class="sm" onclick={translateAll} disabled={trBusy}>{trBusy ? `${t(status || 'st.translating')} ${Math.round(pct)}%` : hasTr ? t('retranslate') : t('translate')}</button>
        {#if hasTr}
          <label class="chk"><input type="checkbox" bind:checked={showTr} /> {t('showTr')}</label>
        {/if}
      </div>
      <div class="trbox">
        <button class="sm" onclick={() => setCaps(autoEmphasis(captions))} title={t('emHint')}>{t('autoEm')}</button>
        {#if hasEmphasis(captions)}
          <button class="sm" onclick={() => setCaps(clearEmphasis(captions))}>{t('clearEm')}</button>
          <label class="sl">{t('emSize')} <span class="mono">{Math.round((style.emScale ?? 1) * 100)}%</span>
            <input type="range" min="1" max="1.5" step="0.05" value={style.emScale ?? 1} oninput={(e) => (style = { ...style, emScale: +e.currentTarget.value === 1 ? undefined : +e.currentTarget.value })} /></label>
        {/if}
        <span class="muted small">{t('emHandHint')}</span>
      </div>
    {/if}
    <ol class="caps">
      {#each captions as c, i (c.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <li class:on={active(c)} class:sel-cap={selectedSet.has(c.id)} onclick={(e) => selectCap(c.id, e)}>
          <div class="times mono">
            <input type="number" step="0.1" min="0" aria-label={t('start')} value={startOf(c).toFixed(2)}
              onchange={(e) => update(i, setRange(c, +e.currentTarget.value, endOf(c)))} />
            <input type="number" step="0.1" min="0" aria-label={t('end')} value={endOf(c).toFixed(2)}
              onchange={(e) => update(i, setRange(c, startOf(c), +e.currentTarget.value))} />
          </div>
          <div class="cap-main">
            <textarea rows="2" aria-label={t('capText')} value={captionText(c)} onfocus={() => { if (!selectedSet.has(c.id)) selectCap(c.id); seek(startOf(c)); }}
              onchange={(e) => update(i, setText(c, e.currentTarget.value))}></textarea>
            {#if c.tr !== undefined}
              <textarea class="tr" rows="1" aria-label={t('trText')} value={c.tr} placeholder={t('trText')}
                onchange={(e) => update(i, { ...c, tr: e.currentTarget.value.trim() || undefined })}></textarea>
            {/if}
            {#if c.style?.animation}
              <span class="cap-anim-tag" title={t('animBadge', { name: t('anim.' + c.style.animation) })}><Icon name="animation" size={13} /> {t('anim.' + c.style.animation)}</span>
            {/if}
          </div>
          <span class="tools">
            <button class="sm icon" title={t('playHere')} aria-label={t('playHere')} onclick={() => seek(startOf(c))}><Icon name="play_arrow" /></button>
            <button class="sm icon" title={t('splitCap')} aria-label={t('splitCap')} disabled={c.words.length < 2} onclick={() => setCaps(split(captions, i))}><Icon name="content_cut" /></button>
            <button class="sm icon" title={t('mergeNext')} aria-label={t('mergeNext')} disabled={i === captions.length - 1} onclick={() => setCaps(mergeNext(captions, i))}><Icon name="merge" /></button>
            <button class="sm icon" title={t('del')} aria-label={t('del')} onclick={() => setCaps(captions.toSpliced(i, 1))}><Icon name="close" /></button>
          </span>
        </li>
      {/each}
    </ol>
    <button class="add" onclick={addLine} disabled={!hasMedia}><Icon name="add" /> {t('addLine')}</button>
  {/if}
</div>

<style>
  .tabs { display: flex; gap: 4px; padding: 12px 16px; }
  .tabs button { border: 0; height: 36px; color: var(--muted); font-weight: 500; border-radius: 8px; }
  .tabs button.on { background: var(--tab-on); color: var(--text); }
  .sheet-x { display: none; }
  .scroll { overflow: auto; padding: 0 16px 16px; display: grid; gap: 10px; align-content: start; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row select { flex: 1; height: 36px; padding: 0 8px; }
  .target { width: 100%; height: 34px; padding: 0 8px; }
  progress { width: 100%; accent-color: var(--accent); }
  .notice { font-size: 13px; padding: 8px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); margin: 0; }
  .caps { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .caps li { position: relative; display: grid; grid-template-columns: 72px 1fr; gap: 8px; padding: 10px 12px;
    background: var(--card); border: 1px solid var(--border-soft); border-radius: 10px; cursor: pointer; }
  .caps li.on { border-color: var(--accent); }
  .caps li.sel-cap { border-color: var(--accent); background: rgb(200 245 96 / .08); box-shadow: 0 0 0 1px var(--accent); }
  .cap-main { display: grid; gap: 4px; min-width: 0; }
  .cap-anim-tag { font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: rgb(200 245 96 / .18); color: var(--accent); display: inline-flex; align-items: center; width: fit-content; }
  .times { display: grid; gap: 2px; align-content: start; }
  .times input { width: 100%; font-family: var(--mono); font-size: 12px; color: var(--muted); background: none; border: 1px solid transparent; padding: 1px 2px; }
  .times input:hover, .times input:focus { border-color: var(--border); color: var(--text); }
  textarea { resize: vertical; background: none; border: 1px solid transparent; padding: 2px 4px; font-size: 14px; line-height: 1.4; }
  textarea:hover, textarea:focus { border-color: var(--border); }
  .tools { position: absolute; top: 6px; right: 6px; display: none; gap: 2px; background: var(--card); }
  .caps li:hover .tools, .caps li:focus-within .tools { display: flex; }
  .tools button { width: 26px; height: 26px; font-size: 11px; }
  /* Touch / narrow screens: no hover, and floating tools would cover the text being edited —
     put them in their own row under the caption instead. */
  @media (hover: none), (max-width: 760px) {
    .tools { position: static; grid-column: 1 / -1; justify-content: flex-end; gap: 6px; background: none; }
    .caps li:hover .tools { display: none; }
    .caps li.sel-cap .tools, .caps li:focus-within .tools { display: flex; }
    .tools button { width: 36px; height: 32px; font-size: 13px; }
  }
  .add { border-style: dashed; height: 40px; }
  textarea.tr { margin-top: 4px; font-size: 12px; color: #9fd0ff; border-style: dashed; }
  @media (max-width: 1100px) { .scroll { max-height: 60vh; } }
  @media (max-width: 760px) {
    .scroll { max-height: none; flex: 1; min-height: 0; }
    .tabs { align-items: center; }
    .sheet-x { display: inline-flex; margin-left: auto; border: 0; }
    .tools { display: flex; }
  }
</style>
