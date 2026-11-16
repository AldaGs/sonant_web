import { DUCK_LEVEL, itemLen, type AudioItem } from './project';
import { envelopeAt, hasEnvelope } from './layertrans';
import { rateAt } from './cuts';
import { fileAt, segOf, timelineEnd } from './model';
import type { Overlay } from './overlay';
import { duckGain } from './audio';
import { setVolume, unlockAudio } from './mediavol.ts';

export type PlayerState = {
  overlays: Overlay[]; // every video track; output time
  audios: AudioItem[]; // every audio track (muted tracks come with volume 0)
  durations: Map<string, number>;
  clipVolume: number; // extra volume for the sound of videos (linked audio items)
  speech: [number, number][]; // output time, for ducking
  videoUrl: (assetId: string) => string | undefined; // what <video> plays (a proxy when there is one)
  audioUrl: (assetId: string, linked: boolean) => string | undefined; // what <audio> plays (noise-reduced copy when there is one)
};

type Slot = { el: HTMLMediaElement; key: string; url: string; item: string | null; hold?: HTMLCanvasElement; held?: boolean };
type Need = { id: string; key: string; url: string; file: number; active: boolean; rate: number; vol: number; frozen: boolean; video: boolean };

const PRE = 0.6; // seconds ahead an upcoming item gets its element ready (seeked to its first frame)
const KEEP = 3; // spare elements kept per file

// One clock in output time drives every track. Media elements are pooled per file: an item borrows one while
// it plays (or is about to), so a talk cut into hundreds of pieces still uses a couple of elements. Where one
// piece carries straight on from the previous one in the file, it keeps the same element (no seek, no gap).
// The sound is the clock while it plays (keeps lips in sync); pictures follow it, nudging their speed to
// catch up and seeking only when far off. Without sound, wall time is the clock.
export class Player {
  host: HTMLElement | null = null; // hidden box the elements live in (some browsers only decode attached video)
  o = 0; // output time
  playing = false;
  private last = 0;
  private slots: Slot[] = [];
  private bound = new Map<string, Slot>(); // item id → its element
  private pending = new Map<HTMLMediaElement, number>();

  constructor(private state: () => PlayerState) {}

  get end() {
    const s = this.state();
    return timelineEnd(s, (id) => s.durations.get(id) ?? 0);
  }

  // While an element is still seeking, newer targets wait so a fast scrub doesn't queue dozens of seeks.
  private seekTo(el: HTMLMediaElement, t: number) {
    if (el.seeking) {
      if (!this.pending.has(el))
        el.addEventListener('seeked', () => {
          const x = this.pending.get(el);
          this.pending.delete(el);
          if (x !== undefined && Math.abs(el.currentTime - x) > 0.01) this.seekTo(el, x);
        }, { once: true });
      this.pending.set(el, t);
      return;
    }
    el.currentTime = Math.max(0, t);
  }

  play() {
    if (this.end <= 0) return;
    unlockAudio();
    if (this.o >= this.end - 1e-3) this.o = 0; // at the end: restart
    this.playing = true;
    this.last = performance.now();
    this.sync(true);
  }
  pause() {
    this.playing = false;
    this.sync(true);
  }
  seek(o: number) {
    this.o = Math.max(0, Math.min(o, this.end));
    this.sync(true);
  }

  // Advance the clock; call every frame. Returns output time.
  tick(): number {
    const now = performance.now();
    if (this.playing) {
      const wall = this.o + (now - this.last) / 1000;
      const m = this.masterTime();
      this.o = m !== null && Math.abs(m - wall) < 0.15 ? m : wall;
      const end = this.end;
      if (this.o >= end) ((this.playing = false), (this.o = end));
    }
    this.last = now;
    this.sync();
    return this.o;
  }

  // Output time according to the sound that is playing on the lowest audio track (null when there is none).
  private masterTime(): number | null {
    const s = this.state();
    let best: AudioItem | null = null;
    for (const a of s.audios) {
      if (a.fx?.speedEnd !== undefined || a.fx?.hold || a.fx?.rev || !(this.o >= a.at && this.o < a.at + (a.len ?? Infinity))) continue;
      const slot = this.bound.get(a.id);
      if (!slot || slot.el.paused || slot.el.seeking || slot.el.readyState < 3) continue;
      if (!best || (a.track ?? 0) < (best.track ?? 0)) best = a;
    }
    if (!best) return null;
    const el = this.bound.get(best.id)!.el;
    return best.at + (el.currentTime - (best.offset ?? 0)) / (best.fx?.speed ?? 1);
  }

