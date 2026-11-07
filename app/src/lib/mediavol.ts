// Volume for <video>/<audio> elements that also works on iPhone/iPad, where `el.volume` is read-only
// (always 1): there the element's sound goes through a Web Audio gain node instead.
let fixed: boolean | null = null;
const volumeIgnored = () => {
  if (fixed === null) {
    try {
      const a = document.createElement('audio');
      a.volume = 0.5;
      fixed = a.volume !== 0.5;
    } catch { fixed = false; }
  }
  return fixed;
};

let ctx: AudioContext | null = null;
const gains = new WeakMap<HTMLMediaElement, GainNode>();

// Call from a user gesture (play): iOS only starts Web Audio then. 'playback' also keeps sound on
// with the ring/silent switch off, as plain <video> sound does.
export function unlockAudio() {
  if (!volumeIgnored()) return;
  try { (navigator as Navigator & { audioSession?: { type: string } }).audioSession!.type = 'playback'; } catch {}
  ctx ??= new AudioContext();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

export function setVolume(el: HTMLMediaElement, v: number) {
  v = Math.min(1, Math.max(0, v));
  if (!volumeIgnored()) {
    if (el.volume !== v) el.volume = v;
    return;
  }
  let g = gains.get(el);
  if (!g) {
    if (v === 1) return; // full volume needs no routing
    unlockAudio();
    try {
      g = ctx!.createGain();
      ctx!.createMediaElementSource(el).connect(g).connect(ctx!.destination);
      gains.set(el, g);
    } catch { return; }
  }
  if (g.gain.value !== v) g.gain.value = v;
}
