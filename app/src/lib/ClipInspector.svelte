<script lang="ts">
  // Inspector for a selected video strip: clip effects (speed, punch-in, reverse, stabilize, background,
  // keying), then color grading and reframing.
  import Icon from './Icon.svelte';
  import ColorGrader from './ColorGrader.svelte';
  import KeyControls from './KeyControls.svelte';
  import { t } from './i18n.svelte';
  import { acceptExt } from './platform';
  import { PUNCH_IN, type Fx, type Segment } from './cuts';
  import { TRANSITIONS } from './transitions';
  import { COLOR_PRESETS, COLOR_LOOKS, EFFECTS, type Color, type Lut } from './grade';
  import type { ChromaKey } from './layerfx';
  import type { Asset } from './project';

  let { selFx, selected, segments, imageAssets, revPct, stabPct, pickingKey,
    setFx, reverseStrip, stabilize, startPick, setStripKey,
    selColor, luts, setColor, oncolordone, importLut, colorToAll,
    reframes, setFocus, autoReframe, autoReframeAll, reframing, webgl, deselect }: {
    selFx: Fx; selected: number; segments: Segment[]; imageAssets: Asset[];
    revPct: number | null; stabPct: number | null; pickingKey: boolean;
    setFx: (p: Partial<Fx>) => void; reverseStrip: (i: number) => void; stabilize: (i: number) => void;
    startPick: (target: string) => void; setStripKey: (k: ChromaKey | undefined, final: boolean) => void;
    selColor: Color; luts: Lut[]; setColor: (patch: Partial<Color>, replace?: boolean) => void; oncolordone: () => void;
    importLut: (file: File | undefined) => void; colorToAll: () => void;
    reframes: boolean; setFocus: (f: { x: number; y: number } | undefined) => void;
    autoReframe: (i: number) => void; autoReframeAll: () => void; reframing: boolean; webgl: boolean; deselect: () => void;
  } = $props();
  const c = $derived(selColor);
</script>

