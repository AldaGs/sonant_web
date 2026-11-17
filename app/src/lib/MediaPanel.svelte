<script lang="ts">
  // Media tab: the asset library (import, filter, drag onto any track).
  import Icon from './Icon.svelte';
  import { t } from './i18n.svelte';
  import type { Asset } from './project';
  import type { Thumb } from './thumbs';

  let { assets, used, urls, thumbs, proxyPct, fmt,
    importMedia, addToTimeline, addOverlay, buildProxy, dropProxy, removeAsset }: {
    assets: Asset[]; used: Set<string>; urls: Record<string, string>; thumbs: Record<string, Thumb[]>;
    proxyPct: Record<string, number>; fmt: (s: number) => string;
    importMedia: (files: FileList | null) => void; addToTimeline: (a: Asset) => void; addOverlay: (a: Asset) => void;
    buildProxy: (a: Asset) => void; dropProxy: (a: Asset) => void; removeAsset: (a: Asset) => void;
  } = $props();

  let filter = $state<'all' | 'video' | 'audio' | 'image'>('all');
  const shown = $derived(assets.filter((a) => filter === 'all' || a.kind === filter));
</script>

<label class="import">
  <Icon name="upload" /> {t('importMedia')}
  <input type="file" accept="video/*,audio/*,image/*" multiple hidden onchange={(e) => importMedia(e.currentTarget.files)} />
</label>
<div class="filters" role="group" aria-label={t('assets')}>
  {#each ['all', 'video', 'audio', 'image'] as const as f}
    <button class:on={filter === f} aria-pressed={filter === f} onclick={() => (filter = f)}>{t('filter.' + f)}</button>
  {/each}
</div>
<div class="grid">
  {#each shown as a (a.id)}
    <div class="asset" draggable="true" role="listitem"
      ondragstart={(e) => e.dataTransfer?.setData('text/x-asset', a.id)}>
      <div class="thumb" class:used={used.has(a.id)}>
        {#if a.kind === 'image' && urls[a.id]}<img src={urls[a.id]} alt="" />
        {:else if a.kind === 'video' && thumbs[a.id]?.length}<img src={thumbs[a.id][Math.floor(thumbs[a.id].length / 3)].url} alt="" />
        {:else}<span class="muted ph">{#if a.kind === 'audio'}<Icon name="music_note" size={20} />{/if}{a.kind === 'audio' ? t('filter.audio') : t('filter.video')}</span>{/if}
        {#if a.kind !== 'image'}<span class="dur mono">{fmt(a.duration)}</span>{/if}
        {#if a.id in proxyPct}<span class="proxybar" style:width="{proxyPct[a.id] * 100}%" title={t('proxyBuilding')}></span>{/if}
        <span class="acts">
          <button class="sm icon" onclick={() => addToTimeline(a)} aria-label={t('addToTimeline', { name: a.name })} title={t('addToTimeline', { name: a.name })}>+</button>
          {#if a.kind === 'image'}
            <button class="sm icon" onclick={() => addOverlay(a)} aria-label={t('addOverlay', { name: a.name })} title={t('addOverlay', { name: a.name })}><Icon name="picture_in_picture_alt" /></button>
          {/if}
          {#if a.kind === 'video'}
            <button class="sm icon" class:on={!!a.proxy} aria-pressed={!!a.proxy} disabled={a.id in proxyPct}
              onclick={() => (a.proxy ? dropProxy(a) : buildProxy(a))} title={a.proxy ? t('proxyOn') : t('proxyMake')} aria-label={a.proxy ? t('proxyOn') : t('proxyMake')}><Icon name="bolt" /></button>
            <button class="sm icon" onclick={() => addOverlay(a)} aria-label={t('addOverlay', { name: a.name })} title={t('addOverlay', { name: a.name })}><Icon name="picture_in_picture_alt" /></button>
          {/if}
          <button class="sm icon" onclick={() => removeAsset(a)} aria-label={t('removeAsset', { name: a.name })} title={t('removeAsset', { name: a.name })}><Icon name="close" /></button>
        </span>
      </div>
      <span class="aname" title={a.name}>{a.name}</span>
    </div>
  {/each}
</div>
<p class="muted small">{assets.length ? t('dragToTimeline') : t('assetsHint')}</p>

<style>
  .import { display: flex; align-items: center; justify-content: center; gap: 6px; height: 42px; border: 1px dashed var(--border);
    border-radius: 10px; cursor: pointer; }
  .import:hover { border-color: var(--accent); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .asset { display: grid; gap: 4px; min-width: 0; cursor: grab; }
  .ph { display: inline-flex; align-items: center; gap: 4px; }
  .thumb { position: relative; aspect-ratio: 16 / 11; background: var(--tab-on); border-radius: 8px; overflow: hidden;
    display: grid; place-items: center; outline: none; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .thumb.used { outline: 2px solid var(--accent); }
  .dur { position: absolute; right: 4px; bottom: 4px; background: rgb(0 0 0 / .75); font-size: 11px; padding: 1px 4px; border-radius: 4px; }
  .acts { position: absolute; top: 4px; right: 4px; display: none; gap: 2px; }
  .asset:hover .acts, .asset:focus-within .acts { display: flex; }
  .acts button { width: 24px; height: 24px; background: rgb(15 15 15 / .85); }
  .proxybar { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--accent); transition: width .2s; }
  .filters { display: flex; gap: 4px; }
  .filters button { border: 0; height: 30px; font-size: 13px; color: var(--muted); border-radius: 8px; }
  .filters button.on { background: var(--tab-on); color: var(--text); }
  @media (max-width: 760px) { .acts { display: flex; } }
</style>
