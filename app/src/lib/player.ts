import { DUCK_LEVEL, clipAt, clipLen, clipStarts, itemLen, type AudioItem, type Clip } from './project';
import { nextKept, toOutput, toSource, outDuration, segAt, type Segment } from './cuts';
import type { Overlay } from './overlay';
import { duckGain } from './audio';

export type PlayerState = {
  clips: Clip[];
  audios: AudioItem[];
  segments: Segment[];
  durations: Map<string, number>;
  clipVolume: number;
  overlays: Overlay[];
  speech: [number, number][]; // output time, for ducking
};

// One clock in sequence time that drives a <video> per video asset and an <audio> per audio item.
// While a clip's video is playing it is the clock (keeps lips in sync); otherwise wall time is.
export class Player {
  videos = new Map<string, HTMLVideoElement>(); // assetId → element
  audios = new Map<string, HTMLAudioElement>(); // audio item id → element
  overlays = new Map<string, HTMLVideoElement>(); // video overlay id → element
  clean = new Map<string, HTMLAudioElement>(); // assetId → noise-reduced copy of its sound, played instead of the video's
  t = 0; // sequence (source) time: what's on screen
  o = 0; // output time: the master clock while a freeze frame holds (t stands still then)
  playing = false;
  private last = 0;
  // While a <video> is still seeking, newer targets wait here so a fast scrub doesn't queue
  // dozens of seeks; only the latest one runs once the current seek lands.
  private pending = new Map<HTMLVideoElement, number>();

  private seekTo(el: HTMLVideoElement, local: number) {
    if (el.seeking) {
      if (!this.pending.has(el))
        el.addEventListener('seeked', () => {
          const t = this.pending.get(el);
          this.pending.delete(el);
          if (t !== undefined && Math.abs(el.currentTime - t) > 0.01) this.seekTo(el, t);
        }, { once: true });
      this.pending.set(el, local);
      return;
    }
    el.currentTime = local;
  }

  constructor(private state: () => PlayerState) {}

  play() {
    const s = this.state();
    if (!s.clips.length) return;
    if (nextKept(s.segments, this.t) === null || this.o >= outDuration(s.segments) - 1e-3) this.seek(s.segments[0]?.start ?? 0); // at the end: restart
    this.playing = true;
    this.last = performance.now();
    this.sync();
  }

  pause() {
    this.playing = false;
    this.sync();
  }

  seek(t: number) {
    const s = this.state();
    this.t = Math.max(0, t);
    const k = nextKept(s.segments, this.t);
    this.o = toOutput(s.segments, k ?? this.t) ?? outDuration(s.segments);
    this.sync(true);
  }

  // Advance the clock; call every frame (and on media timeupdate). Returns sequence time.
  tick(): number {
    const s = this.state();
    const now = performance.now();
    if (this.playing && s.clips.length) {
      const segs = s.segments, dt = (now - this.last) / 1000, total = outDuration(segs);
      const starts = clipStarts(s.clips, s.durations);
      const at = clipAt(s.clips, s.durations, this.t);
      const seg = segAt(segs, this.t), rev = seg?.fx?.rev;
      // A reversed strip plays its reversed copy forwards: copy time 0 = the strip's start.
      const el = rev ? this.videos.get(rev.assetId) : at && this.videos.get(s.clips[at.index].assetId);
      const hold = !!seg?.fx?.hold;
      if (!hold && at && el && !el.paused && !el.seeking && el.readyState >= 2) {
        // The playing video is the clock (keeps lips in sync; its playbackRate carries the strip's speed).
        const base = rev ? rev.start : starts[at.index];
        this.t = base + el.currentTime;
        const len = rev ? rev.end - rev.start : clipLen(s.durations, s.clips[at.index]);
        if (rev && this.t >= seg!.end - 0.02) this.t = seg!.end; // reversed strip done: next strip
        else if (el.currentTime >= len - 0.04 || el.ended) this.t = Math.max(this.t, base + len); // clip done: next one
        const k = nextKept(segs, this.t);
        if (k === null) this.o = total;
        else ((this.t = k), (this.o = toOutput(segs, k) ?? this.o));
      } else {
        // Wall clock in output time: freeze frames, or media not ready yet.
        this.o += dt;
        this.t = toSource(segs, Math.min(this.o, total - 1e-6));
      }
      if (this.o >= total - 1e-6) {
        this.playing = false;
        this.o = total;
        this.t = segs.at(-1)?.end ?? this.t;
      }
    }
    this.last = now;
    this.sync();
    return this.t;
  }

