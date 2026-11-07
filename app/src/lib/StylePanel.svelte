<script lang="ts">
  import { PRESETS, type Style, type Animation, type Easing } from './render';
  import type { Font } from './fonts';
  import { t } from './i18n.svelte';

  let { style = $bindable(), fonts, fontError, onlocal, onupload }: {
    style: Style; fonts: Font[]; fontError: string;
    onlocal: () => void; onupload: (f: File | undefined) => void;
  } = $props();

  const ANIMS: Animation[] = ['none', 'fade', 'pop', 'typewriter', 'karaoke', 'bounce'];
  const EASES: Easing[] = ['ease-out', 'ease-in-out', 'linear', 'back'];
  // Which preset matches the current look. Animation and timing are picked separately, so they're ignored.
  const activePreset = $derived(
    Object.keys(PRESETS).find((k) => {
      const p = PRESETS[k];
      return p.family === style.family && p.color === style.color && p.highlight === style.highlight
        && p.uppercase === style.uppercase && p.box === style.box && p.italic === style.italic;
    }),
  );
  // Presets set the look; the chosen animation and timing are kept.
  const applyPreset = (p: Style) =>
    (style = { ...p, x: style.x, y: style.y, animation: style.animation, duration: style.duration, easing: style.easing });

  function pickFont(family: string) {
    const f = fonts.find((x) => x.family === family);
    if (f) ((style.family = f.family), (style.weight = f.weight));
  }
</script>

<section class="block">
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
</section>

<section class="block">
  <h3>{t('textAnimation')}</h3>
  <div class="anims" role="radiogroup" aria-label={t('textAnimation')}>
    {#each ANIMS as a}
      <button class="anim" class:on={style.animation === a} role="radio" aria-checked={style.animation === a}
        onclick={() => (style.animation = a)}>
        <span>{t('anim.' + a)}</span>
        <span class="muted">{t('animd.' + a)}</span>
      </button>
    {/each}
  </div>
</section>

<section class="block">
  <h3>{t('timing')}</h3>
  <div class="two">
    <label class="field">{t('durationMs')}
      <input type="number" min="50" max="3000" step="10" bind:value={style.duration} disabled={style.animation === 'none'} />
    </label>
    <label class="field">{t('easing')}
      <select bind:value={style.easing} disabled={style.animation === 'none'}>
        {#each EASES as e}<option value={e}>{t('ease.' + e)}</option>{/each}
      </select>
    </label>
  </div>
</section>

<details class="block">
  <summary><h3>{t('advanced')}</h3></summary>
  <label class="field">{t('font')}
    <select value={style.family} onchange={(e) => pickFont(e.currentTarget.value)}>
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
    <input type="range" min="0.03" max="0.15" step="0.005" bind:value={style.size} />
  </label>
  <div class="colors">
    <label>{t('text')} <input type="color" bind:value={style.color} /></label>
    <label>{t('highlight')} <input type="color" bind:value={style.highlight} /></label>
    <label>{t('outline')} <input type="color" bind:value={style.stroke} /></label>
  </div>
  <label class="field">{t('outlineWidth')}
    <input type="range" min="0" max="0.25" step="0.01" bind:value={style.outline} />
  </label>
  <div class="row">
    <label class="check"><input type="checkbox" checked={!!style.box}
      onchange={(e) => (style.box = e.currentTarget.checked ? '#111111' : '')} /> {t('bgBox')}</label>
    {#if style.box}<input type="color" class="boxc" bind:value={style.box} aria-label={t('bgBoxColor')} />{/if}
  </div>
  <label class="check"><input type="checkbox" bind:checked={style.uppercase} /> {t('upper')}</label>
  <label class="check"><input type="checkbox" bind:checked={style.italic} /> {t('italic')}</label>
  <p class="muted small">{t('dragHint')}</p>
</details>

<style>
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
  .anim .muted { font-size: 12px; font-weight: 400; }
  .anim.on { border-color: var(--accent); background: rgb(200 245 96 / .06); }
  summary { cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary h3 { margin: 0; display: flex; justify-content: space-between; }
  summary h3::after { content: '▾'; color: var(--muted); }
  details[open] summary h3 { margin-bottom: 12px; }
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
