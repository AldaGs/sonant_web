import { clipAt, clipStarts, itemLen, type AudioItem, type Clip } from './project';
import { nextKept, toOutput, type Segment } from './cuts';

export type PlayerState = {
  clips: Clip[];
  audios: AudioItem[];
  segments: Segment[];
  durations: Map<string, number>;
  clipVolume: number;
};

// One clock in sequence time that drives a <video> per video asset and an <audio> per audio item.
// While a clip's video is playing it is the clock (keeps lips in sync); otherwise wall time is.
export class Player {
  videos = new Map<string, HTMLVideoElement>(); // assetId → element
  audios = new Map<string, HTMLAudioElement>(); // audio item id → element
  t = 0;
  playing = false;
  private last = 0;

  constructor(private state: () => PlayerState) {}

  play() {
    const s = this.state();
    if (!s.clips.length) return;
    if (nextKept(s.segments, this.t) === null) this.t = s.segments[0]?.start ?? 0; // at the end: restart
    this.playing = true;
    this.last = performance.now();
    this.sync();
  }

  pause() {
    this.playing = false;
    this.sync();
  }

  seek(t: number) {
    this.t = Math.max(0, t);
    this.sync(true);
  }

  // Advance the clock; call every frame (and on media timeupdate). Returns sequence time.
  tick(): number {
    const s = this.state();
    const now = performance.now();
    if (this.playing && s.clips.length) {
      const starts = clipStarts(s.clips, s.durations);
      const at = clipAt(s.clips, s.durations, this.t);
      const el = at && this.videos.get(s.clips[at.index].assetId);
      if (at && el && !el.paused && !el.seeking && el.readyState >= 2) this.t = starts[at.index] + el.currentTime;
      else this.t += (now - this.last) / 1000;

      // Clip finished: continue with the next one.
      if (at) {
        const len = s.durations.get(s.clips[at.index].assetId) ?? 0;
        if (at.local >= len - 0.04 || el?.ended) this.t = Math.max(this.t, starts[at.index] + len);
      }
      const k = nextKept(s.segments, this.t);
      if (k === null) {
        this.playing = false;
        this.t = s.segments.at(-1)?.end ?? this.t;
      } else this.t = k;
    }
    this.last = now;
    this.sync();
    return this.t;
  }

  // The video element showing the current frame, if it has one.
  frame(): HTMLVideoElement | null {
    const s = this.state();
    const at = clipAt(s.clips, s.durations, this.t);
    const el = at ? this.videos.get(s.clips[at.index].assetId) : undefined;
    return el && el.readyState >= 2 ? el : null;
  }

  // Put every element where the clock says it should be.
  private sync(exact = false) {
    const s = this.state();
    const at = clipAt(s.clips, s.durations, this.t);
    const activeId = at ? s.clips[at.index].assetId : null;
    for (const [id, el] of this.videos) {
      if (id !== activeId) {
        if (!el.paused) el.pause();
        continue;
      }
      el.volume = Math.min(1, Math.max(0, s.clipVolume));
      const drift = Math.abs(el.currentTime - at!.local);
      if (drift > (this.playing && !exact ? 0.3 : 0.01)) el.currentTime = at!.local;
      if (this.playing && el.paused) el.play().catch(() => {});
      if (!this.playing && !el.paused) el.pause();
    }

    const out = toOutput(s.segments, this.t);
    for (const item of s.audios) {
      const el = this.audios.get(item.id);
      if (!el) continue;
      // Trimmed items play [offset, offset + len) of their file.
      const into = out === null ? -1 : out - item.at;
      const inside = into >= 0 && into < itemLen(item, s.durations.get(item.assetId) ?? 0);
      const local = into + (item.offset ?? 0);
      el.volume = Math.min(1, Math.max(0, item.volume));
      if (this.playing && inside) {
        if (Math.abs(el.currentTime - local) > 0.3) el.currentTime = local;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (inside && exact) el.currentTime = local;
      }
    }
  }
}
