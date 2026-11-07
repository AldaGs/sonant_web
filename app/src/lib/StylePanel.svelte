<script lang="ts">
  import Icon from './Icon.svelte';
  import { PRESETS, ANIM_MODES, resolveStyle, type Style, type Animation, type AnimTarget, type Easing } from './render';
  import type { Font } from './fonts';
  import type { Caption } from './captions';
  import { captionText } from './captions';
  import { t } from './i18n.svelte';
  import ColorField from './ColorField.svelte';

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
    onclearfields = () => {},
  }: {
    style: Style;
    selectedCap?: Caption | null;
    capIndex?: number;
    selectedCount?: number; // how many captions edits apply to
    fonts: Font[];
    fontError: string;
    onlocal: () => void;
    onupload: (f: File | undefined) => void;
    onupdatecapstyle: (override: Partial<Style>, live?: boolean) => void;
    onapplyall: () => void;
    onresetcapstyle: () => void;
    onclearcapselection: () => void;
    onclearfields?: (keys: (keyof Style)[]) => void; // drop these overrides from every caption
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
    'zoom-in',
    'flip',
    'drop',
    'shake',
    'spin',
    'blur-in',
    'rise',
    'swipe-up',
    'highlight',
    'none',
  ];
  const ANIM_TARGETS: AnimTarget[] = ['character', 'word', 'line', 'all'];
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

  // With captions selected, edits go to them unless "Apply to all" is on. Applying to all also clears
  // those settings from every caption override, so every caption really changes.
  let applyAll = $state(false);
  // live = part of a drag (e.g. color picker); the app makes one undo step per gesture.
  function write(patch: Partial<Style>, live = false) {
    if (selectedCap && !applyAll) return onupdatecapstyle(patch, live);
    style = { ...style, ...patch };
    if (applyAll) onclearfields(Object.keys(patch) as (keyof Style)[]);
  }
  function updateField<K extends keyof Style>(k: K, v: Style[K]) {
    write({ [k]: v } as Partial<Style>);
  }

  // A preset sets the look; the current animation, timing, target and position are kept.
  function applyPreset(p: Style) {
    const { x: _x, y: _y, animation: _a, animTarget: _at, animMode: _m, duration: _d, easing: _e, ...look } = p;
    write(look);
  }

  function pickFont(family: string) {
    const f = fonts.find((x) => x.family === family);
    if (f) write({ family: f.family, weight: f.weight });
  }

  // ---- Inspector helpers ----
  const WEIGHTS: [number, string][] = [[300, 'w.light'], [400, 'w.regular'], [500, 'w.medium'], [600, 'w.semibold'], [700, 'w.bold'], [800, 'w.extrabold'], [900, 'w.black']];
  const BORDERS: [number, string][] = [[0, 'border.none'], [0.06, 'border.thin'], [0.12, 'border.medium'], [0.18, 'border.thick']];
  const ANCHORS = [0.12, 0.5, 0.86]; // 3×3 position grid: left/center/right × top/middle/bottom
  const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
  const pct = (v: number) => Math.round(v * 100);
  // Font size shown in px at 1080p, stored as a fraction of frame height.
  const toPx = (v: number) => Math.round(v * 1080);
  // WCAG contrast of text against its box (or outline when there's no box).
  function lum(hex: string) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const contrast = $derived.by(() => {
    const bg = effectiveStyle.box || (effectiveStyle.outline > 0 ? effectiveStyle.stroke : '');
    if (!bg || !isHex(bg) || !isHex(effectiveStyle.color)) return null;
    const [a, b] = [lum(effectiveStyle.color), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });

</script>

<div class="scope-panel">
  {#if selectedCap && capIndex >= 0}
    <div class="scope-header active">
      <div class="scope-title">
        <span class="badge-sel">{selectedCount > 1 ? t('editingCaptions', { n: selectedCount }) : t('editingCaption', { n: capIndex + 1 })}</span>
        <button class="icon-close" onclick={onclearcapselection} title={t('clearCapStyle')} aria-label={t('clearCapStyle')}><Icon name="close" size={16} /></button>
      </div>
      {#if selectedCount > 1}
        <p class="scope-snippet">{t('multiCapHint')}</p>
      {:else}
        <p class="scope-snippet">"{captionText(selectedCap)}"</p>
      {/if}
      <label class="switch">
        <input type="checkbox" role="switch" bind:checked={applyAll} />
        <span class="track"><span class="knob"></span></span>
        <span>{t('applyAllToggle')}</span>
      </label>
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
  <h3>{t('animAffects')}</h3>
  <div class="seg" role="radiogroup" aria-label={t('animAffects')}>
    {#each ANIM_TARGETS as tgt}
      <button
        type="button"
        role="radio"
        aria-checked={effectiveStyle.animTarget === tgt}
        class:on={effectiveStyle.animTarget === tgt}
        disabled={effectiveStyle.animation === 'none'}
        title={t('animTargetDesc.' + tgt)}
        onclick={() => updateField('animTarget', tgt)}>
        {t('target.' + tgt)}
      </button>
    {/each}
  </div>
</section>

<section class="block">
  <h3>{t('timing')}</h3>
  <div class="seg" role="radiogroup" aria-label={t('animMode')}>
    {#each ANIM_MODES as m}
      <button type="button" role="radio" aria-checked={(effectiveStyle.animMode ?? 'in') === m}
        class:on={(effectiveStyle.animMode ?? 'in') === m}
        disabled={effectiveStyle.animation === 'none'}
        title={t('animModeDesc.' + m)}
        onclick={() => updateField('animMode', m)}>
        {t('mode.' + m)}
      </button>
    {/each}
  </div>
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
<div class="insp" role="tabpanel" id="spanel-text" aria-labelledby="stab-text">
  <section>
    <h4>{t('text')}</h4>
    <label class="prow"><span>{t('font')}</span>
      <select value={effectiveStyle.family} onchange={(e) => pickFont(e.currentTarget.value)}>
        {#each fonts as f}<option value={f.family}>{f.family}</option>{/each}
      </select>
    </label>
    <label class="prow"><span>{t('weight')}</span>
      <select value={effectiveStyle.weight} onchange={(e) => updateField('weight', +e.currentTarget.value)}>
        {#each WEIGHTS as [w, key]}<option value={w}>{t(key)}</option>{/each}
      </select>
    </label>
    <label class="prow"><span>{t('size')}</span>
      <span class="fld unit">
        <input type="number" min="12" max="200" step="1" value={toPx(effectiveStyle.size)}
          onchange={(e) => updateField('size', Math.min(200, Math.max(12, +e.currentTarget.value)) / 1080)} />
        <em>px</em>
      </span>
    </label>
    {#if effectiveStyle.size < 0.045}<p class="note warn" role="status">{t('smallText')}</p>{/if}
    <div class="prow"><span>{t('spacing')}</span>
      <span class="pair">
        <span class="fld icon" title={t('lineHeight')}>
          <Icon name="format_line_spacing" size={16} />
          <input type="number" min="0.8" max="3" step="0.1" aria-label={t('lineHeight')} value={effectiveStyle.lineHeight}
            onchange={(e) => updateField('lineHeight', +e.currentTarget.value || 1.2)} />
        </span>
        <span class="fld icon" title={t('letterSpacing')}>
          <Icon name="format_letter_spacing" size={16} />
          <input type="number" min="-0.1" max="0.5" step="0.01" placeholder={t('normal')} aria-label={t('letterSpacing')}
            value={effectiveStyle.letterSpacing || ''}
            onchange={(e) => updateField('letterSpacing', +e.currentTarget.value || 0)} />
        </span>
      </span>
    </div>
    <div class="prow"><span>{t('color')}</span>
      <ColorField value={effectiveStyle.color} label={t('color')}
          oninput={(c) => write({ color: c }, true)} onchange={(c) => write({ color: c })} />
    </div>
    {#if contrast !== null}
      <p class="note" class:bad={contrast < 4.5}>{contrast >= 4.5 ? t('goodContrast') : t('lowContrast')} · {contrast.toFixed(1)}:1</p>
    {/if}
    <div class="prow"><span>{t('highlight')}</span>
      <ColorField value={effectiveStyle.highlight} label={t('highlight')}
          oninput={(c) => write({ highlight: c }, true)} onchange={(c) => write({ highlight: c })} />
    </div>
    <div class="prow"><span>{t('align')}</span>
      <span class="seg" role="radiogroup" aria-label={t('align')}>
        {#each [['left', 'format_align_left'], ['center', 'format_align_center'], ['right', 'format_align_right']] as const as [a, ic]}
          <button role="radio" aria-checked={effectiveStyle.align === a} class:on={effectiveStyle.align === a}
            title={t('align.' + a)} aria-label={t('align.' + a)} onclick={() => updateField('align', a as Style['align'])}>
            <Icon name={ic} size={16} />
          </button>
        {/each}
      </span>
    </div>
    <div class="prow"><span>{t('case')}</span>
      <span class="seg">
        <button class:on={!effectiveStyle.uppercase} aria-pressed={!effectiveStyle.uppercase} onclick={() => updateField('uppercase', false)}>Aa</button>
        <button class:on={effectiveStyle.uppercase} aria-pressed={effectiveStyle.uppercase} onclick={() => updateField('uppercase', true)}>AA</button>
        <button class:on={effectiveStyle.italic} aria-pressed={effectiveStyle.italic} title={t('italic')} aria-label={t('italic')}
          onclick={() => updateField('italic', !effectiveStyle.italic)}><i>I</i></button>
      </span>
    </div>
  </section>

  <section>
    <h4>{t('appearance')}</h4>
    <div class="prow"><span>{t('fill')}</span>
      {#if effectiveStyle.box}
        <ColorField value={effectiveStyle.box} label={t('fill')} onclear={() => updateField('box', '')}
          oninput={(c) => write({ box: c }, true)} onchange={(c) => write({ box: c })} />
      {:else}
        <button class="fld none" onclick={() => updateField('box', '#111111')}><span class="checker"></span>{t('none')}</button>
      {/if}
    </div>
    {#if effectiveStyle.box}
      <label class="prow"><span>{t('fillAlpha')}</span>
        <span class="fld unit">
          <input type="number" min="0" max="100" step="5" value={pct(effectiveStyle.boxAlpha ?? 0.88)}
            onchange={(e) => updateField('boxAlpha', Math.min(100, Math.max(0, +e.currentTarget.value)) / 100)} />
          <em>%</em>
        </span>
      </label>
    {/if}
    <label class="prow"><span>{t('opacity')}</span>
      <span class="fld unit">
        <input type="number" min="0" max="100" step="5" value={pct(effectiveStyle.opacity)}
          onchange={(e) => updateField('opacity', Math.min(100, Math.max(0, +e.currentTarget.value)) / 100)} />
        <em>%</em>
      </span>
    </label>
    <label class="prow"><span>{t('radius')}</span>
      <span class="fld unit">
        <input type="number" min="0" max="100" step="5" value={pct(effectiveStyle.radius)} disabled={!effectiveStyle.box}
          onchange={(e) => updateField('radius', Math.min(100, Math.max(0, +e.currentTarget.value)) / 100)} />
        <em>%</em>
      </span>
    </label>
    <div class="prow"><span>{t('border')}</span>
      <span class="seg" role="radiogroup" aria-label={t('border')}>
        {#each BORDERS as [w, key]}
          {@const on = Math.abs(effectiveStyle.outline - w) < 0.03 || (w === 0.18 && effectiveStyle.outline > 0.18)}
          <button role="radio" aria-checked={on} class:on title={t(key)} aria-label={t(key)} onclick={() => updateField('outline', w)}>
            {#if w === 0}<Icon name="block" size={16} />
            {:else}<span class="line" style:height="{w * 14}px"></span>{/if}
          </button>
        {/each}
      </span>
    </div>
    {#if effectiveStyle.outline > 0}
      <div class="prow"><span>{t('borderColor')}</span>
        <ColorField value={effectiveStyle.stroke} label={t('borderColor')}
          oninput={(c) => write({ stroke: c }, true)} onchange={(c) => write({ stroke: c })} />
      </div>
    {/if}
  </section>

  <section>
    <h4>{t('effects')}</h4>
    <div class="prow"><span>{t('shadow')}</span>
      {#if effectiveStyle.shadow}
        <ColorField value={effectiveStyle.shadow} label={t('shadow')} onclear={() => updateField('shadow', '')}
          oninput={(c) => write({ shadow: c }, true)} onchange={(c) => write({ shadow: c })} />
      {:else}
        <button class="fld none" onclick={() => updateField('shadow', '#000000')}><span class="checker"></span>{t('none')}</button>
      {/if}
    </div>
    {#if effectiveStyle.shadow}
      <div class="prow"><span>{t('shadowOffset')}</span>
        <span class="pair">
          <span class="fld unit"><b>X</b>
            <input type="number" min="-100" max="100" step="1" aria-label={t('shadowOffset') + ' X'} value={pct(effectiveStyle.shadowX ?? 0)}
              onchange={(e) => updateField('shadowX', Math.min(100, Math.max(-100, +e.currentTarget.value)) / 100)} /><em>%</em>
          </span>
          <span class="fld unit"><b>Y</b>
            <input type="number" min="-100" max="100" step="1" aria-label={t('shadowOffset') + ' Y'} value={pct(effectiveStyle.shadowY ?? 0)}
              onchange={(e) => updateField('shadowY', Math.min(100, Math.max(-100, +e.currentTarget.value)) / 100)} /><em>%</em>
          </span>
        </span>
      </div>
      <label class="prow"><span>{t('blur')}</span>
        <span class="fld unit">
          <input type="number" min="0" max="100" step="1" value={pct(effectiveStyle.shadowBlur ?? 0.12)}
            onchange={(e) => updateField('shadowBlur', Math.min(100, Math.max(0, +e.currentTarget.value)) / 100)} />
          <em>%</em>
        </span>
      </label>
    {/if}
    <div class="prow"><span>{t('glow')}</span>
      {#if effectiveStyle.glow}
        <ColorField value={effectiveStyle.glow} label={t('glow')} onclear={() => updateField('glow', '')}
          oninput={(c) => write({ glow: c }, true)} onchange={(c) => write({ glow: c })} />
      {:else}
        <button class="fld none" onclick={() => updateField('glow', '#00f0ff')}><span class="checker"></span>{t('none')}</button>
      {/if}
    </div>
    {#if effectiveStyle.glow}
      <label class="prow"><span>{t('glowSize')}</span>
        <span class="fld unit">
          <input type="number" min="0" max="150" step="5" value={pct(effectiveStyle.glowSize ?? 0.3)}
            onchange={(e) => updateField('glowSize', Math.min(150, Math.max(0, +e.currentTarget.value)) / 100)} />
          <em>%</em>
        </span>
      </label>
    {/if}
  </section>

  <section>
    <h4>{t('position')}</h4>
    <div class="prow top"><span>{t('anchor')}</span>
      <span class="grid9" role="group" aria-label={t('anchor')}>
        {#each ANCHORS as y, r}
          {#each ANCHORS as x, c}
            {@const on = Math.abs(effectiveStyle.x - x) < 0.02 && Math.abs(effectiveStyle.y - y) < 0.02}
            <button class:on aria-pressed={on} title={t('anchor.' + r + c)} aria-label={t('anchor.' + r + c)}
              onclick={() => write({ x, y })}><span></span></button>
          {/each}
        {/each}
      </span>
    </div>
    <div class="prow"><span>X / Y</span>
      <span class="pair">
        <span class="fld unit"><b>X</b>
          <input type="number" min="5" max="95" step="1" aria-label={t('posX')} value={pct(effectiveStyle.x)}
            onchange={(e) => updateField('x', Math.min(95, Math.max(5, +e.currentTarget.value)) / 100)} /><em>%</em>
        </span>
        <span class="fld unit"><b>Y</b>
          <input type="number" min="5" max="95" step="1" aria-label={t('posY')} value={pct(effectiveStyle.y)}
            onchange={(e) => updateField('y', Math.min(95, Math.max(5, +e.currentTarget.value)) / 100)} /><em>%</em>
        </span>
      </span>
    </div>
    <p class="muted small">{t('dragHint')}</p>
  </section>

  <section>
    <h4>{t('fontsH')}</h4>
    <div class="row">
      <button class="sm" onclick={onlocal}>{t('myFonts')}</button>
      <label class="btn sm-label">{t('uploadFont')}
        <input type="file" accept=".ttf,.otf,.woff,.woff2" hidden onchange={(e) => onupload(e.currentTarget.files?.[0])} />
      </label>
    </div>
    {#if fontError}<p class="error small">{t(fontError)}</p>{/if}
  </section>
</div>
{/if}

<style>
  /* ---- Inspector (Text tab) ---- */
  .insp section { padding: 14px 16px; border-bottom: 1px solid var(--border-soft); display: grid; gap: 8px; }
  .insp h4 { margin: 0 0 4px; font-family: var(--display); font-size: 14px; font-weight: 700; }
  .prow { display: grid; grid-template-columns: 84px minmax(0, 1fr); align-items: center; gap: 8px; font-size: 13px; }
  .prow.top { align-items: start; }
  .prow > span:first-child { color: var(--muted); }
  .prow select, .fld { height: 32px; width: 100%; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); }
  .prow select { padding: 0 8px; }
  .fld { display: flex; align-items: center; gap: 6px; padding: 0 8px; min-width: 0; }
  .fld input { flex: 1; min-width: 0; height: 100%; border: 0; background: none; padding: 0; font: inherit; color: var(--text); }
  .fld input:focus-visible { outline: none; }
  .fld:focus-within { border-color: var(--accent); }
  .fld em { font-style: normal; color: var(--muted); font-size: 12px; }
  .fld b { color: var(--muted); font-weight: 500; font-size: 12px; }
  .fld.icon :global(.ic), .seg :global(.ic) { color: var(--muted); }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .fld.none { justify-content: flex-start; color: var(--text); font-size: 13px; cursor: pointer; }
  .checker { width: 18px; height: 18px; border-radius: 4px; flex: none;
    background: repeating-conic-gradient(#3a3a3a 0 25%, #1e1e1e 0 50%) 0 0 / 8px 8px; }
  .note.warn { color: #ffb86b; }
  .note { margin: -2px 0 0 92px; font-size: 12px; color: var(--accent); }
  .note.bad { color: #ffb86b; }
  .seg { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); }
  .seg button { flex: 1; height: 28px; padding: 0 4px; border: 0; border-radius: 6px; font-size: 12px; color: var(--muted); cursor: pointer; transition: background .12s, color .12s; }
  .seg button.on { background: var(--tab-on); color: var(--text); }
  .seg button.on :global(.ic) { color: var(--text); }
  .seg button:disabled { opacity: 0.4; cursor: not-allowed; }
  .seg .line { display: block; width: 16px; min-height: 1px; background: currentColor; border-radius: 1px; }
  .grid9 { display: grid; grid-template-columns: repeat(3, 28px); gap: 4px; padding: 6px; width: max-content;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  .grid9 button { width: 28px; height: 22px; padding: 0; border: 0; border-radius: 4px; display: grid; place-items: center; }
  .grid9 button span { width: 6px; height: 6px; border-radius: 50%; background: var(--border); }
  .grid9 button:hover span { background: var(--muted); }
  .grid9 button.on span { width: 10px; height: 10px; background: var(--accent); }
  /* Apply-to-all switch */
  .switch { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; margin-top: 4px; }
  .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .track { width: 32px; height: 18px; border-radius: 999px; background: var(--border); position: relative; transition: background .15s; flex: none; }
  .knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--text); transition: transform .15s; }
  .switch input:checked + .track { background: var(--accent); }
  .switch input:checked + .track .knob { transform: translateX(14px); background: var(--on-accent); }
  .switch input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }

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
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .two .field { margin: 0; }
  .two input, .two select { width: 100%; height: 36px; }
  .small { font-size: 12px; }
</style>
