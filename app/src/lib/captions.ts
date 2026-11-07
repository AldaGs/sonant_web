import type { Style } from './render';

export type Word = { text: string; start: number; end: number }; // seconds, source time
export type Caption = { id: string; words: Word[]; speaker?: number; style?: Partial<Style> }; // speaker: index into the project speaker list; style: per-caption override

const MAX_WORDS = 6;
const MAX_SECONDS = 2.5;
const MAX_GAP = 0.8; // silence longer than this starts a new caption

export function groupWords(words: Word[]): Caption[] {
  const out: Caption[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) out.push({ id: crypto.randomUUID(), words: cur });
    cur = [];
  };
  for (const w of words) {
    const first = cur[0];
    const last = cur[cur.length - 1];
    if (
      first &&
      (cur.length >= MAX_WORDS ||
        w.end - first.start > MAX_SECONDS ||
        w.start - last.end > MAX_GAP ||
        /[.!?…]$/.test(last.text))
    ) flush();
    cur.push(w);
  }
  flush();
  return out;
}

export const captionText = (c: Caption) => c.words.map((w) => w.text).join(' ');
export const startOf = (c: Caption) => c.words[0].start;
export const endOf = (c: Caption) => c.words[c.words.length - 1].end;

// New text for a caption. Same word count keeps per-word timings; otherwise spread evenly.
export function setText(c: Caption, text: string): Caption {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return c;
  if (parts.length === c.words.length) return { ...c, words: c.words.map((w, i) => ({ ...w, text: parts[i] })) };
  const s = startOf(c), step = (endOf(c) - s) / parts.length;
  return { ...c, words: parts.map((p, i) => ({ text: p, start: s + i * step, end: s + (i + 1) * step })) };
}

// Move caption start/end, scaling word timings to fit.
export function setRange(c: Caption, start: number, end: number): Caption {
  if (!(end > start) || start < 0) return c;
  const s0 = startOf(c), k = (end - start) / (endOf(c) - s0 || 1);
  return { ...c, words: c.words.map((w) => ({ ...w, start: start + (w.start - s0) * k, end: start + (w.end - s0) * k })) };
}

export function split(list: Caption[], i: number, at = Math.ceil(list[i].words.length / 2)): Caption[] {
  const c = list[i];
  if (at <= 0 || at >= c.words.length) return list;
  const a = { ...c, words: c.words.slice(0, at) }, b = { ...c, id: crypto.randomUUID(), words: c.words.slice(at) };
  return [...list.slice(0, i), a, b, ...list.slice(i + 1)];
}

export function mergeNext(list: Caption[], i: number): Caption[] {
  if (i + 1 >= list.length) return list;
  const m = { ...list[i], words: [...list[i].words, ...list[i + 1].words] };
  return [...list.slice(0, i), m, ...list.slice(i + 2)];
}

const stamp = (t: number, sep: string) => {
  const ms = Math.round(t * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};

export const toSRT = (list: Caption[]) =>
  list.map((c, i) => `${i + 1}\n${stamp(startOf(c), ',')} --> ${stamp(endOf(c), ',')}\n${captionText(c)}\n`).join('\n');

export const toVTT = (list: Caption[]) =>
  'WEBVTT\n\n' + list.map((c) => `${stamp(startOf(c), '.')} --> ${stamp(endOf(c), '.')}\n${captionText(c)}\n`).join('\n');

// Give every caption in `ids` the speaker `k` (undefined clears it).
export const setSpeaker = (list: Caption[], ids: Set<string>, k: number | undefined): Caption[] =>
  list.map((c) => (ids.has(c.id) ? { ...c, speaker: k } : c));
