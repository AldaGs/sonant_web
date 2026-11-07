<script lang="ts">
  import Icon from './Icon.svelte';
  import { exportVideo, outputSize, type Aspect, type Res, type Quality, type ExportSource } from './export';
  import type { Caption } from './captions';
  import type { Segment } from './cuts';
  import type { Style } from './render';
  import { t } from './i18n.svelte';

  let { source, name, segments, captions, style, srcW, srcH, canvasAspect = 'source' }: {
    source: () => ExportSource; name: string; segments: Segment[]; captions: Caption[]; style: Style; srcW: number; srcH: number;
    canvasAspect?: Aspect; // the project's canvas shape: the default output shape
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let quality = $state<Quality>('standard');
  let loudness = $state(true);
  let voice = $state(false);
  let res = $state<Res>('source');
  let aspect = $state<Aspect>('source');
  let fps = $state(30);
  let progress = $state(0);
  let running = $state(false);
  let error = $state('');
  let result = $state<{ url: string; name: string; mb: string; secs: string; file: File } | null>(null);
  // Web Share with files (phones, Safari, Chrome on Windows/ChromeOS/Android): send the MP4 straight to an app.
  const canShare = (f: File) => typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [f] });
  async function share() {
    if (!result) return;
    try { await navigator.share({ files: [result.file], title: result.name }); }
    catch (e) { if ((e as Error).name !== 'AbortError') error = 'ex.shareFail'; }
  }
  let abort: AbortController | null = null;

  const QUALITIES: Quality[] = ['draft', 'standard', 'high'];
  const RESES: Res[] = ['source', 2160, 1080, 720, 540, 480];
  // One-click settings for where the video is going. Upscaling past the source isn't offered as a preset.
  type Preset = { id: string; aspect: Aspect; res: Res; fps: number; quality: Quality };
  const PRESETS: Preset[] = [
    { id: 'tiktok', aspect: '9:16', res: 1080, fps: 30, quality: 'high' },
    { id: 'reels', aspect: '9:16', res: 1080, fps: 30, quality: 'high' },
    { id: 'shorts', aspect: '9:16', res: 1080, fps: 30, quality: 'high' },
    { id: 'igfeed', aspect: '4:5', res: 1080, fps: 30, quality: 'high' },
    { id: 'yt1080', aspect: '16:9', res: 1080, fps: 30, quality: 'high' },
    { id: 'yt4k', aspect: '16:9', res: 2160, fps: 30, quality: 'high' },
  ];
  let preset = $state('');
  function usePreset(p: Preset) {
    preset = p.id;
    ((aspect = p.aspect), (res = p.res), (fps = p.fps), (quality = p.quality), (loudness = true));
  }
  // Editing any field by hand leaves the preset.
  $effect(() => {
    const p = PRESETS.find((x) => x.id === preset);
    if (p && (p.aspect !== aspect || p.res !== res || p.fps !== fps || p.quality !== quality)) preset = '';
  });
  const upscale = $derived(srcW && res !== 'source' && res > Math.min(srcW, srcH));
  const size = $derived(srcW ? outputSize(srcW, srcH, res, aspect) : null);

  export function open() {
    error = '';
    aspect = canvasAspect;
    dialog?.showModal();
  }

  // Save the rendered file right away; the link in the dialog stays as a fallback if the browser blocks it.
  function download(url: string, file: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
  }

  async function start() {
    if (result) URL.revokeObjectURL(result.url);
    result = null;
    error = '';
    running = true;
    progress = 0;
    abort = new AbortController();
    const t0 = performance.now();
    try {
      // Snapshot so edits during export don't change what's being rendered.
      const blob = await exportVideo(source(), $state.snapshot(segments), $state.snapshot(captions), $state.snapshot(style),
        { res, aspect, fps, quality, loudness, voice }, (p) => (progress = p), abort.signal);
      result = {
        url: URL.createObjectURL(blob),
        name: (name || 'sonant') + '-captioned.mp4',
        mb: (blob.size / 1e6).toFixed(1),
        secs: ((performance.now() - t0) / 1000).toFixed(1),
        file: new File([blob], (name || 'sonant') + '-captioned.mp4', { type: 'video/mp4' }),
      };
      download(result.url, result.name);
    } catch (e) {
      error = (e as Error).name === 'AbortError' ? 'ex.cancelled' : (e as Error).message;
    } finally {
      running = false;
    }
  }
</script>