<section class="layer clipfx" aria-label={t('clipH')}>
  <div class="lhead"><h3>{t('clipH')}</h3><button class="sm" onclick={deselect} title={t('deselectTip')}>{t('deselect')}</button></div>
  <div class="lrow">
  {#if selected > 0}
    <label class="vol inline">{t('transIn')}
      <select value={selFx.trans ?? ''} onchange={(e) => setFx({ trans: (e.currentTarget.value || undefined) as Fx['trans'] })}>
        <option value="">{t('trans.none')}</option>
        {#each TRANSITIONS as k}<option value={k}>{t('trans.' + k)}</option>{/each}
      </select>
    </label>
  {/if}
  {#if selFx.hold}
    <label class="vol inline">{t('freezeLen')}
      <input type="number" min="0.2" max="10" step="0.1" value={selFx.hold} style="width: 64px"
        onchange={(e) => setFx({ hold: Math.max(0.2, Math.min(10, +e.currentTarget.value || 1)) })} />
    </label>
  {:else}
    <label class="vol inline">{t('speed')}
      <select value={selFx.speed ?? 1} onchange={(e) => setFx({ speed: +e.currentTarget.value === 1 ? undefined : +e.currentTarget.value })}>
        {#each [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as v}<option value={v}>{v}×</option>{/each}
      </select>
    </label>
  {/if}
  <button class="sm" class:on={!!selFx.zoom} aria-pressed={!!selFx.zoom} title={t('punchTip')}
    onclick={() => setFx(selFx.zoom ? { zoom: undefined, zoomIn: undefined } : { zoom: PUNCH_IN, zoomIn: true })}><Icon name="zoom_in" /> {t('punchIn')}</button>
  <label class="vol inline" title={t('shakeTip')}>{t('shake')}
    <select value={selFx.shake ?? 0} onchange={(e) => setFx({ shake: +e.currentTarget.value || undefined })}>
      {#each [0, 0.3, 0.6, 1] as v}<option value={v}>{t('shake.' + v)}</option>{/each}
    </select>
  </label>
  <button class="sm" class:on={!!selFx.rev} aria-pressed={!!selFx.rev} title={t('reverseTip')} disabled={revPct !== null || !!selFx.hold}
    onclick={() => reverseStrip(selected)}><Icon name="history" size={16} /> {revPct !== null ? `${t('reversing')} ${Math.round(revPct)}%` : t('reverse')}</button>
  <button class="sm" class:on={!!selFx.stab} aria-pressed={!!selFx.stab} title={t('stabTip')} disabled={stabPct !== null || !!selFx.hold}
    onclick={() => stabilize(selected)}><Icon name="videocam" size={16} /> {stabPct !== null ? `${t('stabBusy')} ${Math.round(stabPct)}%` : t('stab')}</button>
  <button class="sm" class:on={!!selFx.lift} aria-pressed={!!selFx.lift} title={t('liftTip')}
    onclick={() => setFx({ lift: !selFx.lift || undefined })}>{t('lift')}</button>
  <button class="sm icon" class:on={selFx.behind} aria-pressed={!!selFx.behind} title={t('textBehind')} aria-label={t('textBehind')}
    onclick={() => setFx({ behind: !selFx.behind })}><Icon name="person" /></button>
  <label class="vol">{t('background')}
    <select value={selFx.bg ?? ''} onchange={(e) => setFx({ bg: (e.currentTarget.value || undefined) as Fx['bg'] })}>
      <option value="">{t('bgOriginal')}</option>
      <option value="blur">{t('bgBlur')}</option>
      <option value="color">{t('bgColor')}</option>
      <option value="image" disabled={!imageAssets.length}>{t('bgImage')}</option>
    </select>
  </label>
  {#if selFx.bg === 'image'}
    <select value={selFx.bgImage ?? ''} aria-label={t('bgImage')} onchange={(e) => setFx({ bgImage: e.currentTarget.value || undefined })}>
      <option value="">{t('bgPick')}</option>
      {#each imageAssets as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
    </select>
  {/if}
  {#if selFx.bg === 'color'}
    <input type="color" value={selFx.bgColor ?? '#00b140'} aria-label={t('bgColor')}
      onchange={(e) => setFx({ bgColor: e.currentTarget.value })} />
  {/if}
  <label class="vol">{t('volume')} <span class="mono small">{Math.round((selFx.vol ?? 1) * 100)}%</span>
    <input type="range" min="0" max="1" step="0.05" value={selFx.vol ?? 1} ondblclick={() => setFx({ vol: undefined })}
      oninput={(e) => setFx({ vol: +e.currentTarget.value === 1 ? undefined : +e.currentTarget.value })} />
  </label>
  <div class="stripkey">
    <KeyControls key={selFx.key} picking={pickingKey} onpick={() => startPick('strip')} set={setStripKey} />
  </div>
  </div>
</section>
<section class="layer strip" aria-label={t('stripColor')} onchange={() => oncolordone()} onpointerup={() => oncolordone()}>
  <div class="lhead"><h3>{t('stripColor')}</h3></div>
  <div class="mob-only"><ColorGrader color={selColor} {luts} onset={setColor} ondone={() => oncolordone()} /></div>
  <div class="desk-only grade-fields">
  <div class="lrow">
    <button class="sm" class:on={!Object.keys(c).length} onclick={() => (setColor({}, true), oncolordone())}>{t('col.none')}</button>
    {#each Object.entries(COLOR_PRESETS) as [k, v]}
      <button class="sm" onclick={() => (setColor({ ...v, lut: c.lut, lutMix: c.lutMix }, true), oncolordone())}>{t('col.' + k)}</button>
    {/each}
    {#each Object.entries(COLOR_LOOKS) as [k, v]}
      <button class="sm" onclick={() => (setColor({ ...v, lut: c.lut, lutMix: c.lutMix }, true), oncolordone())}>{t('col.' + k)}</button>
    {/each}
  </div>
  {#each [['b', 'brightness'], ['c', 'contrast'], ['s', 'saturation'], ['temp', 'temperature']] as [k, label]}
    {@const v = (c as Record<string, number>)[k] ?? 0}
    <label class="vol">{t(label)} <span class="mono small">{v > 0 ? '+' : ''}{Math.round(v * 100)}</span>
      <input type="range" min="-1" max="1" step="0.01" value={v} oninput={(e) => setColor({ [k]: +e.currentTarget.value })}
        ondblclick={() => (setColor({ [k]: 0 }), oncolordone())} />
    </label>
  {/each}
  {#each EFFECTS as k}
    {@const v = c[k] ?? 0}
    <label class="vol">{t('fx.' + k)} <span class="mono small">{Math.round(v * 100)}%</span>
      <input type="range" min="0" max="1" step="0.01" value={v} oninput={(e) => setColor({ [k]: +e.currentTarget.value || undefined })}
        ondblclick={() => (setColor({ [k]: undefined }), oncolordone())} />
    </label>
  {/each}
  <div class="lrow">
    <label class="vol">{t('lut')}
      <select value={c.lut ?? ''} onchange={(e) => (setColor({ lut: e.currentTarget.value || undefined }), oncolordone())}>
        <option value="">{t('col.noLut')}</option>
        {#each luts as l}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </label>
    <label class="btn sm">{t('importLut')}<input type="file" accept={acceptExt(".cube")} hidden onchange={(e) => importLut(e.currentTarget.files?.[0])} /></label>
  </div>
  {#if c.lut}
    <label class="vol">{t('lutMix')} <span class="mono small">{Math.round((c.lutMix ?? 1) * 100)}%</span>
      <input type="range" min="0" max="1" step="0.01" value={c.lutMix ?? 1} oninput={(e) => setColor({ lutMix: +e.currentTarget.value })} />
    </label>
  {/if}
  </div>
  <button class="sm" onclick={colorToAll} disabled={segments.length < 2}>{t('colorAll')}</button>
  {#if reframes}
    {@const fc = segments[selected].fx?.focus ?? { x: 0.5, y: 0.5 }}
    <div class="lhead"><h3>{t('reframe')}</h3></div>
    <label class="vol">{t('focusX')} <span class="mono small">{Math.round(fc.x * 100)}%</span>
      <input type="range" min="0" max="1" step="0.01" value={fc.x} oninput={(e) => setFocus({ ...fc, x: +e.currentTarget.value })} />
    </label>
    <label class="vol">{t('focusY')} <span class="mono small">{Math.round(fc.y * 100)}%</span>
      <input type="range" min="0" max="1" step="0.01" value={fc.y} oninput={(e) => setFocus({ ...fc, y: +e.currentTarget.value })} />
    </label>
    <div class="lrow">
      <button class="sm" onclick={() => autoReframe(selected)} disabled={reframing}>{#if !reframing}<Icon name="center_focus_strong" />{/if} {reframing ? t('detecting') : t('autoReframe')}</button>
      <button class="sm" onclick={autoReframeAll} disabled={reframing}>{t('autoReframeAll')}</button>
      <button class="sm" onclick={() => (setFocus(undefined), oncolordone())}>{t('center')}</button>
    </div>
  {/if}
  {#if !webgl}<p class="muted small">{t('noWebgl')}</p>{/if}
</section>

<style>
  .stripkey { flex-basis: 100%; max-width: 360px; }
  .grade-fields { display: grid; gap: 10px; }
  .mob-only { display: none; }
  @media (max-width: 760px) {
    .desk-only { display: none; }
    .mob-only { display: block; }
  }
</style>
