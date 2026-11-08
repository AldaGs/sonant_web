<script lang="ts">
  // AI tools tab: transcript-driven automation — highlight shorts, speaker detection and auto-zoom.
  import Icon from './Icon.svelte';
  import { t } from './i18n.svelte';
  import { toOutput, type Segment } from './cuts';
  import { DEFAULT_AUTOZOOM, type AutoZoom } from './autozoom';
  import type { Highlight } from './highlights';
  import type { Caption } from './captions';

  let { captions, segments, highlights, hlOpts, hlReframe = $bindable(), hlBusy, shortsMade, fmt,
    findClips, setHlLen, previewClip, makeShort, makeAllShorts,
    busy, spkBusy, spkCount = $bindable(), spkSplit = $bindable(), spkStatus, spkPct, spkMsg, detectSpeakers,
    autoZoom = $bindable(), aimBusy, zoomCount, aimZooms }: {
    captions: Caption[]; segments: Segment[]; highlights: Highlight[] | null; hlOpts: { min: number; max: number };
    hlReframe: boolean; hlBusy: string; shortsMade: Record<number, string>; fmt: (s: number) => string;
    findClips: () => void; setHlLen: (min: number, max: number) => void; previewClip: (h: Highlight) => void;
    makeShort: (h: Highlight, n: number) => void; makeAllShorts: () => void;
    busy: boolean; spkBusy: boolean; spkCount: number; spkSplit: boolean; spkStatus: string; spkPct: number; spkMsg: string;
    detectSpeakers: () => void;
    autoZoom: AutoZoom | null; aimBusy: boolean; zoomCount: number; aimZooms: () => void;
  } = $props();
</script>

<p class="muted small">{t('aiHint')}</p>
<details class="hl" ontoggle={(e) => e.currentTarget.open && !highlights && captions.length && findClips()}>
<summary><Icon name="auto_awesome_motion" size={16} /> {t('hlTitle')}</summary>
{#if !captions.length}
  <p class="muted small">{t('hlNeedTranscript')}</p>
{:else}
  <p class="muted small">{t('hlHint')}</p>
  <div class="row">
    <label class="vol inline">{t('hlLen')}
      <select value={`${hlOpts.min}-${hlOpts.max}`} onchange={(e) => { const [a, b] = e.currentTarget.value.split('-').map(Number); setHlLen(a, b); }}>
        {#each ['15-30', '20-45', '30-60'] as r}<option value={r}>{r.replace('-', '–')}s</option>{/each}
      </select>
    </label>
    <button class="sm" onclick={findClips}><Icon name="refresh" size={16} /> {t('hlFind')}</button>
    <label class="chk" title={t('hlReframeTip')}><input type="checkbox" bind:checked={hlReframe} /> {t('hlReframe')}</label>
    {#if highlights?.length}
      <button class="sm" disabled={!!hlBusy} onclick={makeAllShorts}>
        <Icon name="add" size={16} /> {t('hlMakeAll')}</button>
    {/if}
  </div>
  {#if hlBusy}<p class="muted small" role="status">{hlBusy}</p>{/if}
  {#if highlights && !highlights.length}<p class="muted small">{t('hlNone')}</p>{/if}
  <ol class="hls">
    {#each highlights ?? [] as h, i (h.start)}
      <li>
        <div class="mono small">{fmt(toOutput(segments, h.start) ?? h.start)} · {Math.round(h.end - h.start)}s
          {#each h.reasons as r}<span class="chip">{t('hl.' + r)}</span>{/each}</div>
        <div class="hlt">“{h.title}”</div>
        <div class="row">
          <button class="sm" onclick={() => previewClip(h)}><Icon name="play_arrow" size={16} /> {t('hlPreview')}</button>
          {#if shortsMade[h.start]}
            <a class="btn sm" href={`#/p/${shortsMade[h.start]}`}><Icon name="open_in_new" size={16} /> {t('hlOpen')}</a>
          {:else}
            <button class="sm primary" disabled={!!hlBusy} onclick={() => makeShort(h, i + 1)}><Icon name="add" size={16} /> {t('hlMake')}</button>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
{/if}
</details>
{#if captions.length}
  <h3 class="sub">{t('spkH')}</h3>
  <div class="spkrow">
    <button class="sm" onclick={detectSpeakers} disabled={spkBusy || busy} title={t('spkTip')}><Icon name="groups" size={16} /> {t('spkDetect')}</button>
    <label class="vol inline">{t('spkCount')}
      <select bind:value={spkCount} disabled={spkBusy}>
        {#each [0, 2, 3, 4, 5, 6] as n}<option value={n}>{n ? n : t('spkAuto')}</option>{/each}
      </select>
    </label>
    <label class="chk" title={t('spkSplitTip')}><input type="checkbox" bind:checked={spkSplit} disabled={spkBusy} /> {t('spkSplit')}</label>
    {#if spkBusy}<span class="muted small" role="status">{t(spkStatus || 'st.spkListening')} {spkStatus === 'st.reading' ? '' : Math.round(spkPct) + '%'}</span>
    {:else if spkMsg}<span class="muted small" role="status">{t(spkMsg, { n: spkPct })}</span>{/if}
  </div>
  <h3 class="sub">{t('autoZoom')}</h3>
  <div class="trbox">
    <label class="chk"><input type="checkbox" checked={!!autoZoom} onchange={(e) => (autoZoom = e.currentTarget.checked ? { ...DEFAULT_AUTOZOOM } : null)} /> {t('autoZoom')}</label>
    {#if autoZoom}
      <label class="sl">{t('azStrength')} <span class="mono">+{Math.round((autoZoom.scale - 1) * 100)}%</span>
        <input type="range" min="1.05" max="1.35" step="0.05" bind:value={autoZoom.scale} /></label>
      <label class="sl">{t('azGap')} <span class="mono">{autoZoom.gap}s</span>
        <input type="range" min="1" max="8" step="0.5" bind:value={autoZoom.gap} /></label>
      <label class="chk"><input type="checkbox" bind:checked={autoZoom.sentences} /> {t('azSentences')}</label>
      <label class="chk"><input type="checkbox" bind:checked={autoZoom.shake} /> {t('azShake')}</label>
      <button class="sm" onclick={aimZooms} disabled={aimBusy || !zoomCount} title={t('azAimTip')}><Icon name="person" size={16} /> {aimBusy ? t('azAiming') : t('azAim')}</button>
      {#if autoZoom.aim && Object.keys(autoZoom.aim).length}<button class="sm" onclick={() => autoZoom && (autoZoom.aim = undefined)}>{t('azCentre')}</button>{/if}
      {#if autoZoom.edits && Object.keys(autoZoom.edits).length}<button class="sm" onclick={() => autoZoom && (autoZoom.edits = undefined)} title={t('azResetTip')}>{t('azReset')}</button>{/if}
      <span class="muted small">{t('azEditHint')}</span>
      <span class="muted small">{zoomCount ? t('azCount').replace('{n}', String(zoomCount)) : t('azNone')}</span>
    {/if}
  </div>
{/if}

<style>
  .spkrow { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; margin: 6px 0; }
  .hl { display: grid; gap: 8px; margin-bottom: 10px; }
  .hl summary { cursor: pointer; font-weight: 600; display: flex; gap: 6px; align-items: center; }
  .hl .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: end; }
  .hls { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .hls li { border: 1px solid var(--border); border-radius: 8px; padding: 8px; display: grid; gap: 6px; }
  .hls .hlt { font-size: 13px; overflow-wrap: anywhere; }
  .hls .chip { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; background: var(--tab-on); font-size: 11px; }
</style>