<dialog bind:this={dialog} oncancel={(e) => running && e.preventDefault()} aria-labelledby="ex-title">
  <div class="head">
    <h3 id="ex-title">{t('ex.title')}</h3>
    <button class="icon sm" onclick={() => dialog?.close()} disabled={running} aria-label={t('ex.close')}><Icon name="close" /></button>
  </div>

  <fieldset disabled={running}>
    <legend>{t('ex.presets')}</legend>
    <div class="presets">
      {#each PRESETS as p}
        <button class="sm" class:on={preset === p.id} aria-pressed={preset === p.id} onclick={() => usePreset(p)}>
          {t('exp.' + p.id)}<span class="muted">{p.aspect} · {p.res === 2160 ? '4K' : p.res + 'p'}</span></button>
      {/each}
    </div>
  </fieldset>

  <fieldset disabled={running}>
    <legend>{t('ex.quality')}</legend>
    <div class="seg">
      {#each QUALITIES as q}
        <button class:on={quality === q} aria-pressed={quality === q} onclick={() => (quality = q)}>{t('ex.' + q)}</button>
      {/each}
    </div>
    <p class="muted">{t('exd.' + quality)}</p>
  </fieldset>

  <fieldset disabled={running}>
    <legend>{t('ex.res')}</legend>
    <div class="seg">
      {#each RESES as r}
        <button class:on={res === r} aria-pressed={res === r} onclick={() => (res = r)}>{r === 'source' ? t('ex.original') : r === 2160 ? '4K' : `${r}p`}</button>
      {/each}
    </div>
    {#if upscale}<p class="muted">{t('ex.upscale')}</p>{/if}
  </fieldset>

  <div class="two">
    <label>{t('ex.shape')}
      <select bind:value={aspect} disabled={running}>
        <option value="source">{t('ex.original')}</option>
        <option value="9:16">{t('ex.vertical')}</option>
        <option value="16:9">{t('ex.wide')}</option>
        <option value="1:1">{t('ex.square')}</option>
        <option value="4:5">4:5</option>
      </select>
    </label>
    <label>{t('ex.fps')}
      <select bind:value={fps} disabled={running}>
        <option value={24}>24 fps</option>
        <option value={30}>30 fps</option>
        <option value={60}>60 fps</option>
      </select>
    </label>
  </div>

  <div class="checks">
    <label title={t('ex.loudTip')}><input type="checkbox" bind:checked={loudness} disabled={running} /> {t('ex.loud')}</label>
    <label title={t('ex.voiceTip')}><input type="checkbox" bind:checked={voice} disabled={running} /> {t('ex.voice')}</label>
  </div>

  {#if size}<p class="muted summary">{t('ex.summary', { w: size.width, h: size.height })}</p>{/if}

  {#if running}
    <progress max="1" value={progress}></progress>
    <p class="muted">{Math.round(progress * 100)}%</p>
  {/if}
  {#if error}<p class="error">{t(error)}</p>{/if}
  {#if result}
    <p>{t('ex.done', { s: result.secs, mb: result.mb })}</p>
    <a class="dl" href={result.url} download={result.name}>{t('ex.download', { name: result.name })}</a>
    {#if canShare(result.file)}<button class="sm" onclick={share}>{t('ex.share')}</button>{/if}
  {/if}

  <div class="actions">
    {#if running}
      <button onclick={() => abort?.abort()}>{t('ex.cancel')}</button>
    {:else}
      <button onclick={() => dialog?.close()}>{t('ex.cancel')}</button>
      <button class="primary" onclick={start}>{result ? t('ex.goAgain') : t('ex.go')}</button>
    {/if}
  </div>
</dialog>

<style>
  .presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .presets button { display: grid; gap: 2px; height: auto; padding: 6px 4px; font-size: 12px; }
  .presets .muted { font-size: 10px; }
  .checks { display: grid; gap: 6px; font-size: 13px; }
  .checks label { display: flex; gap: 8px; align-items: center; }
  dialog { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 14px;
    width: min(480px, calc(100vw - 32px)); padding: 20px; }
  dialog::backdrop { background: rgb(0 0 0 / .6); }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  fieldset { border: 0; padding: 0; margin: 14px 0 0; }
  legend, label { font-size: 13px; color: var(--muted); margin-bottom: 8px; padding: 0; }
  .seg { display: flex; gap: 4px; background: var(--surface); border-radius: 10px; padding: 4px; }
  .seg button { flex: 1; border: 0; height: 34px; border-radius: 8px; font-size: 13px; }
  .seg button.on { background: var(--tab-on); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
  label { display: grid; gap: 6px; margin: 0; }
  select { height: 36px; padding: 0 8px; }
  p { margin: 8px 0 0; font-size: 13px; }
  .summary { margin-top: 14px; }
  progress { width: 100%; margin-top: 12px; accent-color: var(--accent); }
  .dl { display: block; margin-top: 10px; padding: 10px; text-align: center; background: var(--accent); color: var(--on-accent);
    font-weight: 600; border-radius: 10px; text-decoration: none; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  @media (max-width: 420px) { .two { grid-template-columns: 1fr; } }
</style>
