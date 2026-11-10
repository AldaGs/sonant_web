<script lang="ts">
  // Inspector for a selected layer (text, title, image, video or progress bar): content, title motion,
  // keyframes, transform, crop, blend, keying, mask and stacking.
  import Icon from './Icon.svelte';
  import KeyControls from './KeyControls.svelte';
  import { t } from './i18n.svelte';
  import { BLENDS, DEFAULT_MASK, type Blend } from './layerfx';
  import { maskAt, setMaskKey, maskReveal } from './overlay';
  import { TITLE_PATHS, TITLE_STYLES, textStyle, tfAt, keyAt, type Overlay, type Transform, type Motion } from './overlay';
  import type { Font } from './fonts';

  let { o, outTime, fonts, overlays, pickKey, doneEditing, closeLayer, setOverlay, setMotion, setTf,
    jumpKey, toggleKey, punchIn, clearKeys, startPick, removeOverlay, restack, layerT, outNow }: {
    o: Overlay; outTime: number; fonts: Font[]; overlays: Overlay[]; pickKey: string | null;
    doneEditing: () => void; closeLayer: () => void;
    setOverlay: (id: string, patch: Partial<Overlay>, snapshot?: boolean) => void;
    setMotion: (o: Overlay, m: Partial<Motion> | null) => void;
    setTf: (id: string, tf: Partial<Transform>, snapshot?: boolean) => void;
    jumpKey: (o: Overlay, dir: -1 | 1) => void; toggleKey: (o: Overlay) => void; punchIn: (o: Overlay) => void; clearKeys: (o: Overlay) => void;
    startPick: (target: string) => void; removeOverlay: () => void; restack: (dir: -1 | 1) => void;
    layerT: (o: Overlay) => number; outNow: () => number;
  } = $props();
  const cur = $derived(tfAt(o, outTime));
  const onKey = $derived(!!keyAt(o.kf, outTime - o.at));
</script>

