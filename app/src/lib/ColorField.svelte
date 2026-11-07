<script lang="ts">
  import Icon from './Icon.svelte';
  import 'vanilla-colorful/hex-color-picker.js';
  import { t } from './i18n.svelte';

  // Swatch + hex field that opens a designer-style picker: saturation/brightness square, hue slider,
  // hex input, eyedropper (Chromium) and swatches (brand palette + recently used).
  let { value, label, oninput, onchange, onclear }: {
    value: string;
    label: string;
    oninput: (hex: string) => void; // live, while dragging
    onchange: (hex: string) => void; // final value of a gesture
    onclear?: () => void; // shows a clear button (e.g. "no fill")
  } = $props();

  const PALETTE = ['#FFFFFF', '#000000', '#C8F560', '#FFE600', '#FF3366', '#33CCFF', '#FF9F1C', '#7C5CFF'];
  const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
  const norm = (v: string) => (v.startsWith('#') ? v : '#' + v).slice(0, 7).toUpperCase();

  let open = $state(false);
  let root = $state<HTMLDivElement>();
  let host = $state<HTMLDivElement>();
  let recent = $state<string[]>(loadRecent());
  let dirty = false; // a live change happened that hasn't been committed with onchange yet
  const hasEyedropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  function loadRecent(): string[] {
    try {
      const r = JSON.parse(localStorage.getItem('recentColors') ?? '[]');
      return Array.isArray(r) ? r.filter(isHex).slice(0, 8) : [];
    } catch {
      return [];
    }
  }

  function commit(hex: string) {
    dirty = false;
    onchange(hex);
    recent = [hex, ...recent.filter((c) => c !== hex)].slice(0, 8);
    try { localStorage.setItem('recentColors', JSON.stringify(recent)); } catch {}
  }
  const pick = (hex: string) => isHex(hex) && commit(norm(hex));

  // Mount the picker web component while open, and wire its events.
  $effect(() => {
    if (!open || !host) return;
    const el = document.createElement('hex-color-picker') as HTMLElement & { color: string };
    el.color = value;
    el.setAttribute('aria-label', label);
    const live = (e: Event) => {
      dirty = true;
      oninput(norm((e as CustomEvent<{ value: string }>).detail.value));
    };
    const end = () => dirty && commit(norm(el.color));
    el.addEventListener('color-changed', live);
    el.addEventListener('pointerup', end);
    el.addEventListener('keyup', end);
    host.append(el);
    return () => el.remove();
  });

  // Keep an open picker in sync when the value changes elsewhere (hex typed, swatch, undo).
  $effect(() => {
    const el = host?.querySelector('hex-color-picker') as (HTMLElement & { color: string }) | null;
    if (el && el.color?.toUpperCase() !== value.toUpperCase()) el.color = value;
  });

  // Close on outside press or Escape; finish any half-done drag first.
  $effect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !root?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), close());
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => (document.removeEventListener('pointerdown', down, true), document.removeEventListener('keydown', key, true));
  });
  function close() {
    if (dirty) commit(norm(value));
    open = false;
  }

  async function eyedrop() {
    try {
      const r = await new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper().open();
      pick(r.sRGBHex);
    } catch {} // cancelled
  }
</script>

<div class="cf" bind:this={root}>
  <div class="fld">
    <button class="sw" style:background={value} aria-label={t('openPicker', { name: label })} aria-expanded={open}
      onclick={() => (open ? close() : (open = true))}></button>
    <input class="hex" value={value.toUpperCase()} aria-label={label} spellcheck="false"
      onchange={(e) => pick(norm(e.currentTarget.value.trim()))} />
    {#if onclear}<button class="x" title={t('removeFill')} aria-label={t('removeFill')} onclick={onclear}><Icon name="close" size={14} /></button>{/if}
  </div>

  {#if open}
    <div class="pop" role="dialog" aria-label={label}>
      <div class="picker" bind:this={host}></div>
      <div class="bar">
        <span class="cur" style:background={value}></span>
        <input class="hex big" value={value.toUpperCase()} aria-label={label} spellcheck="false"
          onchange={(e) => pick(norm(e.currentTarget.value.trim()))} />
        {#if hasEyedropper}
          <button class="eye" onclick={eyedrop} title={t('eyedropper')} aria-label={t('eyedropper')}>
            <Icon name="colorize" size={16} />
          </button>
        {/if}
      </div>
      <div class="sws" role="group" aria-label={t('swatches')}>
        {#each PALETTE as c}
          <button style:background={c} class:on={c === value.toUpperCase()} title={c} aria-label={c} onclick={() => pick(c)}></button>
        {/each}
      </div>
      {#if recent.length}
        <div class="sws" role="group" aria-label={t('recentColors')}>
          <span class="lbl">{t('recentColors')}</span>
          {#each recent as c}
            <button style:background={c} class:on={c === value.toUpperCase()} title={c} aria-label={c} onclick={() => pick(c)}></button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cf { position: relative; }
  .fld { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px; border: 1px solid var(--border);
    border-radius: 8px; background: var(--surface); }
  .fld:focus-within { border-color: var(--accent); }
  .sw { width: 18px; height: 18px; padding: 0; border: 1px solid rgb(255 255 255 / .2); border-radius: 4px; flex: none; }
  .hex { flex: 1; min-width: 0; height: 100%; border: 0; background: none; padding: 0; color: var(--text);
    font-family: var(--mono); font-size: 12px; text-transform: uppercase; }
  .hex:focus-visible { outline: none; }
  .x { height: 22px; width: 22px; padding: 0; border: 0; font-size: 11px; color: var(--muted); }
  .pop { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; width: 232px; padding: 12px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px;
    background: var(--raised); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 32px rgb(0 0 0 / .5); }
  .picker { min-width: 0; }
  .picker :global(hex-color-picker) { width: 100%; min-width: 0; height: 170px; }
  .picker :global(hex-color-picker)::part(saturation) { border-radius: 8px 8px 0 0; }
  .picker :global(hex-color-picker)::part(hue) { height: 14px; border-radius: 0 0 8px 8px; }
  .bar { display: flex; align-items: center; gap: 8px; }
  .cur { width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgb(255 255 255 / .2); flex: none; }
  .hex.big { height: 30px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); font-size: 13px; }
  .hex.big:focus-visible { border-color: var(--accent); }
  .eye { width: 30px; height: 30px; padding: 0; border-radius: 6px; }
  .sws { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .sws button { width: 20px; height: 20px; padding: 0; border-radius: 5px; border: 1px solid rgb(255 255 255 / .18); }
  .sws button.on { outline: 2px solid var(--accent); outline-offset: 1px; }
  .lbl { width: 100%; font-size: 11px; color: var(--muted); }
</style>
