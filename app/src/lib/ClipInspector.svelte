<script lang="ts">
  // Inspector for a selected video or picture item: its effects (speed, punch-in, reverse, stabilize, and — when it
  // fills the frame — background, keying and text behind the person), then colour grading and reframing.
  import Icon from './Icon.svelte';
  import ColorGrader from './ColorGrader.svelte';
  import KeyControls from './KeyControls.svelte';
  import { t } from './i18n.svelte';
  import { acceptExt } from './platform';
  import { PUNCH_IN, type Fx } from './cuts';
  import { TRANSITIONS } from './transitions';
  import { COLOR_PRESETS, COLOR_LOOKS, EFFECTS, type Color, type Lut } from './grade';
  import type { Asset } from './project';
  import type { Overlay } from './overlay';

  let { item, imageAssets, revPct, stabPct, pickingKey,
    setFx, fxDone, reverseStrip, stabilize, startPick,
    selColor, luts, setColor, oncolordone, importLut, colorToAll,
    reframes, setFocus, autoReframe, autoReframeAll, reframing, webgl }: {
    item: Overlay; imageAssets: Asset[];
    revPct: number | null; stabPct: number | null; pickingKey: boolean;
    setFx: (p: Partial<Fx>, live?: boolean) => void; fxDone: () => void; reverseStrip: (id: string) => void; stabilize: (id: string) => void;
    startPick: (target: string) => void;
    selColor: Color; luts: Lut[]; setColor: (patch: Partial<Color>, replace?: boolean) => void; oncolordone: () => void;
    importLut: (file: File | undefined) => void; colorToAll: () => void;
    reframes: boolean; setFocus: (f: { x: number; y: number } | undefined) => void;
    autoReframe: (id: string) => void; autoReframeAll: () => void; reframing: boolean; webgl: boolean;
  } = $props();
  const c = $derived(selColor);
  const selFx = $derived<Fx>(item.fx ?? {});
  const video = $derived(item.kind === 'video');
  const set = (p: Partial<Fx>) => (setFx(p), fxDone());
  // Retime: speed and output length are two views of one number (length = source / speed).
  const clampSp = (v: number) => (v > 0 ? Math.round(Math.max(0.1, Math.min(16, v)) * 1000) / 1000 : 0);
  const setSpeed = (v: number) => { v = clampSp(v); if (v) set({ speed: v === 1 ? undefined : v }); };
  // Fit to a length: scale the whole ramp (or the constant speed) by the same factor.
  const fitLen = (d: number) => {
    const f = item.len / d, a = clampSp((selFx.speed ?? 1) * f), b = selFx.speedEnd && clampSp(selFx.speedEnd * f);
    set({ speed: a === 1 ? undefined : a, speedEnd: b || undefined });
  };
</script>

