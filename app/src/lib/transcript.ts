import type { Word } from './captions';

// Pure hesitation sounds only. Real words that are sometimes fillers ("like", "este", "pues")
// are left out on purpose: removing them automatically would cut real speech.
const FILLERS = new Set([
  // English
  'um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'hmm', 'hm', 'mm', 'mhm',
  // Spanish
  'eh', 'ehm', 'em', 'emm', 'mmm',
]);

export const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}']/gu, '');

export const isFiller = (w: Word) => FILLERS.has(normalize(w.text));

// Silences between words longer than `min`, keeping `pad` of breathing room on each side.
// Includes leading silence before the first word and trailing silence after the last.
export function silenceRanges(words: Word[], duration: number, min = 0.6, pad = 0.15): [number, number][] {
  const out: [number, number][] = [];
  const gap = (a: number, b: number) => b - a > min && out.push([a + (a > 0 ? pad : 0), b - (b < duration ? pad : 0)]);
  if (!words.length) return out;
  gap(0, words[0].start);
  for (let i = 1; i < words.length; i++) gap(words[i - 1].end, words[i].start);
  gap(words[words.length - 1].end, duration);
  return out;
}

// Indices of words whose text contains the query (accent- and case-insensitive).
export function search(words: Word[], q: string): number[] {
  const n = normalize(q);
  if (!n) return [];
  return words.flatMap((w, i) => (normalize(w.text).includes(n) ? [i] : []));
}
