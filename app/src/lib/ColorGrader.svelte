<script lang="ts">
  // Phone color sheet: pick an adjustment from a row of round buttons, scrub it on a tick ruler.
  import Icon from './Icon.svelte';
  import { t } from './i18n.svelte';
  import { COLOR_PRESETS, type Color, type Lut } from './grade';
  import type { IconName } from './icons';

  let { color, luts, onset, ondone }: {
    color: Color;
    luts: Lut[];
    onset: (patch: Partial<Color>, replace?: boolean) => void;
    ondone: () => void;
  } = $props();

  type Key = 'b' | 'c' | 's' | 'temp' | 'lutMix' | 'vig' | 'grain' | 'glow' | 'rgb';
  const params = $derived([
    { k: 'b', label: 'brightness', icon: 'light_mode', min: -1, max: 1, def: 0 },
    { k: 'c', label: 'contrast', icon: 'contrast', min: -1, max: 1, def: 0 },
    { k: 's', label: 'saturation', icon: 'water_drop', min: -1, max: 1, def: 0 },
    { k: 'temp', label: 'temperature', icon: 'thermostat', min: -1, max: 1, def: 0 },
    { k: 'vig', label: 'fx.vig', icon: 'vignette', min: 0, max: 1, def: 0 },
    { k: 'grain', label: 'fx.grain', icon: 'grain', min: 0, max: 1, def: 0 },
    { k: 'glow', label: 'fx.glow', icon: 'flare', min: 0, max: 1, def: 0 },
    { k: 'rgb', label: 'fx.rgb', icon: 'blur_on', min: 0, max: 1, def: 0 },
    ...(color.lut ? [{ k: 'lutMix', label: 'lutMix', icon: 'filter_vintage', min: 0, max: 1, def: 1 }] : []),
  ] as { k: Key; label: string; icon: IconName; min: number; max: number; def: number }[]);
  let active = $state<Key>('b');
  const p = $derived(params.find((x) => x.k === active) ?? params[0]);
  const val = (k: Key, def: number) => (color[k] as number | undefined) ?? def;
  const v = $derived(val(p.k, p.def));

  // Ruler: 1 unit of value = SPAN px of drag; ticks scroll under a fixed centre marker.
  const SPAN = 160;
  let drag: { x: number; v: number } | null = null;
  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { x: e.clientX, v };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const n = Math.max(p.min, Math.min(p.max, drag.v - (e.clientX - drag.x) / SPAN));
    onset({ [p.k]: Math.round(n * 100) / 100 });
  }
  function up() {
    if (drag) ((drag = null), ondone());
  }
  function key(e: KeyboardEvent) {
    const d = e.key === 'ArrowRight' ? 0.01 : e.key === 'ArrowLeft' ? -0.01 : 0;
    if (!d) return;
    e.preventDefault();
    onset({ [p.k]: Math.max(p.min, Math.min(p.max, Math.round((v + d) * 100) / 100)) });
    ondone();
  }
  const shown = (n: number) => (p.k === 'lutMix' ? `${Math.round(n * 100)}%` : `${n > 0 ? '+' : ''}${Math.round(n * 100)}`);
</script>

<div class="grader">
  <p class="label">{t(p.label)} <span class="mono">{shown(v)}</span></p>
  <div class="params">
    <button class="reset" onclick={() => (onset({}, true), ondone())} disabled={!Object.keys(color).length}>{t('reset')}</button>
    <div class="dials" role="radiogroup" aria-label={t('grading')}>
      {#each params as q (q.k)}
        {@const changed = val(q.k, q.def) !== q.def}
        <button class="dial" class:on={active === q.k} class:changed role="radio" aria-checked={active === q.k}
          aria-label={t(q.label)} title={t(q.label)} onclick={() => (active = q.k)}
          ondblclick={() => (onset({ [q.k]: q.k === 'lutMix' ? 1 : 0 }), ondone())}>
          <Icon name={q.icon} size={26} />
        </button>
      {/each}
    </div>
  </div>
  <div class="ruler" role="slider" tabindex="0" aria-label={t(p.label)} aria-valuemin={p.min} aria-valuemax={p.max} aria-valuenow={v}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}
    ondblclick={() => (onset({ [p.k]: p.def }), ondone())}>
    <div class="ticks" style:transform="translateX({-(v - (p.min + p.max) / 2) * SPAN}px)" style:width="{(p.max - p.min) * SPAN}px"></div>
    <div class="marker"></div>
  </div>
  <div class="presets" aria-label={t('filters')}>
    {#each Object.entries(COLOR_PRESETS) as [k, pv]}
      <button class="chip" onclick={() => (onset({ ...pv, lut: color.lut, lutMix: color.lutMix }, true), ondone())}>{t('col.' + k)}</button>
    {/each}
    <select class="chip" value={color.lut ?? ''} aria-label={t('lut')}
      onchange={(e) => (onset({ lut: e.currentTarget.value || undefined }), ondone())}>
      <option value="">{t('col.noLut')}</option>
      {#each luts as l}<option value={l.id}>{l.name}</option>{/each}
    </select>
  </div>
</div>

<style>
  .grader { display: grid; gap: 16px; padding: 8px 0 16px; }
  .label { margin: 0; text-align: center; font-size: 17px; font-weight: 500; }
  .label .mono { color: var(--muted); font-size: 14px; margin-left: 6px; }
  .params { display: flex; align-items: center; gap: 12px; padding-left: 16px; min-width: 0; }
  .reset { flex: none; width: 64px; height: 64px; border-radius: 12px; border: 0; background: var(--raised); font-weight: 600; font-size: 13px; padding: 0; }
  .dials { display: flex; gap: 10px; overflow-x: auto; scrollbar-width: none; padding-right: 16px; scroll-snap-type: x mandatory;
    mask-image: linear-gradient(to right, #000 85%, transparent); }
  .dial { position: relative; flex: none; width: 72px; height: 72px; border-radius: 50%; border: 0; padding: 0;
    background: var(--raised); color: var(--text); scroll-snap-align: start; transition: background .15s, color .15s; }
  .dial.on { background: var(--text); color: var(--bg); }
  .dial.changed::after { content: ''; position: absolute; top: 6px; right: 10px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .ruler { position: relative; height: 44px; overflow: hidden; touch-action: none; cursor: ew-resize;
    mask-image: linear-gradient(to right, transparent, #000 25%, #000 75%, transparent); }
  .ruler:focus-visible { outline: none; }
  .ticks { position: absolute; left: 50%; top: 14px; height: 18px;
    translate: -50% 0;
    background:
      repeating-linear-gradient(to right, var(--text) 0 2px, transparent 2px 80px) 0 0 / 100% 100%,
      repeating-linear-gradient(to right, var(--muted) 0 1px, transparent 1px 16px) 0 4px / 100% 10px no-repeat; }
  .marker { position: absolute; left: 50%; top: 4px; width: 3px; height: 34px; margin-left: -1.5px; border-radius: 2px; background: var(--accent); }
  .presets { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 0 16px; }
  .chip { flex: none; height: 32px; padding: 0 14px; border-radius: 999px; font-size: 13px; background: var(--raised); border: 0; }
</style>
