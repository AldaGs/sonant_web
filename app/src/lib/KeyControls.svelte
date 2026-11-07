<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from './i18n.svelte';
  import { DEFAULT_KEY, type ChromaKey } from './layerfx';

  // Chroma key controls, shared by layers and main-video strips.
  // set(key, final): final = end of a gesture (one undo step); live updates come with final = false.
  let { key, set, onpick, picking = false }: {
    key: ChromaKey | undefined;
    set: (k: ChromaKey | undefined, final: boolean) => void;
    onpick: () => void; // start picking the key colour from the preview
    picking?: boolean;
  } = $props();

  const SLIDERS = [['keyTol', 'tol', 1], ['keySoft', 'soft', 0.5], ['keySpill', 'spill', 1]] as const;
</script>

<details class="lfx" open={!!key}>
  <summary>{t('chroma')}</summary>
  <label class="chk"><input type="checkbox" checked={!!key} onchange={(e) => set(e.currentTarget.checked ? { ...DEFAULT_KEY } : undefined, true)} /> {t('chromaOn')}</label>
  {#if key}
    <div class="kc">
      <label class="vol">{t('keyColor')}
        <input type="color" value={key.color} oninput={(e) => set({ ...key, color: e.currentTarget.value }, false)} onchange={(e) => set({ ...key, color: e.currentTarget.value }, true)} /></label>
      <button class="sm" class:on={picking} aria-pressed={picking} onclick={onpick} title={t('keyPickTip')}><Icon name="colorize" size={16} /> {t('keyPick')}</button>
    </div>
    {#each SLIDERS as [label, f, hi] (f)}
      <label class="vol">{t(label)} <span class="mono small">{Math.round(key[f] * 100)}%</span>
        <input type="range" min="0" max={hi} step="0.01" value={key[f]}
          oninput={(e) => set({ ...key, [f]: +e.currentTarget.value }, false)} onchange={(e) => set({ ...key, [f]: +e.currentTarget.value }, true)} />
      </label>
    {/each}
  {/if}
</details>

<style>
  .lfx { display: grid; gap: 6px; }
  .lfx summary { cursor: pointer; font-size: 0.85em; margin: 4px 0; }
  .kc { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; }
</style>
