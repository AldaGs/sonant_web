import type { Word } from './captions';
import { isCut, type Segment } from './cuts';
import { isFiller, silenceRanges } from './transcript';

// Clean-up settings (shared by the transcript panel, the timeline preview and auto-clean after transcription).
// Remembered per browser.
type Settings = { min: number; pad: number; fillers: boolean; silences: boolean; auto: boolean; preview: boolean; db: number };
const KEY = 'sonant.cleanup';
const DEFAULTS: Settings = { min: 0.6, pad: 0.15, fillers: true, silences: true, auto: false, preview: false, db: -35 };
function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
export const cleanup = $state<Settings>(load());
$effect.root(() => {
  $effect(() => {
    const s = JSON.stringify(cleanup);
    try { localStorage.setItem(KEY, s); } catch {}
  });
});

type Range = [number, number];
// What a clean-up would cut right now: fillers and silences that are still in the video.
export function cleanupRanges(words: Word[], duration: number, segments: Segment[]): { fillers: Range[]; silences: Range[] } {
  const fillers = cleanup.fillers ? words.flatMap((w) => (isFiller(w) && !isCut(segments, w) ? [[w.start, w.end] as Range] : [])) : [];
  const silences = cleanup.silences
    ? silenceRanges(words, duration, cleanup.min, cleanup.pad).filter(([a, b]) => b - a > 0.05 && !isCut(segments, { start: a, end: b }))
    : [];
  return { fillers, silences };
}
export const total = (r: Range[]) => r.reduce((a, [x, y]) => a + y - x, 0);
