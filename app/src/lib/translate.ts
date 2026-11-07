import type { Caption, Word } from './captions.ts';
import { pickEmphasis } from './keywords.ts';
import type { Dir, In, Out } from './translate.worker.ts';
export type { Dir };

let worker: Worker | null = null;
export function translateTexts(texts: string[], dir: Dir, onStatus: (s: string, pct: number) => void): Promise<string[]> {
  worker ??= new Worker(new URL('./translate.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker!.onmessage = ({ data }: MessageEvent<Out>) => {
      if (data.type === 'loading') onStatus('st.downloadTr', data.progress);
      else if (data.type === 'progress') onStatus('st.translating', data.progress);
      else if (data.type === 'done') resolve(data.texts);
      else reject(new Error(data.message));
    };
    worker!.postMessage({ texts, dir } satisfies In);
  });
}

// Lay translated text over the time the original (kept) words occupy: each new word gets an equal share
// of the spoken time, walking the original words, so word animations still follow the speech and
// nothing lands inside a cut.
export function spreadWords(text: string, words: Word[]): Word[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length || !words.length) return [];
  const spoken = words.reduce((a, w) => a + Math.max(0, w.end - w.start), 0);
  // Real time at a point `p` seconds into the spoken time.
  // `start`: a point exactly on a boundary belongs to the next word (a start), else to the previous (an end).
  const at = (p: number, start = false) => {
    for (const w of words) {
      const d = Math.max(0, w.end - w.start);
      if (start ? p < d - 1e-9 : p <= d + 1e-9) return w.start + Math.min(p, d);
      p -= d;
    }
    return words[words.length - 1].end;
  };
  const n = parts.length;
  return parts.map((text, i) => {
    const a = at((i / n) * spoken, true), b = at(((i + 1) / n) * spoken);
    // Cuts judge a word by its midpoint. If a word straddles a pause (which may be a cut), shorten it so
    // its midpoint stays inside the original word it starts in.
    const inWord = (x: number) => words.some((w) => x >= w.start && x < w.end);
    if (inWord((a + b) / 2)) return { text, start: a, end: b };
    const host = words.find((w) => a >= w.start - 1e-9 && a < w.end) ?? words[words.length - 1];
    return { text, start: a, end: Math.max(a + 0.01, Math.min(b, 2 * host.end - a - 1e-3)) };
  });
}

// Captions as shown with translation on: translated ones get their new words; others stay as they are.
// Emphasis carries over: a caption with n emphasized words gets the n best key words of its translation.
export const translated = (caps: Caption[]) =>
  caps.map((c) => {
    if (!c.tr) return c;
    const words = spreadWords(c.tr, c.words), n = c.words.filter((w) => w.em).length;
    if (n) for (const i of pickEmphasis(words, { perCaption: n })) words[i] = { ...words[i], em: true };
    return { ...c, words };
  }).filter((c) => c.words.length);
