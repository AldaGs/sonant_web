<script lang="ts">
  import { PRESETS, resolveStyle, type Style, type Animation, type Easing } from './render';
  import type { Font } from './fonts';
  import type { Caption } from './captions';
  import { captionText } from './captions';
  import { t } from './i18n.svelte';

  let {
    style = $bindable(),
    selectedCap = null,
    capIndex = -1,
    selectedCount = 1,
    fonts,
    fontError,
    onlocal,
    onupload,
    onupdatecapstyle,
    onapplyall,
    onresetcapstyle,
    onclearcapselection,
  }: {
    style: Style;
    selectedCap?: Caption | null;
    capIndex?: number;
    selectedCount?: number; // how many captions edits apply to
    fonts: Font[];
    fontError: string;
    onlocal: () => void;
    onupload: (f: File | undefined) => void;
    onupdatecapstyle: (override: Partial<Style>) => void;
    onapplyall: () => void;
    onresetcapstyle: () => void;
    onclearcapselection: () => void;
  } = $props();

  const ANIMS: Animation[] = [
    'elastic',
    'pill',
    'pop',
    'slide-up',
    'slide-in',
    'wave',
    'glitch',
    'neon',
    'karaoke',
    'typewriter',
    'fade',
    'bounce',
    'none',
  ];
  // Settings are split into tabs so each fits without scrolling.
  type Tab = 'style' | 'anim' | 'text';
  const TABS: [Tab, string][] = [['style', 'style'], ['anim', 'animation'], ['text', 'text']];
  let tab = $state<Tab>('style');

  const EASES: Easing[] = ['ease-out', 'spring', 'quart-out', 'ease-in-out', 'back', 'linear'];

  const effectiveStyle = $derived(selectedCap ? resolveStyle(style, selectedCap.style) : style);

  // Which preset matches the current look.
  const activePreset = $derived(
    Object.keys(PRESETS).find((k) => {
      const p = PRESETS[k];
      return (
        p.family === effectiveStyle.family &&
        p.color === effectiveStyle.color &&
        p.highlight === effectiveStyle.highlight &&
        p.uppercase === effectiveStyle.uppercase &&
        p.box === effectiveStyle.box &&
        p.italic === effectiveStyle.italic
      );
    }),
  );

  function updateField<K extends keyof Style>(k: K, v: Style[K]) {
    if (selectedCap) {
      onupdatecapstyle({ [k]: v });
    } else {
      style = { ...style, [k]: v };
    }
  }

  function applyPreset(p: Style) {
    const keepAnim = {
      animation: effectiveStyle.animation,
      duration: effectiveStyle.duration,
      easing: effectiveStyle.easing,
    };
    if (selectedCap) {
      onupdatecapstyle({
        family: p.family,
        weight: p.weight,
        italic: p.italic,
        size: p.size,
        color: p.color,
        highlight: p.highlight,
        stroke: p.stroke,
        outline: p.outline,
        box: p.box,
        uppercase: p.uppercase,
        ...keepAnim,
      });
    } else {
      style = { ...p, x: style.x, y: style.y, ...keepAnim };
    }
  }

  function pickFont(family: string) {
    const f = fonts.find((x) => x.family === family);
    if (f) {
      if (selectedCap) {
        onupdatecapstyle({ family: f.family, weight: f.weight });
      } else {
        style = { ...style, family: f.family, weight: f.weight };
      }
    }
  }
</script>

