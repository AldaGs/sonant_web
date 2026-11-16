// One frame of the timeline, drawn the same way by the preview and the export: every visible item from V1 up,
// then the caption. The lowest item, when it is media that fills the frame, is the "main video" of that moment:
// it gets reframing, punch-in, auto-zoom, background swaps and text-behind-person, and the transition into it
// from the item before it on its track is drawn over the finished frame.
import type { Caption } from './captions.ts';
import type { Fx } from './cuts.ts';
import type { Color } from './grade.ts';
import { drawCaption, resolveStyle, type Box, type Style } from './render.ts';
import { drawFrame } from './segment.ts';
import { autoZoomPlace, shakePlace, zoomShake, type ZoomMoment } from './autozoom.ts';
import { drawOverlay, type Overlay, type Placed } from './overlay.ts';
import { fillPlace, drawFill } from './fill.ts';
import { Transitioner, TRANS_DUR } from './transitions.ts';

export type Pic = { src: CanvasImageSource; w: number; h: number };
export type ComposeEnv = {
  mediaOf: (o: Overlay) => Pic | null; // an item's current frame / image
  grade: (src: CanvasImageSource, w: number, h: number, c: Color, t: number) => CanvasImageSource;
  bgImageOf: (fx?: Fx) => Pic | null;
  zooms: ZoomMoment[]; zoomScale: number; zoomShake: boolean; // auto-zoom (output time)
  trans: Transitioner;
  all: Overlay[]; // every item (to find the one before the bottom item, for its transition)
  style: Style;
};

/** Draw the items on screen at output time t (stacking order) and the caption. Returns what can be grabbed. */
export function compose(ctx: CanvasRenderingContext2D, items: Overlay[], t: number, cap: Caption | null, env: ComposeEnv): { placed: Placed[]; capBox: Box | null } {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const base = items[0] && items[0].kind !== 'text' && items[0].fill ? items[0] : null;
  const rest = base ? items.slice(1) : items;
  let placed: Placed[] = [], below: Placed[] = [], capBox: Box | null = null;
  const pic = (x: Overlay) => {
    const m = env.mediaOf(x);
    return m && x.fx?.color ? { ...m, src: env.grade(m.src, m.w, m.h, x.fx.color, t) } : m;
  };
  const draw = (behind: boolean): Placed[] => {
    const res: Placed[] = [];
    for (const x of rest) {
      if (!!x.behind !== behind) continue;
      const m = pic(x);
      if (x.fill && x.kind !== 'text') {
        if (m) drawFill(ctx, x, m.src, m.w, m.h, t);
        continue;
      }
      const p = drawOverlay(ctx, x, t, m?.src ?? null, m?.w ?? 0, m?.h ?? 0);
      if (p) res.push(p);
    }
    return res;
  };
  const above = () => {
    placed = [...below, ...draw(false)];
    capBox = cap ? drawCaption(ctx, cap, t, resolveStyle(env.style, cap.style)) : null;
  };
  if (base) {
    const m = pic(base), fx = base.fx;
    const place = m ? shakePlace(autoZoomPlace(fillPlace(base, m.w, m.h, W, H, t), W, H, env.zooms, env.zoomScale, t), W, H,
      Math.max(fx?.shake ?? 0, env.zoomShake ? zoomShake(env.zooms, t) : 0), t) : [0, 0, W, H];
    const anyBehind = rest.some((x) => x.behind);
    drawFrame(ctx, m?.src ?? null, m?.w ?? W, m?.h ?? H, place, fx, !!cap, above, anyBehind ? () => (below = draw(true)).length > 0 : undefined, env.bgImageOf(fx));
    const k = base.track ?? 0;
    const prev = fx?.trans ? env.all.find((x) => x.id !== base.id && (x.track ?? 0) === k && Math.abs(x.at + x.len - base.at) < 0.02) : undefined;
    env.trans.apply(ctx, fx?.trans, base.id, prev?.id ?? null, t - base.at, fx?.transDur ?? TRANS_DUR);
  } else {
    above();
    env.trans.apply(ctx, undefined, '', null, 0);
  }
  return { placed, capBox };
}