  /** The video element showing item `id` right now, if it has a frame (a held copy while it seeks). */
  frame(id: string): { src: CanvasImageSource; w: number; h: number } | null {
    const slot = this.bound.get(id);
    if (!slot || !(slot.el instanceof HTMLVideoElement)) return null;
    const v = slot.el;
    if (v.readyState >= 2 && v.videoWidth && !v.seeking) {
      // Keep a small copy of the last good frame, shown while the element seeks instead of black.
      const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight)), w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
      slot.hold ??= document.createElement('canvas');
      if (slot.hold.width !== w || slot.hold.height !== h) ((slot.hold.width = w), (slot.hold.height = h));
      slot.hold.getContext('2d')!.drawImage(v, 0, 0, w, h);
      slot.held = true;
      return { src: v, w: v.videoWidth, h: v.videoHeight };
    }
    return slot.held && slot.hold ? { src: slot.hold, w: slot.hold.width, h: slot.hold.height } : null;
  }

  // What every item on the timeline needs from its element right now.
  private needs(): Need[] {
    const s = this.state(), o = this.o, out: Need[] = [];
    const want = (id: string, at: number, len: number) => {
      const into = o - at;
      if (into >= 0 && into < len) return 'active';
      if (this.playing && into < 0 && -into <= PRE) return 'pre';
      return null;
    };
    for (const v of s.overlays) {
      if (v.kind !== 'video' || !v.assetId) continue;
      const w = want(v.id, v.at, v.len);
      if (!w) continue;
      const src = v.fx?.rev ? v.fx.rev.assetId : v.assetId, url = s.videoUrl(src);
      if (!url) continue;
      const f = fileAt(v, Math.max(o, v.at)) - (v.fx?.rev ? v.fx.rev.start : 0);
      out.push({ id: v.id, key: 'v:' + src, url, file: f, active: w === 'active', rate: v.fx?.hold ? 1 : rateAt(segOf(v), fileAt(v, o)), vol: 0, frozen: !!v.fx?.hold, video: true });
    }
    for (const a of s.audios) {
      const len = itemLen(a, s.durations.get(a.assetId) ?? 0), w = want(a.id, a.at, len);
      if (!w || a.fx?.hold) continue;
      const src = a.fx?.rev ? a.fx.rev.assetId : a.assetId, url = s.audioUrl(src, !!a.link);
      if (!url) continue;
      const m = { ...a, len }, into = o - a.at;
      const duck = a.duck ? duckGain(s.speech, o, DUCK_LEVEL) : 1;
      const env = hasEnvelope(a) ? envelopeAt(a, into, len) : 1;
      out.push({ id: a.id, key: 'a:' + src, url, file: fileAt(m, Math.max(o, a.at)) - (a.fx?.rev ? a.fx.rev.start : 0), active: w === 'active',
        rate: rateAt(segOf(m), fileAt(m, o)), vol: a.volume * (a.link ? s.clipVolume : 1) * duck * env, frozen: false, video: false });
    }
    return out;
  }

  private make(key: string, url: string): Slot {
    const el = document.createElement(key[0] === 'v' ? 'video' : 'audio');
    el.preload = 'auto';
    el.src = url;
    if (el instanceof HTMLVideoElement) ((el.muted = true), (el.playsInline = true));
    el.hidden = true;
    this.host?.append(el);
    const slot: Slot = { el, key, url, item: null };
    this.slots.push(slot);
    return slot;
  }

  // Lend elements to the items that need them and put each one where the clock says.
  private sync(exact = false) {
    const needs = this.needs().sort((a, b) => Number(b.active) - Number(a.active)); // playing items choose first
    const wanted = new Set(needs.map((n) => n.id));
    // Free elements whose item no longer needs them (or now needs another file).
    for (const [id, slot] of this.bound) {
      const n = needs.find((x) => x.id === id);
      if (!n || n.key !== slot.key || n.url !== slot.url) (this.bound.delete(id), (slot.item = null));
    }
    for (const n of needs) {
      let slot = this.bound.get(n.id);
      // An item that just started on a pre-rolled (paused) element moves to a free one already playing at
      // its file time: that's the previous piece of the same take, carrying straight on.
      if (slot && n.active && this.playing && slot.el.paused) {
        const go = this.slots.find((x) => x.item === null && x.key === n.key && x.url === n.url && !x.el.paused && Math.abs(x.el.currentTime - n.file) < 0.12);
        if (go) ((slot.item = null), (slot = undefined), this.bound.delete(n.id), this.bind(go, n.id));
      }
      if (!slot) {
        const free = this.slots.filter((x) => x.item === null && x.key === n.key && x.url === n.url && !(x.item && wanted.has(x.item)));
        free.sort((p, q) => Math.abs(p.el.currentTime - n.file) - Math.abs(q.el.currentTime - n.file));
        slot = this.bind(free[0] ?? this.make(n.key, n.url), n.id);
      }
      this.place(slot.el, n, exact);
    }
    // Idle elements stop; extra ones per file go.
    const spare = new Map<string, number>();
    this.slots = this.slots.filter((x) => {
      if (x.item !== null) return true;
      if (!x.el.paused) x.el.pause();
      const k = (spare.get(x.key) ?? 0) + 1;
      spare.set(x.key, k);
      if (k <= KEEP) return true;
      x.el.pause();
      x.el.removeAttribute('src');
      x.el.remove();
      return false;
    });
  }
  private bind(slot: Slot, id: string) {
    slot.item = id;
    this.bound.set(id, slot);
    return slot;
  }

  private place(el: HTMLMediaElement, n: Need, exact: boolean) {
    if (!n.video) setVolume(el, n.vol);
    const run = this.playing && n.active && !n.frozen;
    const target = this.pending.get(el) ?? el.currentTime;
    const drift = n.file - target;
    if (run) {
      if (Math.abs(drift) > 0.3) this.seekTo(el, n.file);
      // Small drift: catch up by playing up to 5% faster or slower instead of seeking (no visible jump).
      const rate = n.rate * (Math.abs(drift) > 0.03 ? 1 + Math.max(-0.05, Math.min(0.05, drift * 0.5)) : 1);
      if (Math.abs(el.playbackRate - rate) > 1e-3) el.playbackRate = rate;
      if (el.paused) el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (el.playbackRate !== n.rate && n.rate > 0) el.playbackRate = n.rate;
      if (Math.abs(drift) > (exact || !n.active ? 0.01 : 0.04)) this.seekTo(el, n.file);
    }
  }
}