<section class="layer clipfx" aria-label={t('clipH')}>
  <div class="lhead"><h3>{t('clipH')}</h3></div>
  <div class="lrow">
  {#if item.fill}
    <label class="vol inline" title={t('transInTip')}>{t('transIn')}
      <select value={selFx.trans ?? ''} onchange={(e) => set({ trans: (e.currentTarget.value || undefined) as Fx['trans'] })}>
        <option value="">{t('trans.none')}</option>
        {#each TRANSITIONS as k}<option value={k}>{t('trans.' + k)}</option>{/each}
      </select>
    </label>
  {/if}
  {#if selFx.hold}
    <label class="vol inline">{t('freezeLen')}
      <input type="number" min="0.2" max="10" step="0.1" value={selFx.hold} style="width: 64px"
        onchange={(e) => set({ hold: Math.max(0.2, Math.min(10, +e.currentTarget.value || 1)) })} />
    </label>
  {:else if video}
    <label class="vol inline">{t('speed')}
      <input type="number" min="0.1" max="16" step="0.05" value={selFx.speed ?? 1} style="width: 64px"
        onchange={(e) => setSpeed(+e.currentTarget.value)} />×
    </label>
    <label class="vol inline" title={t('rampTip')}>{t('rampTo')}
      <input type="number" min="0.1" max="16" step="0.05" value={selFx.speedEnd ?? ''} placeholder="—" style="width: 64px"
        onchange={(e) => { const v = clampSp(+e.currentTarget.value); set({ speedEnd: v && v !== (selFx.speed ?? 1) ? v : undefined }); }} />×
    </label>
    <label class="vol inline" title={t('retimeTip')}>{t('retimeLen')}
      <input type="number" min="0.1" step="0.1" value={+item.len.toFixed(2)} style="width: 64px"
        onchange={(e) => { const d = +e.currentTarget.value; if (d > 0) fitLen(d); }} />
    </label>
  {/if}
  <button class="sm" class:on={!!selFx.zoom} aria-pressed={!!selFx.zoom} title={t('punchTip')}
    onclick={() => set(selFx.zoom ? { zoom: undefined, zoomIn: undefined } : { zoom: PUNCH_IN, zoomIn: true })}><Icon name="zoom_in" /> {t('punchIn')}</button>
  <label class="vol inline" title={t('shakeTip')}>{t('shake')}
    <select value={selFx.shake ?? 0} onchange={(e) => set({ shake: +e.currentTarget.value || undefined })}>
      {#each [0, 0.3, 0.6, 1] as v}<option value={v}>{t('shake.' + v)}</option>{/each}
    </select>
  </label>
  {#if video}
  <button class="sm" class:on={!!selFx.rev} aria-pressed={!!selFx.rev} title={t('reverseTip')} disabled={revPct !== null || !!selFx.hold}
    onclick={() => reverseStrip(item.id)}><Icon name="history" size={16} /> {revPct !== null ? `${t('reversing')} ${Math.round(revPct)}%` : t('reverse')}</button>
  <button class="sm" class:on={!!selFx.stab} aria-pressed={!!selFx.stab} title={t('stabTip')} disabled={stabPct !== null || !!selFx.hold}
    onclick={() => stabilize(item.id)}><Icon name="videocam" size={16} /> {stabPct !== null ? `${t('stabBusy')} ${Math.round(stabPct)}%` : t('stab')}</button>
  {/if}
  {#if item.fill}
  <button class="sm icon" class:on={selFx.behind} aria-pressed={!!selFx.behind} title={t('textBehind')} aria-label={t('textBehind')}
    onclick={() => set({ behind: !selFx.behind })}><Icon name="person" /></button>
  <label class="vol">{t('background')}
    <select value={selFx.bg ?? ''} onchange={(e) => set({ bg: (e.currentTarget.value || undefined) as Fx['bg'] })}>
      <option value="">{t('bgOriginal')}</option>
      <option value="blur">{t('bgBlur')}</option>
      <option value="color">{t('bgColor')}</option>
      <option value="image" disabled={!imageAssets.length}>{t('bgImage')}</option>
    </select>
  </label>
  {#if selFx.bg === 'image'}
    <select value={selFx.bgImage ?? ''} aria-label={t('bgImage')} onchange={(e) => set({ bgImage: e.currentTarget.value || undefined })}>
      <option value="">{t('bgPick')}</option>
      {#each imageAssets as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
    </select>
  {/if}
  {#if selFx.bg === 'color'}
    <input type="color" value={selFx.bgColor ?? '#00b140'} aria-label={t('bgColor')}
      onchange={(e) => set({ bgColor: e.currentTarget.value })} />
  {/if}
  <div class="stripkey">
    <KeyControls key={selFx.key} picking={pickingKey} onpick={() => startPick(item.id)} set={(k, final) => (setFx({ key: k }, !final), final && fxDone())} />
  </div>
  {/if}
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
  <button class="sm" onclick={colorToAll}>{t('colorAll')}</button>
  {#if reframes && item.fill}
    {@const fc = selFx.focus ?? { x: 0.5, y: 0.5 }}
    <div class="lhead"><h3>{t('reframe')}</h3></div>
    <label class="vol">{t('focusX')} <span class="mono small">{Math.round(fc.x * 100)}%</span>
      <input type="range" min="0" max="1" step="0.01" value={fc.x} oninput={(e) => setFocus({ ...fc, x: +e.currentTarget.value })} />
    </label>
    <label class="vol">{t('focusY')} <span class="mono small">{Math.round(fc.y * 100)}%</span>
      <input type="range" min="0" max="1" step="0.01" value={fc.y} oninput={(e) => setFocus({ ...fc, y: +e.currentTarget.value })} />
    </label>
    <div class="lrow">
      <button class="sm" onclick={() => autoReframe(item.id)} disabled={reframing}>{#if !reframing}<Icon name="center_focus_strong" />{/if} {reframing ? t('detecting') : t('autoReframe')}</button>
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
