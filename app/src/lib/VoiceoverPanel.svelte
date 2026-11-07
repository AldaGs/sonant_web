<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from './i18n.svelte';
  import { VOICES, voiceById, defaultVoice, speak, toWav, type Voice } from './tts';
  import { gpuFor } from './perf';
  import type { Caption } from './captions';

  // AI voiceover: a typed script added at the playhead, or each caption read at its own time (dubbing).
  let { caps, selectedIds, lang, disabled = false, onadd }: {
    caps: Caption[]; // captions as shown (translation included), in OUTPUT time
    selectedIds: Set<string>;
    lang: 'english' | 'spanish' | null;
    disabled?: boolean;
    onadd: (items: { file: File; at: number }[]) => void; // `at` in output time; null-ish at → playhead
  } = $props();

  const fastGpu = gpuFor.whisper(); // WebGPU available and allowed by the Performance setting
  let mode = $state<'script' | 'captions'>('script');
  let script = $state('');
  let langPick = $state<'en' | 'es'>('en');
  let voiceId = $state(defaultVoice('en', fastGpu).id);
  // Follow the project's transcription language (it loads after the panel mounts).
  $effect(() => { if (lang) pickLang(lang === 'spanish' ? 'es' : 'en'); });
  let speed = $state(1);
  let busy = $state(false);
  let status = $state(''), pct = $state(0), err = $state(''), detail = $state('');
  let previewEl: HTMLAudioElement | null = null;

  const voices = $derived(VOICES.filter((v) => v.lang === langPick));
  const voice = $derived(voiceById(voiceId)!);
  const label = (v: Voice) => `${v.best ? '★ ' : ''}${v.name} · ${v.accent} ${v.gender === 'f' ? '♀' : '♂'} · ${v.engine === 'kokoro' ? 'Kokoro' : 'Piper'}`;
  const pickLang = (l: 'en' | 'es') => ((langPick = l), (voiceId = defaultVoice(l, fastGpu).id));
  const targetCaps = $derived(selectedIds.size ? caps.filter((c) => selectedIds.has(c.id)) : caps);
  const capText = (c: Caption) => c.words.map((w) => w.text).join(' ');
  const SAMPLE = { en: 'Hi! This is how this voice sounds in your video.', es: '¡Hola! Así suena esta voz en tu video.' };

  const onStatus = (s: string, p: number) => ((status = s), (pct = p));
  const fileName = (s: string) => `${t('voiceover')} · ${voice.name} · ${s.slice(0, 24).replace(/[\\/:*?"<>|]/g, '')}.wav`;

  async function run(job: () => Promise<void>) {
    busy = true;
    err = detail = '';
    try {
      await job();
    } catch (e) {
      const m = (e as Error)?.message ?? '';
      err = m.startsWith('err.') ? m : 'err.voice';
      detail = m.startsWith('err.') ? '' : m;
    } finally {
      busy = false;
      status = '';
    }
  }
  const preview = () => run(async () => {
    const r = await speak(SAMPLE[langPick], voiceId, { speed, gpu: fastGpu }, onStatus);
    previewEl?.pause();
    previewEl = new Audio(URL.createObjectURL(toWav(r.audio, r.sr)));
    previewEl.play().catch(() => {});
  });
  const generate = () => run(async () => {
    if (mode === 'script') {
      const r = await speak(script, voiceId, { speed, gpu: fastGpu }, onStatus);
      onadd([{ file: new File([toWav(r.audio, r.sr)], fileName(script), { type: 'audio/wav' }), at: NaN }]);
    } else {
      const items: { file: File; at: number }[] = [];
      for (const [i, c] of targetCaps.entries()) {
        const text = capText(c);
        if (!text.trim()) continue;
        const r = await speak(text, voiceId, { speed, gpu: fastGpu }, (s, p) => onStatus(s, ((i + p / 100) / targetCaps.length) * 100));
        items.push({ file: new File([toWav(r.audio, r.sr)], fileName(text), { type: 'audio/wav' }), at: c.words[0].start });
      }
      if (items.length) onadd(items);
    }
  });
</script>

<details class="vo">
  <summary><Icon name="record_voice_over" size={16} /> {t('voiceover')}</summary>
  <p class="muted small">{t('voHint')}</p>
  <div class="seg" role="group" aria-label={t('voLang')}>
    <button class="sm" class:on={langPick === 'en'} aria-pressed={langPick === 'en'} onclick={() => pickLang('en')}>English</button>
    <button class="sm" class:on={langPick === 'es'} aria-pressed={langPick === 'es'} onclick={() => pickLang('es')}>Español</button>
  </div>
  <label class="vol">{t('voVoice')}
    <select bind:value={voiceId} disabled={busy}>
      {#each voices as v (v.id)}<option value={v.id}>{label(v)}</option>{/each}
    </select>
  </label>
  <p class="muted small">
    {voice.engine === 'kokoro' ? t('voKokoro', { mb: fastGpu ? 330 : voice.mb }) : t('voPiper', { mb: voice.mb })}
    {#if voice.engine === 'kokoro' && !fastGpu}{t('voSlow')}{/if}
  </p>
  {#if voice.engine === 'kokoro'}
    <label class="vol">{t('voSpeed')} <span class="mono small">{speed.toFixed(2)}×</span>
      <input type="range" min="0.6" max="1.6" step="0.05" bind:value={speed} disabled={busy} /></label>
  {/if}
  <div class="seg" role="group" aria-label={t('voMode')}>
    <button class="sm" class:on={mode === 'script'} aria-pressed={mode === 'script'} onclick={() => (mode = 'script')}>{t('voScript')}</button>
    <button class="sm" class:on={mode === 'captions'} aria-pressed={mode === 'captions'} onclick={() => (mode = 'captions')} disabled={!caps.length}>{t('voCaptions')}</button>
  </div>
  {#if mode === 'script'}
    <textarea rows="4" bind:value={script} placeholder={t('voPlaceholder')} disabled={busy}></textarea>
  {:else}
    <p class="muted small">{t('voCapsInfo', { n: targetCaps.length })}</p>
  {/if}
  <div class="row">
    <button class="sm" onclick={preview} disabled={busy || disabled}><Icon name="play_arrow" size={16} /> {t('voPreview')}</button>
    <button class="sm primary" onclick={generate} disabled={busy || disabled || (mode === 'script' ? !script.trim() : !targetCaps.length)}>
      <Icon name="add" size={16} /> {t('voGenerate')}</button>
  </div>
  {#if busy}<p class="muted small" role="status">{t(status || 'st.speaking')} {Math.round(pct)}%</p>{/if}
  {#if err}<p class="err small" role="alert">{t(err)}{#if detail}<br /><span class="muted mono">{detail}</span>{/if}</p>{/if}
</details>

<style>
  .vo { display: grid; gap: 8px; margin-top: 12px; }
  .vo summary { cursor: pointer; font-weight: 600; display: flex; gap: 6px; align-items: center; }
  .vo[open] { display: grid; }
  .seg, .row { display: flex; gap: 6px; flex-wrap: wrap; }
  textarea, select { width: 100%; max-width: 100%; box-sizing: border-box; }
  textarea { resize: vertical; }
  .vo :global(.vol) { min-width: 0; }
  .err { color: var(--danger, #ff6b6b); margin: 0; overflow-wrap: anywhere; }
</style>
