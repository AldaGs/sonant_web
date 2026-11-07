// Transitions into a strip, drawn over the finished frame (video, layers, captions).
// The outgoing side is the last frame of the previous strip, held while the transition runs.
export type Trans = 'fade' | 'black' | 'white' | 'zoom' | 'whip' | 'slide';
export const TRANSITIONS: Trans[] = ['fade', 'black', 'white', 'zoom', 'whip', 'slide'];
export const TRANS_DUR = 0.4; // seconds

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Canvas = HTMLCanvasElement | OffscreenCanvas;
const smooth = (u: number) => u * u * (3 - 2 * u);
const makeCanvas = (w: number, h: number): Canvas =>
  typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });

// Keeps the last finished frame of each strip, and blends it into the next strip's start.
export class Transitioner {
  private last: Canvas | null = null;
  private lastIdx = -2;
  private tmp: Canvas | null = null;

  // Call once per frame after everything is drawn. i = strip index, into = output seconds into the strip.
  apply(ctx: Ctx, kind: Trans | undefined, i: number, into: number, dur = TRANS_DUR) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    if (kind && i > 0 && into < dur) {
      const prev = this.lastIdx === i - 1 && this.last ? this.last : null; // after a seek there's no outgoing frame
      draw(ctx, kind, smooth(Math.max(0, into) / dur), prev, W, H, () => {
        if (!this.tmp || this.tmp.width !== W || this.tmp.height !== H) this.tmp = makeCanvas(W, H);
        return this.tmp;
      });
      return;
    }
    if (!this.last || this.last.width !== W || this.last.height !== H) this.last = makeCanvas(W, H);
    const l = this.last.getContext('2d') as Ctx;
    l.drawImage(ctx.canvas, 0, 0);
    this.lastIdx = i;
  }
  reset() {
    this.lastIdx = -2;
  }
}

function draw(ctx: Ctx, kind: Trans, u: number, prev: Canvas | null, W: number, H: number, scratch: () => Canvas) {
  ctx.save();
  // Copy of the incoming frame, for moves that have to redraw it.
  const incoming = () => {
    const t = scratch();
    const c = t.getContext('2d') as Ctx;
    c.clearRect(0, 0, W, H);
    c.drawImage(ctx.canvas, 0, 0);
    return t;
  };
  if (kind === 'fade') {
    if (prev) ((ctx.globalAlpha = 1 - u), ctx.drawImage(prev, 0, 0));
  } else if (kind === 'black' || kind === 'white') {
    // Dip: the old frame fades to the colour, then the new one fades in from it.
    if (u < 0.5 && prev) ctx.drawImage(prev, 0, 0);
    ctx.fillStyle = kind === 'black' ? '#000' : '#fff';
    ctx.globalAlpha = u < 0.5 ? (prev ? u * 2 : 1) : (1 - u) * 2;
    ctx.fillRect(0, 0, W, H);
  } else if (kind === 'zoom') {
    const inc = incoming();
    const k = 1.25 - 0.25 * u; // new frame settles from 125%
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    // Zoom blur: a few slightly larger copies on top smear the image outwards, strongest mid-move.
    const blur = Math.sin(u * Math.PI) * 0.08, at = (img: CanvasImageSource, s: number) => ctx.drawImage(img, (W - W * s) / 2, (H - H * s) / 2, W * s, H * s);
    ctx.drawImage(inc, (W - W * k) / 2, (H - H * k) / 2, W * k, H * k);
    for (let j = 1; j <= 3 && blur > 0.005; j++) ((ctx.globalAlpha = 0.3), at(inc, k * (1 + blur * j / 3)));
    ctx.globalAlpha = 1;
    if (prev) {
      const p = 1 + u * 0.6; // old frame rushes towards the viewer and fades
      for (let j = 0; j <= 3; j++) ((ctx.globalAlpha = (1 - u) * (j ? 0.3 : 1)), at(prev, p * (1 + blur * j / 3)));
    }
  } else {
    const inc = incoming();
    const blur = kind === 'whip' ? Math.round(Math.sin(u * Math.PI) * W * 0.03) : 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (blur) ctx.filter = `blur(${blur}px)`;
    if (prev) ctx.drawImage(prev, -u * W, 0);
    ctx.drawImage(inc, (1 - u) * W, 0);
  }
  ctx.restore();
}
