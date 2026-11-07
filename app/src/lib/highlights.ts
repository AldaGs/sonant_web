// Auto-clips: find 15–60s highlights in a long video's transcript and turn one into its own short project.
// Scoring uses the transcript only (sentences, hooks, questions, numbers, emphasis, pace), so it is instant
// and works offline. Times are sequence time, like captions.
import type { Caption, Word } from './captions.ts';
import { normalize, isFiller } from './transcript.ts';
import { toOutput, type Segment } from './cuts.ts';
import type { Overlay } from './overlay.ts';
import type { AudioItem } from './project.ts';

export type Sentence = { start: number; end: number; text: string; words: Word[]; score: number; hook: number };
export type Highlight = { start: number; end: number; score: number; title: string; reasons: string[] };
export type HighlightOpts = { min: number; max: number; count: number };
export const DEFAULT_HL: HighlightOpts = { min: 15, max: 60, count: 5 };

// Words and phrases that make people keep watching (EN + ES), matched on normalized text.
const HOOKS = [
  'how', 'why', 'what if', 'secret', 'never', 'always', 'best', 'worst', 'mistake', 'stop', 'imagine', 'truth', 'nobody',
  'everyone', 'actually', 'crazy', 'insane', 'heres', 'the reason', 'you need', 'dont', 'biggest', 'first', 'only', 'wrong', 'tip',
  'como', 'por que', 'que pasa', 'secreto', 'nunca', 'siempre', 'mejor', 'peor', 'error', 'deja de', 'imagina', 'verdad', 'nadie',
  'todos', 'en realidad', 'increible', 'loco', 'la razon', 'necesitas', 'no hagas', 'primero', 'unico', 'consejo', 'truco',
];

