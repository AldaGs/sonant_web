// The preview canvas: the draw loop, layer and caption handles, pointer dragging and the key-colour picker.
import { isLockedV } from '../tracks';
import { untrack } from 'svelte';
import { startOf, endOf, type Caption } from '../captions';
import { drawCaption, fontString, resolveStyle, inBox, type Box } from '../render';
import { compose, type ComposeEnv } from '../compose';
import { byTrack } from '../tracks';
import { drawSafeZones, overlapsZone, type Platform } from '../safezones';
import { DEFAULT_KEY, keyBypass } from '../layerfx';
import { drawOverlay, overlaysAt, hitPlaced, corner, sPoint, hasPath, tfAt, type Overlay, type Placed, type Transform } from '../overlay';
import { t } from '../i18n.svelte';
import type { Ed } from './ed';

export function createPreview(ed: Ed) {
  // Draw loop: advance the player, then draw every visible track from V1 up, then the caption.
  $effect(() => {
    if (!ed.canvas) return;
    const ctx = ed.canvas.getContext('2d')!;
    const cv = ed.canvas;
    let id = 0;
    const tick = () => {
      const w = ed.frameW, h = ed.frameH;
      if (cv.width !== w || cv.height !== h) ((cv.width = w), (cv.height = h));
      const o = ed.player.tick();
      ed.time = o;
      ed.outClock = o;
      ed.paused = !ed.player.playing;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      const cap = ed.displayCaps.find((c) => o >= startOf(c) && o < endOf(c));
      capOnScreen = cap ? ed.captions.find((c) => c.id === cap.id) ?? cap : null;
      capBox = null;
      const r = compose(ctx, byTrack(overlaysAt(ed.shownOverlays, o)), o, cap ?? null, env);
      placed = r.placed;
      capBox = r.capBox;
      const sel = placed.find((p) => p.id === ed.selectedOverlay);
      const selO = sel && ed.overlays.find((x) => x.id === sel.id);
      if (selO && hasPath(selO.motion)) drawSPath(ctx, selO, cv.width / (cv.getBoundingClientRect().width || cv.width));
      if (sel) drawLayerBox(ctx, sel, cv.width / (cv.getBoundingClientRect().width || cv.width));
      // Drag box: preview only (export never draws it). Shown while paused, hovered or dragged.
      // Platform UI zones (preview only): captions under the app's buttons/description get a warning.
      ed.capInZone = !!(ed.safe && capBox && overlapsZone(ed.safe, capBox, w, h));
      if (ed.safe) drawSafeZones(ctx, ed.safe, ed.capInZone);
      if (capBox && (ed.paused || hover || drag?.onBox)) drawDragBox(ctx, capBox, cv.width / (cv.getBoundingClientRect().width || cv.width));
      id = requestAnimationFrame(tick);
    };
    untrack(tick); // the loop reads and writes state every frame; the effect itself only depends on the canvas
    return () => cancelAnimationFrame(id);
  });

  // Make sure the chosen font is downloaded before the canvas uses it.
  $effect(() => {
    document.fonts.load(fontString(ed.style, 40)).catch(() => {});
  });

  // ---- Items on the preview ----
  let placed: Placed[] = [];
  const env: ComposeEnv = {
    mediaOf(x) {
      if (x.kind === 'video') return ed.player.frame(x.id);
      const pic = x.kind === 'image' ? ed.pics.get(x.assetId ?? '') : undefined;
      return pic ? { src: pic.src, w: pic.w, h: pic.h } : null;
    },
    grade: (src, w, h, c, t) => ed.grader.apply(src, w, h, c, ed.lutMap.get(c.lut ?? ''), t),
    bgImageOf: (fx) => (fx?.bg === 'image' && fx.bgImage && ed.pics.get(fx.bgImage)) || null,
    get zooms() { return ed.zooms; },
    get zoomScale() { return ed.autoZoom?.scale ?? 1; },
    get zoomShake() { return !!ed.autoZoom?.shake; },
    get trans() { return ed.trans; },
    get all() { return ed.overlays; },
    get style() { return ed.style; },
  };
  // Preview guide for a title's S path (export never draws it).
  function drawSPath(ctx: CanvasRenderingContext2D, o: Overlay, k: number) {
    const W = ctx.canvas.width, H = ctx.canvas.height, base = tfAt(o, ed.player.o), m = o.motion!;
    ctx.save();
    ctx.strokeStyle = 'rgba(106,184,255,0.8)';
    ctx.lineWidth = 2 * k;
    ctx.setLineDash([6 * k, 6 * k]);
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const p = sPoint(m, i / 48), x = (base.x + p.dx) * W, y = (base.y + p.dy) * H;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
  // Selection frame: rotated outline, corner squares to scale, a round knob above to rotate.
  const ROT_GAP = 26; // CSS px from the top edge to the rotate knob
  function drawLayerBox(ctx: CanvasRenderingContext2D, p: Placed, k: number) {
    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.strokeStyle = '#6ab8ff';
    ctx.lineWidth = 2 * k;
    ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.beginPath();
    ctx.moveTo(0, -p.h / 2);
    ctx.lineTo(0, -p.h / 2 - ROT_GAP * k);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    const r = 5 * k;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.fillRect(sx * p.w / 2 - r, sy * p.h / 2 - r, r * 2, r * 2);
      ctx.strokeRect(sx * p.w / 2 - r, sy * p.h / 2 - r, r * 2, r * 2);
    }
    ctx.beginPath();
    ctx.arc(0, -p.h / 2 - ROT_GAP * k, 6 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  // Which part of the selected layer's frame is under a canvas point.
  function layerHandle(p: Placed, x: number, y: number, k: number, grow: number): 'scale' | 'rotate' | null {
    const g = (grow + 6) * k;
    const a = (p.rot * Math.PI) / 180, top = { x: p.cx + Math.sin(a) * (p.h / 2 + ROT_GAP * k), y: p.cy - Math.cos(a) * (p.h / 2 + ROT_GAP * k) };
    if (Math.hypot(x - top.x, y - top.y) <= g + 4 * k) return 'rotate';
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const c = corner(p, sx, sy);
      if (Math.hypot(x - c.x, y - c.y) <= g) return 'scale';
    }
    return null;
  }
  type LayerDrag = { id: string; mode: 'move' | 'scale' | 'rotate'; x0: number; y0: number; tf: Transform; cx: number; cy: number; d0: number; a0: number; moved: boolean };
  let layerDrag: LayerDrag | null = null;

  // ---- Caption drag box ----
  // Drag inside the box (or its grab handle) to move the caption; a tap elsewhere plays/pauses.
  // Touch and pen get a much larger grab margin than a mouse.
  let capBox: Box | null = null; // canvas px, caption drawn this frame
  let capOnScreen: Caption | null = null;
  let hover = false;
  let drag: { moved: boolean; onBox: boolean; x0: number; y0: number; ox: number; oy: number; capId: string | null } | null = null;
  const GROW = { mouse: 8, touch: 28 }; // CSS px around the box that still grabs it
  const HANDLE = 14; // CSS px radius of the round grab handle under the box

  const handleAt = (b: Box, k: number) => ({ x: b.x + b.w / 2, y: b.y + b.h + HANDLE * 1.6 * k });

  function drawDragBox(ctx: CanvasRenderingContext2D, b: Box, k: number) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * k;
    ctx.setLineDash([6 * k, 4 * k]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    const s = 8 * k;
    for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) ctx.fillRect(x - s / 2, y - s / 2, s, s);
    // Round grab handle with a four-way arrow, easy to hit with a thumb.
    const h = handleAt(b, k), r = HANDLE * k;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f0f0f';
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(h.x - r * 0.55, h.y); ctx.lineTo(h.x + r * 0.55, h.y);
    ctx.moveTo(h.x, h.y - r * 0.55); ctx.lineTo(h.x, h.y + r * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  // Is this pointer on the caption box or its handle? Coordinates are canvas px.
  function onCaption(e: PointerEvent) {
    if (!capBox) return false;
    const r = ed.canvas!.getBoundingClientRect(), k = ed.canvas!.width / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const touch = e.pointerType !== 'mouse';
    const h = handleAt(capBox, k);
    return inBox(capBox, x, y, (touch ? GROW.touch : GROW.mouse) * k) || Math.hypot(x - h.x, y - h.y) <= (HANDLE + (touch ? 16 : 4)) * k;
  }

  // Captions with their own position override move by themselves; others move the project style.
  const ownPosition = (c: Caption | null) => !!c && (c.style?.x !== undefined || c.style?.y !== undefined || ed.selectedSet.has(c.id));
  function moveCaption(capId: string | null, x: number, y: number) {
    const nx = Math.min(0.95, Math.max(0.05, x)), ny = Math.min(0.95, Math.max(0.05, y));
    if (capId) ed.captions = ed.captions.map((c) => (c.id === capId ? { ...c, style: { ...c.style, x: nx, y: ny } } : c));
    else ((ed.style.x = nx), (ed.style.y = ny));
  }

  function pointer(e: PointerEvent) {
    const r = ed.canvas!.getBoundingClientRect();
    const k = ed.canvas!.width / (r.width || ed.canvas!.width);
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const grow = e.pointerType === 'mouse' ? 0 : 14;
    if (ed.pickKey) {
      if (e.type === 'pointerdown') samplePick(x, y);
      else ed.canvas!.style.cursor = 'crosshair';
      return;
    }
    if (layerPointer(e, x, y, k, grow)) return;
    if (e.type === 'pointerdown') {
      const onBox = onCaption(e);
      const capId = onBox && ownPosition(capOnScreen) ? capOnScreen!.id : null;
      const pos = capId ? resolveStyle(ed.style, capOnScreen!.style) : ed.style;
      drag = { moved: false, onBox, x0: e.clientX, y0: e.clientY, ox: pos.x, oy: pos.y, capId };
      ed.canvas!.setPointerCapture(e.pointerId);
    } else if (e.type === 'pointermove') {
      if (!drag) {
        hover = onCaption(e);
        ed.canvas!.style.cursor = hover ? 'move' : 'pointer';
        return;
      }
      if (!drag.onBox) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) ((drag.moved = true), drag.capId && ed.commit()); // one undo step per drag of a caption override
      moveCaption(drag.capId, drag.ox + dx / r.width, drag.oy + dy / r.height);
    } else if (e.type === 'pointerup' || e.type === 'pointercancel') {
      if (drag && !drag.moved && e.type === 'pointerup') ed.toggle();
      drag = null;
    }
  }

  // Layers: the selected one's handles win, then the caption box, then the topmost layer under the pointer.
  // Returns true when the event was a layer action.
  function layerPointer(e: PointerEvent, x: number, y: number, k: number, grow: number): boolean {
    if (e.type === 'pointerdown') {
      const sel = placed.find((p) => p.id === ed.selectedOverlay);
      let mode: LayerDrag['mode'] | null = sel ? layerHandle(sel, x, y, k, grow) : null;
      let hit = mode ? sel! : null;
      if (!hit && !onCaption(e)) {
        hit = [...placed].reverse().find((p) => hitPlaced(p, x, y, grow * k)) ?? null;
        if (hit) mode = 'move';
      }
      if (!hit || !mode) {
        if (ed.selectedOverlay && !onCaption(e)) ed.selectedOverlay = '';
        return false;
      }
      const o = ed.overlays.find((v) => v.id === hit!.id);
      if (!o || isLockedV(ed.tracks, o)) return false; // locked tracks can't be picked or moved in the preview
      ed.selectedOverlay = o.id;
      layerDrag = { id: o.id, mode, x0: x, y0: y, tf: { ...tfAt(o, ed.outNow()) }, cx: hit.cx, cy: hit.cy,
        d0: Math.max(1, Math.hypot(x - hit.cx, y - hit.cy)), a0: Math.atan2(y - hit.cy, x - hit.cx), moved: false };
      ed.canvas!.setPointerCapture(e.pointerId);
      return true;
    }
    if (e.type === 'pointermove') {
      if (!layerDrag) {
        const sel = placed.find((p) => p.id === ed.selectedOverlay);
        const h = sel && layerHandle(sel, x, y, k, grow);
        if (h) return ((ed.canvas!.style.cursor = h === 'rotate' ? 'grab' : 'nwse-resize'), true);
        if (!onCaption(e) && placed.some((p) => hitPlaced(p, x, y))) return ((ed.canvas!.style.cursor = 'move'), (hover = false), true);
        return false;
      }
      const d = layerDrag, W = ed.canvas!.width, H = ed.canvas!.height;
      if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < 4 * k) return true;
      if (!d.moved) ((d.moved = true), ed.commit());
      if (d.mode === 'move') {
        // Snap the centre to the frame's centre lines (Alt to place freely).
        let nx = d.tf.x + (x - d.x0) / W, ny = d.tf.y + (y - d.y0) / H;
        if (!e.altKey && Math.abs(nx - 0.5) < 0.015) nx = 0.5;
        if (!e.altKey && Math.abs(ny - 0.5) < 0.015) ny = 0.5;
        ed.setTf(d.id, { x: nx, y: ny }, false);
      } else if (d.mode === 'scale') {
        ed.setTf(d.id, { scale: Math.max(0.05, Math.min(8, d.tf.scale * (Math.hypot(x - d.cx, y - d.cy) / d.d0))) }, false);
      } else {
        let deg = d.tf.rotation + ((Math.atan2(y - d.cy, x - d.cx) - d.a0) * 180) / Math.PI;
        deg = ((deg % 360) + 540) % 360 - 180; // -180..180
        if (!e.altKey) for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(deg - s) < 5) deg = s;
        ed.setTf(d.id, { rotation: Math.round(deg) }, false);
      }
      return true;
    }
    if (layerDrag && (e.type === 'pointerup' || e.type === 'pointercancel')) {
      layerDrag = null;
      return true;
    }
    return false;
  }

  // Keyboard: with the preview focused, arrow keys nudge the caption (Shift = bigger steps).
  function nudge(e: KeyboardEvent) {
    const d = e.shiftKey ? 0.05 : 0.01;
    const dir = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (!dir) return;
    e.preventDefault();
    if (ed.selOverlay) {
      const cur = tfAt(ed.selOverlay, ed.outNow());
      return (ed.setTf(ed.selOverlay.id, { x: cur.x + dir[0], y: cur.y + dir[1] }), ed.doneEditing());
    }
    const capId = ownPosition(capOnScreen) ? capOnScreen!.id : null;
    const pos = capId ? resolveStyle(ed.style, capOnScreen!.style) : ed.style;
    moveCaption(capId, pos.x + dir[0], pos.y + dir[1]);
  }
  // Key colour picker: pickKey is the item whose green screen colour is being picked.
  function startPick(target: string) {
    if (ed.pickKey === target) return endPick();
    ed.pickKey = target;
    keyBypass.on = true;
  }
  function endPick() {
    ed.pickKey = null;
    keyBypass.on = false;
    if (ed.canvas) ed.canvas.style.cursor = '';
  }
  function samplePick(x: number, y: number) {
    const c = ed.canvas!.getContext('2d')!, r = 3;
    const d = c.getImageData(Math.max(0, Math.round(x) - r), Math.max(0, Math.round(y) - r), r * 2 + 1, r * 2 + 1).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) sum[j] += d[i + j];
    const hex = '#' + sum.map((v) => Math.round(v / (d.length / 4)).toString(16).padStart(2, '0')).join('');
    const o = ed.overlays.find((v) => v.id === ed.pickKey);
    // Items that fill the frame key through their effects (the background shows through); others through the layer key.
    if (o?.fill) (ed.setOverlay(o.id, { fx: { ...o.fx, key: { ...(o.fx?.key ?? DEFAULT_KEY), color: hex } } }), ed.doneEditing());
    else if (o) (ed.setOverlay(o.id, { key: { ...(o.key ?? DEFAULT_KEY), color: hex } }), ed.doneEditing());
    endPick();
  }

  const leave = () => (hover = false);

  return { leave, pointer, nudge, startPick, endPick };
}
