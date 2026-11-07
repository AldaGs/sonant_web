<script lang="ts">
  import { t } from './i18n.svelte';
  import { perf, setPerf, hasWebGPU, hasWebGL2, gpuName, KEY_RES, type Accel } from './perf';

  // Device performance settings (this browser, all projects).
  let { onclose }: { onclose: () => void } = $props();
  let accel = $state<Accel>(perf.accel);
  let keyRes = $state(perf.keyRes);
  const name = gpuName(), webgpu = hasWebGPU(), webgl = hasWebGL2();
  $effect(() => setPerf({ accel, keyRes }));
  const yes = (b: boolean) => (b ? t('perf.yes') : t('perf.no'));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="keys-bg" onclick={onclose}>
  <div class="keys perf" role="dialog" aria-modal="true" aria-label={t('perf.title')} tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <h3>{t('perf.title')}</h3>
    <p class="muted small">{t('perf.hint')}</p>
    <dl class="dev">
      <dt>{t('perf.gpu')}</dt><dd class="mono small">{name || '—'}</dd>
      <dt>WebGPU</dt><dd>{yes(webgpu)} <span class="muted small">({t('perf.webgpuUse')})</span></dd>
      <dt>WebGL2</dt><dd>{yes(webgl)} <span class="muted small">({t('perf.webglUse')})</span></dd>
    </dl>
    <fieldset>
      <legend>{t('perf.accel')}</legend>
      {#each ['auto', 'gpu', 'cpu'] as const as a (a)}
        <label class="chk"><input type="radio" name="accel" value={a} bind:group={accel} /> <b>{t('perf.m.' + a)}</b> <span class="muted small">{t('perf.' + a + 'Tip')}</span></label>
      {/each}
    </fieldset>
    <label class="vol">{t('perf.keyRes')}
      <select bind:value={keyRes}>
        {#each KEY_RES as r (r)}<option value={r}>{r ? `${r}px` : t('perf.keyAuto')}</option>{/each}
      </select>
    </label>
    <p class="muted small">{t('perf.note')}</p>
    <button class="sm" onclick={onclose}>OK</button>
  </div>
</div>

<style>
  .keys-bg { position: fixed; inset: 0; z-index: 50; background: rgb(0 0 0 / .55); display: grid; place-items: center; padding: 16px; }
  .keys { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; width: min(460px, 100%); max-height: 90vh; overflow: auto; }
  h3 { margin: 0; font-size: 15px; }
  .perf { max-width: 460px; display: grid; gap: 10px; }
  .dev { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
  .dev dt { font-weight: 600; }
  .dev dd { margin: 0; overflow-wrap: anywhere; }
  fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 6px; }
  legend { font-weight: 600; margin-bottom: 4px; }
</style>
