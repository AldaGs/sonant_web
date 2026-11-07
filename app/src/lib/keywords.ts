import type { Caption, Word } from './captions.ts';
import { isFiller, normalize } from './transcript.ts';

// Common words that carry little meaning in English and Spanish. They are never emphasized.
const STOP = new Set(
  (
    // English
    'a an the and or but so if then than that this these those there here is are was were be been being am ' +
    'do does did done have has had having i me my mine you your yours he him his she her hers it its we us our ' +
    'they them their what which who whom whose when where why how all any some no not just very really too also ' +
    'of to in on at by for with from up down out over into onto about as like can could would should will shall ' +
    'may might must get got go going gonna wanna im youre its dont cant thats ive ill lets yeah okay ok oh well ' +
    // Spanish
    'el la los las un una unos unas y o pero que de del al a en con por para sin sobre es son era fue ser estar ' +
    'esta este esto estos estas ese esa eso esos esas yo tu te ti mi mis me se su sus nos lo le les ya muy mas ' +
    'tambien como cuando donde porque pues entonces hay he ha han hemos tiene tengo si no ni bueno vale aqui alli'
  ).split(' '),
);

export type EmphasisOpts = { perCaption?: number; minScore?: number };

// How strongly a word stands out. 0 = never emphasize. `prev` is the previous word in the caption (if any).
export function wordScore(w: Word, prev?: Word): number {
  const raw = w.text.trim();
  const n = normalize(raw);
  if (!n || isFiller(w) || STOP.has(n.replace(/'/g, ''))) return 0;
  let s = 0;
  if (/\p{N}/u.test(raw)) s += 3; // numbers, years, prices
  if (/[$€£%]/.test(raw)) s += 1;
  const letters = raw.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) s += 2; // SHOUTED / acronym
  else if (prev && /^\p{Lu}/u.test(letters) && !/[.!?¿¡]$/.test(prev.text.trim())) s += 2; // proper noun mid-sentence
  if (/!/.test(raw)) s += 1.5;
  if (prev && /!$/.test(prev.text.trim())) s += 0.5;
  s += Math.min(2, Math.max(0, n.length - 4) * 0.35); // longer words tend to be the content words
  return s + 0.5; // any content word is a candidate
}

// Indices of the words to emphasize in one caption, best first, at most `perCaption`.
export function pickEmphasis(words: Word[], { perCaption = 1, minScore = 1 }: EmphasisOpts = {}): number[] {
  return words
    .map((w, i) => ({ i, s: wordScore(w, words[i - 1]) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, perCaption)
    .map((x) => x.i)
    .sort((a, b) => a - b);
}

// New captions with `em` set on the chosen words and cleared everywhere else.
export function autoEmphasis(caps: Caption[], opts: EmphasisOpts = {}): Caption[] {
  return caps.map((c) => {
    const pick = new Set(pickEmphasis(c.words, opts));
    return { ...c, words: c.words.map((w, i) => setEm(w, pick.has(i))) };
  });
}

export const clearEmphasis = (caps: Caption[]): Caption[] => caps.map((c) => ({ ...c, words: c.words.map((w) => setEm(w, false)) }));

export const hasEmphasis = (caps: Caption[]) => caps.some((c) => c.words.some((w) => w.em));

function setEm(w: Word, on: boolean): Word {
  if (on) return { ...w, em: true };
  if (!w.em) return w;
  const { em: _, ...rest } = w;
  return rest;
}
