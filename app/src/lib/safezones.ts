import type { Box } from './render';

// Where each app draws its own UI over a vertical video (fractions of the frame). Approximate, from
// each app's 9:16 layout: header at the top, caption/description/music at the bottom, buttons at the right.
export type Platform = 'tiktok' | 'reels' | 'shorts';
type Zone = [number, number, number, number]; // x, y, w, h
export const SAFE_ZONES: Record<Platform, Zone[]> = {
  tiktok: [[0, 0, 1, 0.09], [0, 0.8, 1, 0.2], [0.86, 0.38, 0.14, 0.42]],
  reels: [[0, 0, 1, 0.1], [0, 0.78, 1, 0.22], [0.86, 0.45, 0.14, 0.33]],
  shorts: [[0, 0, 1, 0.08], [0, 0.78, 1, 0.22], [0.85, 0.42, 0.15, 0.36]],
};

export function drawSafeZones(ctx: CanvasRenderingContext2D, p: Platform, warn: boolean) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save();
  ctx.fillStyle = warn ? 'rgba(255, 107, 107, 0.28)' : 'rgba(255, 255, 255, 0.16)';
  ctx.strokeStyle = warn ? 'rgba(255, 107, 107, 0.9)' : 'rgba(255, 255, 255, 0.55)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = Math.max(1, W / 540);
  for (const [x, y, w, h] of SAFE_ZONES[p]) {
    ctx.fillRect(x * W, y * H, w * W, h * H);
    ctx.strokeRect(x * W, y * H, w * W, h * H);
  }
  ctx.restore();
}

// Does a caption box (canvas px) run under any of the app's UI?
export const overlapsZone = (p: Platform, b: Box, W: number, H: number) =>
  SAFE_ZONES[p].some(([x, y, w, h]) => b.x < (x + w) * W && b.x + b.w > x * W && b.y < (y + h) * H && b.y + b.h > y * H);
