<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from './i18n.svelte';
  import { advice, report, dismissCrash, clearErrors, type Crash } from './crash';

  // What went wrong last time (the tab crashed during heavy work, or the editor failed to open), what was
  // running, and what to try. `error` is set when this screen replaces a part of the app that failed.
  let { crash, error = null, onclose, onopen }: {
    crash: Crash | null;
    error?: unknown;
    onclose?: () => void; // dismiss (crash notes) or go back home (failed screen)
    onopen?: () => void; // open the project anyway (after a crash while opening it)
  } = $props();

  const op = $derived(crash?.op ?? 'error');
  const info = $derived(Object.entries(crash?.info ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · '));
  let copied = $state(false);
  async function copy() {
    const text = report(crash, error ? { 'Screen error': String((error as Error)?.stack ?? (error as Error)?.message ?? error) } : {});
    try { await navigator.clipboard.writeText(text); copied = true; } catch { prompt(t('crash.copyManual'), text); }
  }
  function close() {
    dismissCrash();
    clearErrors();
    onclose?.();
  }
</script>

<section class="crash" role="alert">
  <h2><Icon name="error" size={20} /> {error ? t('crash.screenTitle') : t('crash.title', { op: t('crash.op.' + op) })}</h2>
  {#if error}<p class="mono small">{String((error as Error)?.message ?? error)}</p>{/if}
  {#if crash}
    <p class="small">{t('crash.when', { when: new Date(crash.at).toLocaleString() })}{#if info}<br /><span class="mono">{info}</span>{/if}</p>
    <ul class="small">{#each advice(op) as k}<li>{t(k)}</li>{/each}</ul>
  {/if}
  <div class="row">
    <button class="sm" onclick={copy}><Icon name="content_copy" size={16} /> {copied ? t('crash.copied') : t('crash.copy')}</button>
    {#if onopen}<button class="sm" onclick={onopen}>{t('crash.openAnyway')}</button>{/if}
    {#if error}<button class="sm" onclick={() => location.reload()}>{t('crash.reload')}</button>{/if}
    <button class="sm primary" onclick={close}>{error ? t('crash.home') : t('crash.ok')}</button>
  </div>
</section>

<style>
  .crash { border: 1px solid #ff6b6b88; background: #ff6b6b14; border-radius: 12px; padding: 14px 16px; display: grid; gap: 8px; margin: 12px 0; }
  h2 { margin: 0; font-size: 15px; display: flex; gap: 8px; align-items: center; }
  p, ul { margin: 0; }
  ul { padding-left: 18px; display: grid; gap: 2px; }
  .mono { overflow-wrap: anywhere; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