<!-- Layer inspector: live edits are one undo step each (snapshot on first input, closed on change). -->
<section class="layer" class:vlayer={o.kind !== 'text'} aria-label={t('layer')} onchange={doneEditing} onpointerup={doneEditing}>
  <div class="lhead">
    <h3>{o.motion ? t('addTitle') : o.kind === 'text' ? t('textLayer') : o.kind === 'image' ? t('imageLayer') : t('videoLayer')}</h3>
    <button class="sm icon" onclick={closeLayer} aria-label={t('ex.close')}><Icon name="close" /></button>
  </div>
  {#if o.bar}
    {@const b = o.bar}
    <div class="lrow">
      <label class="vol">{t('barColor')}<input type="color" value={b.color} oninput={(e) => setOverlay(o.id, { bar: { ...b, color: e.currentTarget.value } })} onchange={doneEditing} /></label>
      <label class="chk"><input type="checkbox" checked={!!b.track} onchange={(e) => (setOverlay(o.id, { bar: { ...b, track: e.currentTarget.checked ? 'rgba(255,255,255,0.25)' : '' } }), doneEditing())} /> {t('barTrack')}</label>
      <label class="chk"><input type="checkbox" checked={!!b.top} onchange={(e) => (setOverlay(o.id, { bar: { ...b, top: e.currentTarget.checked || undefined } }), doneEditing())} /> {t('barTop')}</label>
    </div>
    <label class="vol">{t('barH')} <span class="mono small">{(b.h * 100).toFixed(1)}%</span>
      <input type="range" min="0.003" max="0.03" step="0.001" value={b.h} oninput={(e) => setOverlay(o.id, { bar: { ...b, h: +e.currentTarget.value } })} onchange={doneEditing} />
    </label>
  {:else if o.kind === 'text'}
    <label class="vol">{t('text')}
      <textarea rows="2" value={o.text} oninput={(e) => setOverlay(o.id, { text: e.currentTarget.value })}></textarea>
    </label>
    <div class="lrow">
      <label class="vol">{t('color')}<input type="color" value={textStyle(o).color} oninput={(e) => setOverlay(o.id, { style: { ...o.style, color: e.currentTarget.value } })} /></label>
      <label class="vol">{t('highlight')}<input type="color" value={textStyle(o).highlight} oninput={(e) => setOverlay(o.id, { style: { ...o.style, highlight: e.currentTarget.value } })} /></label>
      <label class="vol">{t('font')}
        <select value={textStyle(o).family} onchange={(e) => setOverlay(o.id, { style: { ...o.style, family: e.currentTarget.value } })}>
          {#each fonts as f}<option value={f.family}>{f.family}</option>{/each}
        </select>
      </label>
    </div>
  {/if}
  {#if o.kind === 'text' && !o.bar}
    {@const m = o.motion}
    <div class="lrow">
      <label class="vol">{t('titleAnim')}
        <select value={m ? m.path : 'off'} onchange={(e) => { const v = e.currentTarget.value; setMotion(o, v === 'off' ? null : { path: v as Motion['path'] }); doneEditing(); }}>
          <option value="off">{t('titleOff')}</option>
          {#each TITLE_PATHS as p}<option value={p}>{t('tpath.' + p)}</option>{/each}
        </select>
      </label>
      {#if m}
        <label class="vol">{t('titleStyle')}
          <select value={m.style ?? 'pop'} onchange={(e) => (setMotion(o, { style: e.currentTarget.value as Motion['style'] }), doneEditing())}>
            {#each TITLE_STYLES as st}<option value={st}>{t('tstyle.' + st)}</option>{/each}
          </select>
        </label>
      {/if}
    </div>
    {#if m}
      <label class="vol">{t('titleIn')} <span class="mono small">{m.in.toFixed(1)}s</span>
        <input type="range" min="0" max={Math.max(0.1, o.len / 2)} step="0.1" value={m.in} oninput={(e) => setMotion(o, { in: +e.currentTarget.value })} />
      </label>
      <label class="vol">{t('titleOut')} <span class="mono small">{m.out.toFixed(1)}s</span>
        <input type="range" min="0" max={Math.max(0.1, o.len / 2)} step="0.1" value={m.out} oninput={(e) => setMotion(o, { out: +e.currentTarget.value })} />
      </label>
      {#if m.path !== 'none'}
        <label class="vol">{t('titleSpan')} <span class="mono small">{Math.round(m.span * 100)}%</span>
          <input type="range" min="0" max="1.2" step="0.01" value={m.span} oninput={(e) => setMotion(o, { span: +e.currentTarget.value })} />
        </label>
        <label class="vol">{t('titleCurve')} <span class="mono small">{Math.round(m.amp * 100)}%</span>
          <input type="range" min="0" max="0.3" step="0.01" value={m.amp} oninput={(e) => setMotion(o, { amp: +e.currentTarget.value })} />
        </label>
      {/if}
    {/if}
  {/if}
  <div class="keyrow" role="group" aria-label={t('keyframes')}>
    <button class="sm icon" onclick={() => jumpKey(o, -1)} disabled={!o.kf?.length} title={t('prevKey')} aria-label={t('prevKey')}><Icon name="chevron_left" /></button>
    <button class="sm key" class:on={onKey} aria-pressed={onKey} onclick={() => toggleKey(o)}
      title={onKey ? t('removeKey') : t('addKey')}><Icon name="diamond" size={16} /> {onKey ? t('removeKey') : t('addKey')}</button>
    <button class="sm icon" onclick={() => jumpKey(o, 1)} disabled={!o.kf?.length} title={t('nextKey')} aria-label={t('nextKey')}><Icon name="chevron_right" /></button>
    <button class="sm" onclick={() => punchIn(o)} title={t('punchLayerTip')}><Icon name="zoom_in" /> {t('punchIn')}</button>
    {#if o.kf?.length}<button class="sm" onclick={() => clearKeys(o)}>{t('clearKeys')}</button>{/if}
  </div>
  {#if o.kf?.length}<p class="muted small keyhint">{t('keyHint', { n: o.kf.length })}</p>{/if}
  <label class="vol">{t('scale')} <span class="mono small">{Math.round(cur.scale * 100)}%</span>
    <input type="range" min="0.05" max={o.kind === 'text' ? 4 : 1.5} step="0.01" value={cur.scale} oninput={(e) => setTf(o.id, { scale: +e.currentTarget.value })} />
  </label>
  <label class="vol">{t('rotation')} <span class="mono small">{Math.round(cur.rotation)}°</span>
    <input type="range" min="-180" max="180" step="1" value={cur.rotation} oninput={(e) => setTf(o.id, { rotation: +e.currentTarget.value })} />
  </label>
  <label class="vol">{t('opacity')} <span class="mono small">{Math.round(cur.opacity * 100)}%</span>
    <input type="range" min="0" max="1" step="0.01" value={cur.opacity} oninput={(e) => setTf(o.id, { opacity: +e.currentTarget.value })} />
  </label>
  {#if o.kind !== 'text'}
    {@const c = o.tf.crop ?? [0, 0, 0, 0]}
    <div class="crop">
      {#each [['cropL', 0], ['cropT', 1], ['cropR', 2], ['cropB', 3]] as [label, i]}
        <label class="vol">{t(label as string)} <span class="mono small">{Math.round(c[i as number] * 100)}%</span>
          <input type="range" min="0" max="0.45" step="0.01" value={c[i as number]}
            oninput={(e) => setTf(o.id, { crop: c.with(i as number, +e.currentTarget.value) as Transform['crop'] })} />
        </label>
      {/each}
    </div>
  {/if}
  <label class="vol">{t('blend')}
    <select value={o.blend ?? 'normal'} onchange={(e) => (setOverlay(o.id, { blend: e.currentTarget.value === 'normal' ? undefined : (e.currentTarget.value as Blend) }), doneEditing())}>
      {#each BLENDS as b (b)}<option value={b}>{t('bl.' + b)}</option>{/each}
    </select>
  </label>
  {#if o.kind !== 'text'}
    <KeyControls key={o.key} picking={pickKey === o.id} onpick={() => startPick(o.id)}
      set={(k, final) => (setOverlay(o.id, { key: k }), final && doneEditing())} />
    <details class="lfx" open={!!o.mask}>
      <summary>{t('mask')}</summary>
      <select value={o.mask?.shape ?? 'none'} aria-label={t('mask')}
        onchange={(e) => { const v = e.currentTarget.value; setOverlay(o.id, { mask: v === 'none' ? undefined : { ...DEFAULT_MASK, ...o.mask, shape: v as 'rect' } }); doneEditing(); }}>
        {#each ['none', 'ellipse', 'rect', 'linear'] as m (m)}<option value={m}>{t('mk.' + m)}</option>{/each}
      </select>
      <div class="lrow">
        <button class="sm" onclick={() => (setOverlay(o.id, maskReveal('wipe')), doneEditing())} title={t('mkWipeTip')}>{t('mkWipe')}</button>
        <button class="sm" onclick={() => (setOverlay(o.id, maskReveal('spot')), doneEditing())} title={t('mkSpotTip')}>{t('mkSpot')}</button>
      </div>
      {#if o.mask}
        {@const m = maskAt(o, outNow())!}
        {@const lt = layerT(o)}
        <div class="lrow">
          <button class="sm" class:on={!!o.maskKf?.some((k) => Math.abs(k.t - lt) <= 1 / 60)} title={t('mkKeyTip')}
            onclick={() => { const has = o.maskKf?.find((k) => Math.abs(k.t - lt) <= 1 / 60); setOverlay(o.id, { maskKf: has ? o.maskKf!.filter((k) => k !== has) : setMaskKey(o.maskKf, lt, m) }); doneEditing(); }}>◆ {t('mkKey')}</button>
          {#if o.maskKf?.length}<button class="sm" onclick={() => (setOverlay(o.id, { mask: m, maskKf: undefined }), doneEditing())}>{t('mkClearKeys', { n: o.maskKf.length })}</button>{/if}
        </div>
        {#each (m.shape === 'linear' ? [['mkAngle', 'angle', -180, 180, 1], ['mkPos', 'pos', 0, 1, 0.01]] : [['mkW', 'w', 0.05, 1, 0.01], ['mkH', 'h', 0.05, 1, 0.01]]).concat([['mkFeather', 'feather', 0, 0.5, 0.01]]) as [label, f, lo, hi, st] (f)}
          <label class="vol">{t(label as string)} <span class="mono small">{f === 'angle' ? `${m.angle}°` : `${Math.round(m[f as 'w'] * 100)}%`}</span>
            <input type="range" min={lo} max={hi} step={st} value={m[f as 'w']} onchange={doneEditing}
              oninput={(e) => { const nm = { ...m, [f as string]: +e.currentTarget.value }; setOverlay(o.id, o.maskKf?.length ? { maskKf: setMaskKey(o.maskKf, lt, nm) } : { mask: nm }); }} />
          </label>
        {/each}
        <label class="chk"><input type="checkbox" checked={!!o.mask.invert} onchange={(e) => (setOverlay(o.id, { mask: { ...o.mask!, invert: e.currentTarget.checked || undefined } }), doneEditing())} /> {t('mkInvert')}</label>
      {/if}
    </details>
  {/if}
  {#if o.kind === 'video'}
    <label class="vol">{t('volume')} <span class="mono small">{Math.round((o.volume ?? 0) * 100)}%</span>
      <input type="range" min="0" max="1" step="0.05" value={o.volume ?? 0} oninput={(e) => setOverlay(o.id, { volume: +e.currentTarget.value })} />
    </label>
  {/if}
  <div class="lrow">
    <button class="sm" class:on={o.behind} aria-pressed={!!o.behind} title={t('layerBehind')}
      onclick={() => (setOverlay(o.id, { behind: !o.behind || undefined }), doneEditing())}><Icon name="person" /> {t('behindPerson')}</button>
    <button class="sm" class:on={o.tf.flipX} aria-pressed={!!o.tf.flipX} onclick={() => (setTf(o.id, { flipX: !o.tf.flipX }), doneEditing())}><Icon name="flip" /> {t('flip')}</button>
    <button class="sm" onclick={() => (setTf(o.id, { x: 0.5, y: 0.5, rotation: 0, crop: undefined, flipX: false, opacity: 1 }), doneEditing())}>{t('resetLayer')}</button>
    <span class="muted small" title={t('trackTip')}>V{(o.track ?? 0) + 2}</span>
    <button class="sm icon" onclick={() => restack(1)} title={t('bringForward')} aria-label={t('bringForward')}><Icon name="flip_to_front" /></button>
    <button class="sm icon" onclick={() => restack(-1)} disabled={!o.track} title={t('sendBackward')} aria-label={t('sendBackward')}><Icon name="flip_to_back" /></button>
    <button class="sm" onclick={removeOverlay}>{t('del')}</button>
  </div>
</section>

<style>
  textarea { resize: vertical; background: none; border: 1px solid transparent; padding: 2px 4px; font-size: 14px; line-height: 1.4; }
  textarea:hover, textarea:focus { border-color: var(--border); }
</style>