<div class="scope-panel">
  {#if selectedCap && capIndex >= 0}
    <div class="scope-header active">
      <div class="scope-title">
        <span class="badge-sel">{selectedCount > 1 ? t('editingCaptions', { n: selectedCount }) : t('editingCaption', { n: capIndex + 1 })}</span>
        <button class="icon-close" onclick={onclearcapselection} title={t('clearCapStyle')} aria-label={t('clearCapStyle')}>✕</button>
      </div>
      {#if selectedCount > 1}
        <p class="scope-snippet">{t('multiCapHint')}</p>
      {:else}
        <p class="scope-snippet">"{captionText(selectedCap)}"</p>
      {/if}
      <div class="scope-actions">
        <button class="sm-btn" onclick={onapplyall} title={t('applyAllTip')}>{t('applyAll')}</button>
        {#if selectedCap.style}
          <button class="sm-btn ghost" onclick={onresetcapstyle} title={t('resetDefaultTip')}>{t('resetDefault')}</button>
        {/if}
      </div>
    </div>
  {:else}
    <div class="scope-header">
      <span class="badge-all">{t('scopeAll')}</span>
      <p class="scope-hint">{t('editingDefault')}</p>
    </div>
  {/if}
</div>

<div class="stabs" role="tablist" aria-label={t('captionStyle')}>
  {#each TABS as [id, key]}
    <button role="tab" id="stab-{id}" aria-selected={tab === id} aria-controls="spanel-{id}" class:on={tab === id}
      onclick={() => (tab = id)}>{t(key)}</button>
  {/each}
</div>

{#if tab === 'style'}
<div class="block" role="tabpanel" id="spanel-style" aria-labelledby="stab-style">
  <h3>{t('captionStyle')}</h3>
  <div class="cards">
    {#each Object.entries(PRESETS) as [name, p]}
      <button class="card" class:on={activePreset === name} aria-pressed={activePreset === name}
        onclick={() => applyPreset(p)}>
        <span class="aa" class:boxed={!!p.box} style:font-family={`"${p.family}"`} style:font-weight={p.weight}
          style:font-style={p.italic ? 'italic' : null} style:background={p.box || null}
          style:color={p.color} style:-webkit-text-stroke={p.outline ? `1px ${p.stroke}` : null}>{p.uppercase ? 'AA' : 'Aa'}</span>
        <span class="name">{name}</span>
      </button>
    {/each}
  </div>
</div>

{:else if tab === 'anim'}
<div role="tabpanel" id="spanel-anim" aria-labelledby="stab-anim">
<section class="block">
  <h3>{t('textAnimation')}</h3>
  <div class="anims" role="radiogroup" aria-label={t('textAnimation')}>
    {#each ANIMS as a}
      <button class="anim" class:on={effectiveStyle.animation === a} role="radio" aria-checked={effectiveStyle.animation === a}
        onclick={() => updateField('animation', a)}>
        <span class="anim-label">{t('anim.' + a)}</span>
        <span class="muted">{t('animd.' + a)}</span>
      </button>
    {/each}
  </div>
</section>

<section class="block">
  <h3>{t('timing')}</h3>
  <div class="two">
    <label class="field">{t('durationMs')}
      <input type="number" min="50" max="3000" step="10" value={effectiveStyle.duration}
        onchange={(e) => updateField('duration', +e.currentTarget.value)}
        disabled={effectiveStyle.animation === 'none'} />
    </label>
    <label class="field">{t('easing')}
      <select value={effectiveStyle.easing}
        onchange={(e) => updateField('easing', e.currentTarget.value as Easing)}
        disabled={effectiveStyle.animation === 'none'}>
        {#each EASES as e}<option value={e}>{t('ease.' + e)}</option>{/each}
      </select>
    </label>
  </div>
</section>

</div>
{:else}
<div class="block" role="tabpanel" id="spanel-text" aria-labelledby="stab-text">
  <h3>{t('text')}</h3>
  <label class="field">{t('font')}
    <select value={effectiveStyle.family} onchange={(e) => pickFont(e.currentTarget.value)}>
      {#each fonts as f}<option value={f.family}>{f.family}</option>{/each}
    </select>
  </label>
  <div class="row">
    <button class="sm" onclick={onlocal}>{t('myFonts')}</button>
    <label class="btn sm-label">{t('uploadFont')}
      <input type="file" accept=".ttf,.otf,.woff,.woff2" hidden onchange={(e) => onupload(e.currentTarget.files?.[0])} />
    </label>
  </div>
  {#if fontError}<p class="error small">{t(fontError)}</p>{/if}
  <label class="field">{t('size')}
    <input type="range" min="0.03" max="0.15" step="0.005" value={effectiveStyle.size}
      oninput={(e) => updateField('size', +e.currentTarget.value)} />
  </label>
  <div class="colors">
    <label>{t('text')} <input type="color" value={effectiveStyle.color}
      onchange={(e) => updateField('color', e.currentTarget.value)} /></label>
    <label>{t('highlight')} <input type="color" value={effectiveStyle.highlight}
      onchange={(e) => updateField('highlight', e.currentTarget.value)} /></label>
    <label>{t('outline')} <input type="color" value={effectiveStyle.stroke}
      onchange={(e) => updateField('stroke', e.currentTarget.value)} /></label>
  </div>
  <label class="field">{t('outlineWidth')}
    <input type="range" min="0" max="0.25" step="0.01" value={effectiveStyle.outline}
      oninput={(e) => updateField('outline', +e.currentTarget.value)} />
  </label>
  <div class="row">
    <label class="check">
      <input type="checkbox" checked={!!effectiveStyle.box}
        onchange={(e) => updateField('box', e.currentTarget.checked ? '#111111' : '')} /> {t('bgBox')}
    </label>
    {#if effectiveStyle.box}
      <input type="color" class="boxc" value={effectiveStyle.box}
        onchange={(e) => updateField('box', e.currentTarget.value)} aria-label={t('bgBoxColor')} />
    {/if}
  </div>
  <label class="check">
    <input type="checkbox" checked={effectiveStyle.uppercase}
      onchange={(e) => updateField('uppercase', e.currentTarget.checked)} /> {t('upper')}
  </label>
  <label class="check">
    <input type="checkbox" checked={effectiveStyle.italic}
      onchange={(e) => updateField('italic', e.currentTarget.checked)} /> {t('italic')}
  </label>
  <p class="muted small">{t('dragHint')}</p>
</div>
{/if}

<style>
  .stabs { display: flex; gap: 4px; padding: 10px 16px 0; border-bottom: 1px solid var(--border-soft); position: sticky; top: 0; z-index: 1; background: var(--panel); }
  .stabs button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; height: 36px; padding: 0 12px; color: var(--muted); font-weight: 500; }
  .stabs button.on { color: var(--text); border-bottom-color: var(--accent); }
  .scope-panel {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-soft);
    background: var(--surface);
  }
  .scope-header {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .scope-header.active {
    background: rgb(200 245 96 / 0.08);
    border: 1px solid rgb(200 245 96 / 0.3);
    padding: 10px 12px;
    border-radius: 8px;
  }
  .scope-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .badge-sel {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .badge-all {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .scope-hint {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .scope-snippet {
    margin: 0;
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .scope-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  .sm-btn {
    height: 26px;
    padding: 0 10px;
    font-size: 11px;
    border-radius: 6px;
    border: 1px solid var(--border-soft);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }
  .sm-btn.ghost {
    background: transparent;
    color: var(--muted);
  }
  .sm-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .icon-close {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }
  .icon-close:hover {
    color: var(--text);
    background: var(--surface);
  }
  .block { padding: 16px; border-bottom: 1px solid var(--border-soft); }
  .block:last-child { border-bottom: 0; }
  h3 { margin-bottom: 12px; }
  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .card { height: auto; flex-direction: column; gap: 4px; padding: 14px 6px; background: var(--surface); border-radius: 10px; }
  .card.on { border: 2px solid var(--accent); padding: 13px 5px; }
  .aa { font-size: 22px; line-height: 1; }
  .aa.boxed { padding: 3px 7px; border-radius: 5px; }
  .name { font-size: 12px; color: #c6c6c6; }
  .anims { display: grid; gap: 6px; }
  .anim { height: auto; justify-content: space-between; padding: 10px 12px; border-color: var(--border-soft); font-weight: 500; text-align: left; }
  .anim-label { font-weight: 600; }
  .anim .muted { font-size: 12px; font-weight: 400; }
  .anim.on { border-color: var(--accent); background: rgb(200 245 96 / .06); }
  .field { display: grid; gap: 4px; margin: 10px 0; font-size: 12px; color: var(--muted); }
  .row { display: flex; gap: 8px; }
  .sm-label { height: 30px; font-size: 12px; border-radius: 8px; padding: 0 10px; }
  .colors { display: flex; gap: 8px; font-size: 12px; color: var(--muted); margin: 10px 0; }
  .colors label { display: grid; gap: 4px; flex: 1; }
  .colors input { width: 100%; height: 30px; padding: 2px; }
  .check { display: flex; gap: 6px; align-items: center; font-size: 13px; margin: 6px 0; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .two .field { margin: 0; }
  .two input, .two select { width: 100%; height: 36px; }
  .boxc { width: 40px; height: 28px; padding: 2px; }
  .small { font-size: 12px; }
</style>