// Sentences: split at . ! ? or at pauses longer than `gap` seconds.
export function sentences(words: Word[], gap = 0.7): Sentence[] {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  const flush = () => {
    const ws = cur.filter((w) => !isFiller(w));
    if (ws.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: ws, text: ws.map((w) => w.text).join(' '), score: 0, hook: 0 });
    cur = [];
  };
  for (const [i, w] of words.entries()) {
    if (cur.length && w.start - words[i - 1].end > gap) flush();
    cur.push(w);
    if (/[.!?…]["')\]]*$/.test(w.text.trim())) flush();
  }
  flush();
  return out;
}

// How good a sentence is as the opening line (hook) and as content (score), 0..~10.
export function scoreSentence(s: Sentence, medianRate: number): Sentence {
  const n = ' ' + s.words.map((w) => normalize(w.text).replace(/'/g, '')).join(' ') + ' ';
  const hooks = HOOKS.filter((h) => n.includes(' ' + h + ' ')).length;
  const q = /[?¿]/.test(s.text) ? 1 : 0;
  const nums = s.words.filter((w) => /\p{N}/u.test(w.text)).length;
  const em = s.words.filter((w) => w.em).length;
  const excl = /!/.test(s.text) ? 1 : 0;
  const dur = Math.max(0.3, s.end - s.start), rate = s.words.length / dur;
  const pace = medianRate ? Math.max(-1, Math.min(1, (rate - medianRate) / medianRate)) : 0; // livelier delivery scores a little higher
  const short = s.words.length < 3 ? -1 : 0; // "Yeah." "Okay so."
  const hook = Math.min(4, hooks * 1.5) + q * 2 + Math.min(2, nums) + excl;
  const score = hook * 0.6 + Math.min(3, em) * 0.8 + pace + short + Math.min(2, s.words.length / 10);
  return { ...s, hook, score };
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// Best clips: windows of whole sentences between min and max seconds, ranked by a strong opening line,
// the average content score and how full the window is; then the top `count` that don't overlap.
export function findHighlights(caps: Caption[], o: HighlightOpts = DEFAULT_HL): Highlight[] {
  const words = caps.flatMap((c) => c.words).sort((a, b) => a.start - b.start);
  const raw = sentences(words);
  const rate = median(raw.map((s) => s.words.length / Math.max(0.3, s.end - s.start)));
  const ss = raw.map((s) => scoreSentence(s, rate));
  const cands: Highlight[] = [];
  for (let i = 0; i < ss.length; i++) {
    let sum = 0;
    for (let j = i; j < ss.length; j++) {
      const len = ss[j].end - ss[i].start;
      if (len > o.max) break;
      sum += ss[j].score;
      if (len < o.min) continue;
      const k = j - i + 1, avg = sum / k;
      const ending = /[.!?…]["')\]]*$/.test(ss[j].text) ? 0.5 : 0; // ends on a full sentence
      const score = ss[i].hook * 0.9 + avg + ending - (o.max - len) / o.max * 0.3; // a little credit for using the time
      const reasons = [
        ...(ss[i].hook >= 2 ? ['hook'] : []), ...(/[?¿]/.test(ss[i].text) ? ['question'] : []),
        ...(ss.slice(i, j + 1).some((s) => s.words.some((w) => /\p{N}/u.test(w.text))) ? ['numbers'] : []),
        ...(ss.slice(i, j + 1).some((s) => s.words.some((w) => w.em)) ? ['emphasis'] : []),
      ];
      cands.push({ start: ss[i].start, end: ss[j].end, score, title: ss[i].text, reasons });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const out: Highlight[] = [];
  for (const c of cands) {
    if (out.length >= o.count) break;
    if (out.some((h) => c.start < h.end && c.end > h.start)) continue;
    out.push(c);
  }
  return out;
}

// ---- Turning a highlight into its own project ----
// Kept segments limited to [a, b) (sequence time); strip effects stay.
export function clipSegments(segs: Segment[], a: number, b: number): Segment[] {
  return segs.flatMap((s) => {
    const start = Math.max(s.start, a), end = Math.min(s.end, b);
    return end - start > 0.02 ? [{ ...s, start, end }] : [];
  });
}

// Items placed in output time (music, voiceover, layers) moved to the short's timeline [A, B) and trimmed to it.
export function shiftTimed<T extends { at: number; offset?: number }>(items: T[], len: (x: T) => number, A: number, B: number, setLen: (x: T, l: number) => T): T[] {
  return items.flatMap((x) => {
    const s = Math.max(x.at, A), e = Math.min(x.at + len(x), B);
    if (e - s < 0.05) return [];
    const cut = s - x.at;
    const y = { ...x, at: s - A, ...(x.offset !== undefined || cut ? { offset: (x.offset ?? 0) + cut } : {}) };
    return [setLen(y, e - s)];
  });
}

// The parts of a project that change for a short of [a, b) (sequence time).
export function shortOf(p: { segments: Segment[]; overlays: Overlay[]; audios: AudioItem[]; captions: Caption[] }, a: number, b: number, itemLen: (x: AudioItem) => number) {
  const A = toOutput(p.segments, a) ?? 0;
  const segments = clipSegments(p.segments, a, b);
  const B = A + segments.reduce((t, s) => t + (s.fx?.hold ?? (s.end - s.start) / (s.fx?.speed ?? 1)), 0);
  // Only the words inside the clip, so the short's transcript isn't the whole long video struck out.
  const inside = (w: Word) => (w.start + w.end) / 2 >= a && (w.start + w.end) / 2 < b;
  const captions = p.captions.flatMap((c) => {
    const words = c.words.filter(inside);
    return words.length ? [words.length === c.words.length ? c : { ...c, words }] : [];
  });
  return {
    segments,
    captions,
    // Text layers have no offset: trimming the start shortens them instead.
    overlays: shiftTimed(p.overlays, (o) => o.len, A, B, (o, len) => ({ ...o, len, ...(o.kind !== 'video' && { offset: undefined }) })),
    audios: shiftTimed(p.audios, itemLen, A, B, (x, len) => ({ ...x, len })),
  };
}