  // True when the clock is inside a video clip (vs. an empty sequence).
  clipsAt(): boolean {
    const s = this.state();
    return !!clipAt(s.clips, s.durations, this.t);
  }

  // The video element showing the current frame, if it has one.
  frame(): HTMLVideoElement | null {
    const s = this.state();
    const at = clipAt(s.clips, s.durations, this.t);
    const rev = segAt(s.segments, this.t)?.fx?.rev;
    const el = rev ? this.videos.get(rev.assetId) : at ? this.videos.get(s.clips[at.index].assetId) : undefined;
    return el && el.readyState >= 2 ? el : null;
  }

  // A video overlay's element, if it has a frame to show.
  overlayFrame(id: string): HTMLVideoElement | null {
    const el = this.overlays.get(id);
    return el && el.readyState >= 2 && el.videoWidth ? el : null;
  }

  // Put every element where the clock says it should be.
  private sync(exact = false) {
    const s = this.state();
    const at0 = clipAt(s.clips, s.durations, this.t);
    const rev = segAt(s.segments, this.t)?.fx?.rev;
    // In a reversed strip the reversed copy is the active video, at copy time t − rev.start.
    const at = at0 && rev ? { ...at0, local: this.t - rev.start } : at0;
    const activeId = rev && at0 ? rev.assetId : at0 ? s.clips[at0.index].assetId : null;
    for (const [id, el] of this.videos) {
      if (id !== activeId) {
        if (!el.paused) el.pause();
        continue;
      }
      const lifted = s.segments.some((g) => g.fx?.lift && this.t >= g.start && this.t < g.end); // a gap plays silent
      const vol = lifted ? 0 : Math.min(1, Math.max(0, s.clipVolume));
      const clean = this.clean.get(id);
      el.volume = vol;
      el.muted = !!clean; // the cleaned copy plays the sound instead
      const seg = segAt(s.segments, this.t);
      const rate = seg?.fx?.speed ?? 1;
      if (el.playbackRate !== rate) el.playbackRate = rate; // pitch is preserved by the browser
      const frozen = !!seg?.fx?.hold;
      const target = this.pending.get(el) ?? el.currentTime;
      const drift = Math.abs(target - at!.local);
      if (drift > (this.playing && !exact ? 0.3 : 0.01)) this.seekTo(el, at!.local);
      if (this.playing && !frozen && el.paused) el.play().catch(() => {});
      if ((!this.playing || frozen) && !el.paused) el.pause();
      if (clean) {
        // Follow the video (the clock): same rate, re-sync when it drifts more than ~2 frames.
        clean.volume = vol;
        if (clean.playbackRate !== rate) clean.playbackRate = rate;
        const run = this.playing && !frozen && !el.paused && !el.seeking;
        if (Math.abs(clean.currentTime - el.currentTime) > (run ? 0.08 : 0.01)) clean.currentTime = el.currentTime;
        if (run && clean.paused) clean.play().catch(() => {});
        if (!run && !clean.paused) clean.pause();
      }
    }
    for (const [id, c] of this.clean) if (id !== activeId && !c.paused) c.pause();
    for (const [id, el] of this.videos) if (id !== activeId && !this.clean.has(id)) el.muted = false;

    const out: number | null = toOutput(s.segments, this.t) === null ? null : this.o;
    // Video overlays run in output time, like audio items. Shown one frame early so they're ready.
    for (const o of s.overlays) {
      const el = this.overlays.get(o.id);
      if (!el || o.kind !== 'video') continue;
      const into = out === null ? -1 : out - o.at;
      const inside = into >= 0 && into < o.len;
      const local = Math.min(o.len, Math.max(0, into)) + (o.offset ?? 0);
      el.volume = Math.min(1, Math.max(0, o.volume ?? 0));
      el.muted = !o.volume;
      if (this.playing && inside) {
        if (Math.abs(el.currentTime - local) > 0.3) this.seekTo(el, local);
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (Math.abs((this.pending.get(el) ?? el.currentTime) - local) > 0.01 && (exact || !inside)) this.seekTo(el, local);
      }
    }
    for (const item of s.audios) {
      const el = this.audios.get(item.id);
      if (!el) continue;
      // Trimmed items play [offset, offset + len) of their file.
      const into = out === null ? -1 : out - item.at;
      const inside = into >= 0 && into < itemLen(item, s.durations.get(item.assetId) ?? 0);
      const local = into + (item.offset ?? 0);
      const duck = item.duck && out !== null ? duckGain(s.speech, out, DUCK_LEVEL) : 1;
      el.volume = Math.min(1, Math.max(0, item.volume * duck));
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
