// Media items that fill the frame (Overlay.fill): cropped to cover it around their focus point, like a classic
// main video, with their stabilisation and punch-in on top. The lowest one on screen is drawn by drawFrame
// (segment.ts) with background and text-behind effects; others are drawn here.
import { zoomPlace } from './cuts.ts';
import { coverPlace } from './reframe.ts';
import { stabPlace } from './stabilize.ts';
import { compositeOp } from './layerfx.ts';
import { fileAt } from './model.ts';
import type { Overlay } from './overlay.ts';

/** Where a fill item's picture goes on a W×H frame at output time t: [x, y, w, h]. */
export function fillPlace(o: Overlay, sw: number, sh: number, W: number, H: number, t: number): number[] {
  const fx = o.fx;
  return zoomPlace(stabPlace(coverPlace(W, H, sw, sh, fx?.focus), W, H, fx?.stab, fileAt(o, t)), W, H, fx, t - o.at);
}

/** Draw a fill item that isn't the bottom one (its opacity and blend apply). */
export function drawFill(ctx: CanvasRenderingContext2D, o: Overlay, src: CanvasImageSource, sw: number, sh: number, t: number) {
  const [x, y, w, h] = fillPlace(o, sw, sh, ctx.canvas.width, ctx.canvas.height, t);
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, o.tf.opacity));
  if (o.blend) ctx.globalCompositeOperation = compositeOp(o.blend);
  if (o.tf.flipX) (ctx.translate(x * 2 + w, 0), ctx.scale(-1, 1));
  ctx.drawImage(src, x, y, w, h);
  ctx.restore();
}
