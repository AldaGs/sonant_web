export type Thumb = { t: number; url: string };

// Grab n small frames across the video using a throwaway <video>.
export async function thumbnails(src: string, duration: number, n = 40): Promise<Thumb[]> {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = src;
  await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = j)));
  if (!v.videoWidth) return [];
  const c = document.createElement('canvas');
  c.height = 48;
  c.width = Math.round((48 * v.videoWidth) / v.videoHeight);
  const ctx = c.getContext('2d')!;
  const out: Thumb[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * duration;
    v.currentTime = t;
    await new Promise((r) => (v.onseeked = r));
    ctx.drawImage(v, 0, 0, c.width, c.height);
    out.push({ t, url: c.toDataURL('image/jpeg', 0.6) });
  }
  v.removeAttribute('src');
  v.load();
  return out;
}
