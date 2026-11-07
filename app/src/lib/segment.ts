import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import type { Fx } from './cuts';

// Person segmentation (MediaPipe selfie segmenter) for "captions behind the person" and background swap.
// Wasm + model come from CDNs on first use, so the app doesn't load them until a strip needs them.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let seg: ImageSegmenter | null = null;
let loading: Promise<void> | null = null;

export function loadSegmenter(): Promise<void> {
  return (loading ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
    });
    seg = await make('GPU').catch(() => make('CPU'));
  })().catch((e) => ((loading = null), Promise.reject(e))));
}

// The model works at 256px anyway, so segment a small copy and let the upscale soften the edges.
// Created on first use, so importing this module works where there is no canvas (Node tests).
const canvas2d = () => { const c = new OffscreenCanvas(1, 1); return [c, c.getContext('2d')!] as const; };
let small: OffscreenCanvas, sctx: OffscreenCanvasRenderingContext2D, mask: OffscreenCanvas, mctx: OffscreenCanvasRenderingContext2D;
let person: OffscreenCanvas, pctx: OffscreenCanvasRenderingContext2D;
let img: ImageData | null = null;

// Segment `src` into the mask. False while the model is still loading (it starts loading here).
function updateMask(src: CanvasImageSource, sw: number, sh: number): boolean {
  if (!seg) {
    loadSegmenter().catch(() => {});
    return false;
  }
  if (!small) [[small, sctx], [mask, mctx], [person, pctx]] = [canvas2d(), canvas2d(), canvas2d()];
  const k = 256 / Math.max(sw, sh);
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  if (small.width !== w || small.height !== h) ((small.width = w), (small.height = h));
  sctx.drawImage(src, 0, 0, w, h);
  seg.segment(small, (r) => {
    const m = r.confidenceMasks?.[0];
    if (!m) return;
    const conf = m.getAsFloat32Array();
    if (mask.width !== m.width || mask.height !== m.height) ((mask.width = m.width), (mask.height = m.height), (img = null));
    img ??= mctx.createImageData(m.width, m.height);
    const px = img.data;
    // Remap confidence 0.3..0.7 → alpha 0..1: firmer edge, little halo.
    for (let i = 0; i < conf.length; i++) px[i * 4 + 3] = Math.max(0, Math.min(255, (conf[i] - 0.3) * 637.5));
    mctx.putImageData(img, 0, 0);
  });
  return true;
}

// Where the person is in `src` (centre of the mask's weight, 0..1), or null if nobody is found.
export async function subjectCenter(src: CanvasImageSource, sw: number, sh: number): Promise<{ x: number; y: number } | null> {
  await loadSegmenter();
  if (!seg) return null;
  if (!small) [[small, sctx], [mask, mctx], [person, pctx]] = [canvas2d(), canvas2d(), canvas2d()];
  const k = 256 / Math.max(sw, sh), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  if (small.width !== w || small.height !== h) ((small.width = w), (small.height = h));
  sctx.drawImage(src, 0, 0, w, h);
  let out: { x: number; y: number } | null = null;
  seg.segment(small, (r) => {
    const m = r.confidenceMasks?.[0];
    if (!m) return;
    const conf = m.getAsFloat32Array();
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < conf.length; i++) if (conf[i] > 0.5) ((sx += i % m.width), (sy += Math.floor(i / m.width)), n++);
    // Bias towards the head: the top quarter of the person's box matters most when framing a face.
    if (n > conf.length * 0.01) out = { x: sx / n / m.width, y: Math.max(0, sy / n / m.height - 0.1) };
  });
  return out;
}

// Draw only the person from `src` (at place) over whatever ctx has, using the last mask.
function paintSubject(ctx: CanvasRenderingContext2D, src: CanvasImageSource, [dx, dy, dw, dh]: number[]) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (person.width !== W || person.height !== H) ((person.width = W), (person.height = H));
  pctx.globalCompositeOperation = 'copy';
  pctx.drawImage(mask, dx, dy, dw, dh);
  pctx.globalCompositeOperation = 'source-in';
  pctx.drawImage(src, dx, dy, dw, dh);
  pctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(person, 0, 0);
}

// One output frame: video (with background swapped if asked), caption, and the person over the caption if asked.
// Until the model has loaded, effects are skipped and the plain frame is drawn.
// ponytail: segments every frame (~25ms at 1080p); cache masks per strip if preview stutters on slow machines
export function drawFrame(
  ctx: CanvasRenderingContext2D, src: CanvasImageSource | null, sw: number, sh: number, place: number[],
  fx: Fx | undefined, hasCaption: boolean, caption: () => void,
) {
  const [dx, dy, dw, dh] = place;
  const ready = !!src && (!!fx?.bg || (!!fx?.behind && hasCaption)) && updateMask(src, sw, sh);
  if (src && ready && fx?.bg) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    if (fx.bg === 'color') ((ctx.fillStyle = fx.bgColor ?? '#00b140'), ctx.fillRect(0, 0, W, H));
    else {
      ctx.filter = `blur(${Math.round(Math.max(W, H) / 50)}px)`;
      ctx.drawImage(src, dx - dw * 0.05, dy - dh * 0.05, dw * 1.1, dh * 1.1); // oversize so the blur has no dark rim
      ctx.filter = 'none';
    }
    paintSubject(ctx, src, place);
  } else if (src) ctx.drawImage(src, dx, dy, dw, dh);
  caption();
  if (src && ready && fx?.behind && hasCaption) paintSubject(ctx, src, place);
}
