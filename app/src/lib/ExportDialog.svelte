<script lang="ts">
  import { exportVideo, outputSize, type Aspect, type Res, type Quality } from './export';
  import type { Caption } from './captions';
  import type { Segment } from './cuts';
  import type { Style } from './render';
  import { t } from './i18n.svelte';

  let { file, segments, captions, style, srcW, srcH }: {
    file: File; segments: Segment[]; captions: Caption[]; style: Style; srcW: number; srcH: number;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let quality = $state<Quality>('standard');
  let res = $state<Res>('source');
  let aspect = $state<Aspect>('source');
  let fps = $state(30);
  let progress = $state(0);
  let running = $state(false);
  let error = $state('');
  let result = $state<{ url: string; name: string; mb: string; secs: string } | null>(null);
  let abort: AbortController | null = null;

  const QUALITIES: Quality[] = ['draft', 'standard', 'high'];
  const RESES: Res[] = ['source', 1080, 720, 540, 480];
  const size = $derived(srcW ? outputSize(srcW, srcH, res, aspect) : null);

  export function open() {
    error = '';
    dialog?.showModal();
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
      const blob = await exportVideo(file, $state.snapshot(segments), $state.snapshot(captions), $state.snapshot(style),
        { res, aspect, fps, quality }, (p) => (progress = p), abort.signal);
      result = {
        url: URL.createObjectURL(blob),
        name: file.name.replace(/\.[^.]+$/, '') + '-captioned.mp4',
        mb: (blob.size / 1e6).toFixed(1),
        secs: ((performance.now() - t0) / 1000).toFixed(1),
      };
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
    <button class="icon sm" onclick={() => dialog?.close()} disabled={running} aria-label={t('ex.close')}>✕</button>
  </div>

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
        <button class:on={res === r} aria-pressed={res === r} onclick={() => (res = r)}>{r === 'source' ? t('ex.original') : `${r}p`}</button>
      {/each}
    </div>
  </fieldset>

  <div class="two">
    <label>{t('ex.shape')}
      <select bind:value={aspect} disabled={running}>
        <option value="source">{t('ex.original')}</option>
        <option value="9:16">{t('ex.vertical')}</option>
        <option value="16:9">{t('ex.wide')}</option>
        <option value="1:1">{t('ex.square')}</option>
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

  {#if size}<p class="muted summary">{t('ex.summary', { w: size.width, h: size.height })}</p>{/if}

  {#if running}
    <progress max="1" value={progress}></progress>
    <p class="muted">{Math.round(progress * 100)}%</p>
  {/if}
  {#if error}<p class="error">{t(error)}</p>{/if}
  {#if result}
    <p>{t('ex.done', { s: result.secs, mb: result.mb })}</p>
    <a class="dl" href={result.url} download={result.name}>{t('ex.download', { name: result.name })}</a>
  {/if}

  <div class="actions">
    {#if running}
      <button onclick={() => abort?.abort()}>{t('ex.cancel')}</button>
    {:else}
      <button onclick={() => dialog?.close()}>{t('ex.cancel')}</button>
      <button class="primary" onclick={start}>{result ? t('ex.again') : t('export')}</button>
    {/if}
  </div>
</dialog>

<style>
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
