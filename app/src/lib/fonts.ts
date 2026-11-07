// Bundled OFL fonts (self-hosted by Vite, include Spanish accents).
import '@fontsource/montserrat/800.css';
import '@fontsource/poppins/800.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/anton/400.css';
import '@fontsource/inter/800.css';
import '@fontsource/roboto/900.css';
import '@fontsource/lobster/400.css';
import '@fontsource/permanent-marker/400.css';
import '@fontsource/dm-serif-display/400.css';
import '@fontsource/dm-serif-display/400-italic.css';

export type Font = { family: string; weight: number };

export const BUNDLED: Font[] = [
  { family: 'Montserrat', weight: 800 },
  { family: 'Poppins', weight: 800 },
  { family: 'Bebas Neue', weight: 400 },
  { family: 'Anton', weight: 400 },
  { family: 'Inter', weight: 800 },
  { family: 'Roboto', weight: 900 },
  { family: 'Lobster', weight: 400 },
  { family: 'Permanent Marker', weight: 400 },
  { family: 'DM Serif Display', weight: 400 },
];

// Installed fonts on the user's PC (Chrome/Edge only, asks permission).
export async function localFonts(): Promise<Font[]> {
  const q = (window as any).queryLocalFonts;
  if (!q) throw new Error('err.noLocalFonts');
  const fonts: { family: string }[] = await q();
  return [...new Set(fonts.map((f) => f.family))].sort().map((family) => ({ family, weight: 700 }));
}

// Uploaded font: raw bytes are kept so the project store can save and re-register them.
export type SavedFont = { family: string; data: ArrayBuffer };

export async function registerFont(f: SavedFont): Promise<Font> {
  document.fonts.add(await new FontFace(f.family, f.data).load());
  return { family: f.family, weight: 400 };
}

export async function uploadFont(file: File): Promise<SavedFont> {
  const saved = { family: file.name.replace(/\.[^.]+$/, ''), data: await file.arrayBuffer() };
  await registerFont(saved);
  return saved;
}
