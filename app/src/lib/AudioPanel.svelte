<script lang="ts">
  // Audio tab: the selected music item, the clips' own sound, silence removal and AI voiceover.
  import Icon from './Icon.svelte';
  import VoiceoverPanel from './VoiceoverPanel.svelte';
  import { t } from './i18n.svelte';
  import { cleanup } from './cleanup.svelte';
  import { DENOISE_LEVELS } from './denoise';
  import { VOICE_FX, type VoiceFx } from './voicefx';
  import type { Asset, AudioItem } from './project';
  import type { Caption } from './captions';

  let { selAudio, assets, names, hasClips, clipVolume = $bindable(), denoise = $bindable(), cleanPct, vfxBusy, beatBusy, silBusy, busy, hasMedia,
    setAudio, cutOnBeats, detectBeatsFor, setVoiceFx, renderItem, commit, removeAudioItem, cutAudioSilences,
    voCaps, selectedSet, language, addVoiceover }: {
    selAudio: AudioItem | undefined; assets: Asset[]; names: Map<string, string>; hasClips: boolean;
    clipVolume: number; denoise: number; cleanPct: number | null;
    vfxBusy: boolean; beatBusy: boolean; silBusy: boolean; busy: boolean; hasMedia: boolean;
    setAudio: (id: string, patch: Partial<AudioItem>) => void; cutOnBeats: (item: AudioItem, every?: number) => void;
    detectBeatsFor: (assetId: string) => void; setVoiceFx: (item: AudioItem, fx: VoiceFx | '') => void;
    renderItem: (item: AudioItem, want: { vfx?: VoiceFx; dn?: number }) => void; commit: () => void;
    removeAudioItem: () => void; cutAudioSilences: () => void;
    voCaps: Caption[]; selectedSet: Set<string>; language: 'english' | 'spanish' | null; addVoiceover: (items: { file: File; at: number }[]) => void;
  } = $props();
</script>

{#if selAudio}
  {@const ba = assets.find((a) => a.id === selAudio.assetId)}
  <section class="layer music" aria-label={t('musicH')}>
    <div class="lhead"><h3>{t('musicH')}</h3></div>
    <div class="lrow">
      <span class="aname small selname"><Icon name="music_note" size={16} /> {names.get(selAudio.assetId)}</span>
      <label class="vol inline">{t('volume')}
        <input type="range" min="0" max="1" step="0.05" value={selAudio.volume}
          oninput={(e) => setAudio(selAudio.id, { volume: +e.currentTarget.value })} />
      </label>
      {#if ba?.beats?.length}
        <span class="small mono" title={t('beatsFound', { n: ba.beats.length })}><Icon name="graphic_eq" size={16} /> {ba.bpm} BPM</span>
        <button class="sm" onclick={() => cutOnBeats(selAudio)} title={t('cutBeatsTip')}>{t('cutBeats')}</button>
        <button class="sm" onclick={() => cutOnBeats(selAudio, 2)}>{t('cutBeats2')}</button>
      {:else}
        <button class="sm" onclick={() => detectBeatsFor(selAudio.assetId)} disabled={beatBusy}>{beatBusy ? t('detecting') : t('detectBeats')}</button>
      {/if}
      <label class="vol inline" title={t('vfxTip')}>{t('vfx')}
        <select value={selAudio.vfx ?? ''} disabled={vfxBusy} onchange={(e) => setVoiceFx(selAudio, e.currentTarget.value as VoiceFx | '')}>
          <option value="">{t('vfx.none')}</option>
          {#each VOICE_FX as v}<option value={v}>{t('vfx.' + v)}</option>{/each}
        </select>
      </label>
      <label class="vol inline" title={t('dnTip')}>{t('denoise')}
        <select value={selAudio.dn ?? 0} disabled={vfxBusy} onchange={(e) => renderItem(selAudio, { vfx: selAudio.vfx, dn: +e.currentTarget.value || undefined })}>
          {#each DENOISE_LEVELS as l (l)}<option value={l}>{t('dn.' + l)}</option>{/each}
        </select>
      </label>
      {#if vfxBusy}<span class="small muted">{t('vfxBusy')}</span>{/if}
      <label class="chk" title={t('duckTip')}><input type="checkbox" checked={!!selAudio.duck}
        onchange={(e) => (commit(), setAudio(selAudio.id, { duck: e.currentTarget.checked || undefined }))} /> {t('duck')}</label>
      <button class="sm" onclick={removeAudioItem}>{t('removeAudio')}</button>
    </div>
  </section>
{/if}
{#if hasClips}
  <label class="vol">{t('clipAudio')} <span class="mono small">{Math.round(clipVolume * 100)}%</span>
    <input type="range" min="0" max="1" step="0.05" bind:value={clipVolume} />
  </label>
  <label class="vol" title={t('dnTip')}>{t('denoise')}
    <select bind:value={denoise}>
      {#each DENOISE_LEVELS as l (l)}<option value={l}>{t('dn.' + l)}</option>{/each}
    </select>
  </label>
  {#if cleanPct !== null}<p class="muted small" role="status">{t('dnBusy')} {Math.round(cleanPct)}%</p>{/if}
{/if}
<details class="audio-sil">
<summary>{t('audioSilTitle')}</summary>
<p class="muted small">{t('audioSilHint')}</p>
<label class="sl">{t('audioSilDb')} <span class="mono">{cleanup.db} dB</span>
  <input type="range" min="-60" max="-15" step="1" bind:value={cleanup.db} /></label>
<label class="sl">{t('minPause')} <span class="mono">{cleanup.min.toFixed(1)}s</span>
  <input type="range" min="0.2" max="2" step="0.1" bind:value={cleanup.min} /></label>
<label class="sl">{t('keepPad')} <span class="mono">{cleanup.pad.toFixed(2)}s</span>
  <input type="range" min="0" max="0.5" step="0.05" bind:value={cleanup.pad} /></label>
<button class="sm primary" onclick={cutAudioSilences} disabled={!hasMedia || silBusy || busy}>
  {silBusy ? t('audioSilBusy') : t('audioSilRun')}</button>
</details>
<VoiceoverPanel caps={voCaps} selectedIds={selectedSet} lang={language} disabled={!hasMedia} onadd={addVoiceover} />

<style>
  .music .aname { flex-basis: 100%; }
  .selname { max-width: 160px; color: var(--speaker-1); }
  .audio-sil { display: grid; gap: 6px; margin: 8px 0; }
  .audio-sil summary { cursor: pointer; font-weight: 600; font-size: 13px; }
</style>
