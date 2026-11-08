// Long-running analysis and rendering jobs: auto-zoom aim, stabilize, reverse, voice effects, speakers,
// highlights/shorts, transcription, silence cuts, auto-reframe, translation and beat detection.
import { transcribe } from '../transcribe';
import { groupWords, captionText, split, replaceInRange } from '../captions';
import { splitAt, toSource, outDuration, isCut, keptCaptions, type Segment } from '../cuts';
import { itemLen, clipAt, clipLen, clipStarts, type Clip, type AudioItem } from '../project';
import { median } from '../reframe';
import { subjectCenter } from '../segment';
import { cleanup, cleanupRanges } from '../cleanup.svelte';
import { fileSilences } from '../silence';
import { beatsOfFile } from '../beats';
import { translateTexts } from '../translate';
import { embed, cluster, smooth, spanOf, applySpeakers, units, splitBySpeaker, type Unit } from '../diarize';
import { decodeAudio } from '../transcribe';
import { gpuFor } from '../perf';
import { decodeFileAudio } from '../audiodecode';
import { shiftOf, planStab, grey, STAB_FPS, STAB_W } from '../stabilize';
import { makeReversed } from '../reverse';
import { applyVoiceFx, type VoiceFx } from '../voicefx';
import { wav } from '../denoise';
import { findHighlights, shortOf, type Highlight } from '../highlights';
import { cleanAudio } from '../denoise';
import { importFile } from '../assets';
import { t } from '../i18n.svelte';
import { begin, end, logError } from '../crash';
import { createProject, saveDoc, type ProjectDoc } from '../projects';
import type { Ed } from './ed';

export function createJobs(ed: Ed) {
  async function aimZooms() {
    if (!ed.autoZoom) return;
    ed.aimBusy = true;
    const starts = clipStarts(ed.clips, ed.durations), aim: Record<string, [number, number]> = { ...ed.autoZoom.aim };
    const els = new Map<string, HTMLVideoElement>();
    try {
      for (const m of ed.zooms) {
        const at = clipAt(ed.clips, ed.durations, m.start + 0.2);
        if (!at || !m.key || ed.kindOf(ed.clips[at.index].assetId) !== 'video') continue;
        const id = ed.clips[at.index].assetId;
        let v = els.get(id);
        if (!v) {
          v = document.createElement('video');
          v.muted = true;
          v.src = ed.previewUrl(id);
          await new Promise((r, j) => ((v!.onloadeddata = r), (v!.onerror = j)));
          els.set(id, v);
        }
        v.currentTime = m.start + 0.2 - starts[at.index];
        await new Promise((r) => (v!.onseeked = r));
        const c = await subjectCenter(v, v.videoWidth, v.videoHeight).catch(() => null);
        // Aim a little above the body's centre: that's where the face is.
        if (c) aim[m.key] = [c.x, Math.max(0, c.y - 0.12)];
      }
      ed.autoZoom.aim = aim;
      if (!Object.keys(aim).length) ed.error = 'noPerson';
    } catch {
      ed.error = 'noPerson';
    } finally {
      for (const v of els.values()) v.removeAttribute('src');
      ed.aimBusy = false;
    }
  }
  async function stabilize(i: number) {
    const s = ed.segments[i];
    if (!s || s.fx?.hold) return;
    if (s.fx?.stab) return ed.setFx({ stab: undefined }); // toggle off
    const starts = clipStarts(ed.clips, ed.durations), at = clipAt(ed.clips, ed.durations, (s.start + s.end) / 2);
    if (!at || ed.kindOf(ed.clips[at.index].assetId) !== 'video') return;
    const off = starts[at.index];
    ed.stabPct = 0;
    ed.error = '';
    begin('stabilize', { secs: +(s.end - s.start).toFixed(1) }, ed.projectId);
    const v = document.createElement('video');
    v.muted = true;
    v.src = ed.previewUrl(ed.clips[at.index].assetId); // the proxy seeks much faster when there is one
    try {
      await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = j)));
      const w = STAB_W, h = Math.max(2, Math.round((STAB_W * v.videoHeight) / v.videoWidth / 2) * 2);
      const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
      const n = Math.max(2, Math.ceil((s.end - s.start) * STAB_FPS));
      const shifts: [number, number][] = [];
      let prev: Uint8Array | null = null;
      for (let k = 0; k < n; k++) {
        // A few ms past the sample time, so the seek lands inside a frame rather than on the boundary between two.
        v.currentTime = Math.min(s.end - 0.01, s.start + k / STAB_FPS + 0.008) - off;
        await new Promise((r) => (v.onseeked = r));
        const g = grey(c, v, w, h);
        if (prev) shifts.push(shiftOf(prev, g, w, h));
        prev = g;
        ed.stabPct = ((k + 1) / n) * 100;
      }
      const stab = planStab(shifts, w, h, STAB_FPS, s.start);
      ed.commit();
      ed.segments = ed.segments.with(i, { ...ed.segments[i], fx: { ...ed.segments[i].fx, stab } });
    } catch (e) {
      ed.error = 'err.stab';
      logError(e, 'stabilize');
    } finally {
      end();
      v.removeAttribute('src');
      ed.stabPct = null;
    }
  }
  async function reverseStrip(i: number) {
    const s = ed.segments[i];
    if (!s || s.fx?.hold) return;
    if (s.fx?.rev) return ed.setFx({ rev: undefined }); // toggle off (the copy stays in the library)
    const starts = clipStarts(ed.clips, ed.durations), at = clipAt(ed.clips, ed.durations, (s.start + s.end) / 2);
    const id = at && ed.clips[at.index].assetId, f = id && ed.files.get(id);
    if (!at || !f || ed.kindOf(id!) !== 'video') return;
    ed.revPct = 0;
    ed.error = '';
    begin('reverse', { secs: +(s.end - s.start).toFixed(1) }, ed.projectId);
    try {
      const blob = await makeReversed(f, s.start - starts[at.index], s.end - starts[at.index], (p) => (ed.revPct = p));
      const file = new File([blob], `${(ed.names.get(id!) ?? 'clip').replace(/\.[^.]+$/, '')} · ${t('reversed')}.mp4`, { type: 'video/mp4' });
      const r = await importFile(file);
      ed.assets = [...ed.assets, r.asset];
      ed.register(r.asset, file);
      ed.commit();
      ed.segments = ed.segments.with(i, { ...ed.segments[i], fx: { ...ed.segments[i].fx, rev: { assetId: r.asset.id, start: s.start, end: s.end } } });
    } catch (e) {
      ed.error = 'err.reverse';
      logError(e, 'reverse');
    } finally {
      end();
      ed.revPct = null;
    }
  }
  // Re-render a Music & VO item from its original file with noise reduction and/or a voice effect.
  async function renderItem(item: AudioItem, want: { vfx?: VoiceFx; dn?: number }) {
    const orig = item.src ?? item.assetId;
    if (!want.vfx && !want.dn) {
      if (item.src) (ed.commit(), ed.setAudio(item.id, { assetId: item.src, src: undefined, vfx: undefined, dn: undefined }));
      return;
    }
    const f = ed.files.get(orig);
    if (!f) return;
    ed.vfxBusy = true;
    ed.error = '';
    try {
      // Noise reduction first (RNNoise wants the raw recording), then the voice effect.
      const srcBlob: Blob = want.dn ? ((await cleanAudio(f, want.dn, () => {})) ?? f) : f;
      const buf = await decodeFileAudio(srcBlob); // Safari's decodeAudioData can't read most video files
      if (!buf) throw new Error('err.noAudio');
      await new Promise((r) => setTimeout(r)); // let the "working" state paint
      const out = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => (want.vfx ? applyVoiceFx(buf.getChannelData(c), buf.sampleRate, want.vfx) : buf.getChannelData(c)));
      const base = (ed.names.get(orig) ?? 'audio').replace(/\.[^.]+$/, '');
      const tag = [want.dn ? t('dnShort') : '', want.vfx ? t('vfx.' + want.vfx) : ''].filter(Boolean).join(' + ');
      const file = new File([wav(out, buf.sampleRate)], `${base} · ${tag}.wav`, { type: 'audio/wav' });
      const r = await importFile(file);
      ed.assets = [...ed.assets, r.asset];
      ed.register(r.asset, file);
      ed.commit();
      ed.setAudio(item.id, { assetId: r.asset.id, src: orig, vfx: want.vfx, dn: want.dn });
    } catch {
      ed.error = 'err.badMedia';
    } finally {
      ed.vfxBusy = false;
    }
  }
  const setVoiceFx = (item: AudioItem, fx: VoiceFx | '') => renderItem(item, { vfx: fx || undefined, dn: item.dn });
  async function detectSpeakers() {
    ed.spkBusy = true;
    ed.spkMsg = ed.error = '';
    begin('speakers', { captions: ed.captions.length }, ed.projectId);
    try {
      const starts = clipStarts(ed.clips, ed.durations), pcm = new Map<string, Float32Array | null>();
      const ids: string[] = [], pieces: Float32Array[] = [], spans: number[] = [], used: Unit[] = [];
      ed.spkStatus = 'st.reading';
      // Whole captions, or ~1.2s pieces of them when lines may be split at speaker changes.
      const list: Unit[] = ed.spkSplit ? units(ed.captions) : ed.captions.filter((c) => c.words.length).map((c) => ({ capId: c.id, from: 0, to: c.words.length, start: c.words[0].start, end: c.words[c.words.length - 1].end }));
      for (const u of list) {
        const c = { id: u.capId, words: [{ text: '', start: u.start, end: u.end }] };
        const [a, b] = spanOf(c), at = clipAt(ed.clips, ed.durations, (a + b) / 2);
        if (!at) continue;
        const id = ed.clips[at.index].assetId, f = ed.files.get(id);
        if (!f || ed.kindOf(id) !== 'video' && ed.kindOf(id) !== 'audio') continue;
        if (!pcm.has(id)) pcm.set(id, await decodeAudio(f).catch(() => null));
        const x = pcm.get(id);
        if (!x) continue;
        const off = starts[at.index], i0 = Math.max(0, Math.floor((a - off) * 16000)), i1 = Math.min(x.length, Math.ceil((b - off) * 16000));
        if (i1 - i0 < 4000) continue; // under 0.25s of audio
        ids.push(u.capId);
        used.push(u);
        pieces.push(x.slice(i0, i1));
        spans.push(u.end - u.start);
      }
      if (ids.length < 2) return void (ed.spkMsg = 'spkTooFew');
      const emb = await embed(pieces, gpuFor.whisper(), (s, p) => ((ed.spkStatus = s), (ed.spkPct = p)));
      const labels = smooth(cluster(emb, { k: ed.spkCount || undefined, weights: spans.map((s) => Math.min(4, Math.max(0.5, s))) }), spans);
      const r = applySpeakers(ed.captions, [], labels, ed.speakers); // speaker list sized to the groups, names kept
      ed.setCaps(splitBySpeaker(ed.captions, used, labels, () => crypto.randomUUID()));
      ed.speakers = r.speakers;
      ed.spkMsg = 'spkFound';
      ed.spkPct = Math.max(...labels) + 1;
    } catch (e) {
      const m = (e as Error)?.message ?? '';
      ed.error = m.startsWith('err.') ? m : 'err.speakers';
      logError(e, 'speakers');
    } finally {
      end();
      ed.spkBusy = false;
      ed.spkStatus = '';
    }
  } // highlight start → new project id
  // Loudness from the waveform peaks (sequence time): mean peak over the range, or null without audio.
  function loudness(a: number, b: number): number | null {
    const at = clipAt(ed.clips, ed.durations, (a + b) / 2);
    if (!at) return null;
    const id = ed.clips[at.index].assetId, pk = ed.peaks[id], dur = ed.durations.get(id);
    if (!pk || !dur) return null;
    const off = clipStarts(ed.clips, ed.durations)[at.index];
    const i0 = Math.max(0, Math.floor(((a - off) / dur) * pk.length)), i1 = Math.min(pk.length, Math.ceil(((b - off) / dur) * pk.length));
    let s = 0;
    for (let i = i0; i < i1; i++) s += pk[i];
    return i1 > i0 ? s / (i1 - i0) : null;
  }
  const findClips = () => ((ed.highlights = findHighlights(keptCaptions(ed.captions, ed.segments), $state.snapshot(ed.hlOpts), loudness)), (ed.shortsMade = {}));
  const setHlLen = (min: number, max: number) => ((ed.hlOpts.min = min), (ed.hlOpts.max = max), findClips());
  async function makeAllShorts() {
    for (const [i, h] of (ed.highlights ?? []).entries()) if (!ed.shortsMade[h.start]) { ed.hlBusy = t('hlMaking', { n: i + 1 }); await makeShort(h, i + 1); }
    ed.hlBusy = '';
  }
  function previewClip(h: Highlight) {
    ed.seek(h.start);
    if (!ed.player.playing) ed.toggle();
  }
  async function makeShort(h: Highlight, n: number) {
    const durOf = (id: string) => ed.durations.get(id) ?? 0;
    const cut = shortOf($state.snapshot({ segments: ed.segments, overlays: ed.overlays, audios: ed.audios, captions: ed.captions }), h.start, h.end, (x) => itemLen(x, durOf(x.assetId)));
    if (ed.hlReframe) {
      // Find the person in each strip of the short (the segmenter downloads once), so 9:16 keeps them in frame.
      ed.hlBusy = t('hlReframing');
      for (const [k, sg] of cut.segments.entries()) {
        const f = await focusOfSeg(sg).catch(() => null);
        if (f) cut.segments[k] = { ...sg, fx: { ...sg.fx, focus: f } };
      }
      ed.hlBusy = '';
    }
    const title = `${ed.name || t('untitled')} · ${t('short')} ${n}`;
    const doc: ProjectDoc = {
      ...$state.snapshot({ style: ed.style, language: ed.language, speakers: ed.speakers, assets: ed.assets, clips: ed.clips, clipVolume: ed.clipVolume, showTr: ed.showTr, autoZoom: ed.autoZoom, denoise: ed.denoise }),
      ...cut, name: title, luts: ed.luts.map((l) => ({ id: l.id, name: l.name })), aspect: '9:16', words: ed.wordCache,
    };
    const meta = await createProject(title);
    await saveDoc(meta.id, doc, { duration: h.end - h.start, clips: ed.clips.length });
    ed.shortsMade = { ...ed.shortsMade, [h.start]: meta.id };
  }
  async function run() {
    if (!ed.hasMedia) return;
    ed.busy = true;
    ed.error = ed.notice = '';
    const lang = ed.language ?? 'auto';
    const chosen = ed.targetClip ? [ed.targetClip] : ed.clips;
    begin('transcribe', { clips: chosen.length, language: lang }, ed.projectId);
    try {
      const ids = [...new Set(chosen.map((c) => c.assetId))].filter((id) => ed.kindOf(id) !== 'image'); // stills have no sound
      for (let k = 0; k < ids.length; k++) {
        const key = `${ids[k]}|${lang}`, f = ed.files.get(ids[k]);
        if (ed.wordCache[key] || !f) continue;
        try {
          ed.wordCache[key] = await transcribe(f, ed.language, (st, p) => ((ed.status = st), (ed.pct = ((k + p / 100) / ids.length) * 100)));
        } catch (e) {
          if ((e as Error).message !== 'err.noAudio') throw e;
          ed.wordCache[key] = []; // a silent clip just has no words
        }
      }
      const starts = clipStarts(ed.clips, ed.durations);
      // Whisper can hallucinate timestamps past the end of short or silent clips; keep words inside their clip.
      const wordsOf = (c: Clip) => {
        const i = ed.clips.indexOf(c), len = clipLen(ed.durations, c);
        return (ed.wordCache[`${c.assetId}|${lang}`] ?? [])
          .filter((w) => w.start < len)
          .map((w) => ({ ...w, start: w.start + starts[i], end: Math.min(w.end, len) + starts[i] }));
      };
      const fresh = groupWords(chosen.flatMap(wordsOf));
      if (ed.targetClip) {
        const i = ed.clips.indexOf(ed.targetClip);
        ed.setCaps(replaceInRange(ed.captions, fresh, starts[i], starts[i] + clipLen(ed.durations, ed.targetClip)));
        if (!fresh.length) ed.error = 'noSpeech';
      } else {
        ed.setCaps(fresh);
        if (!ed.captions.length) ed.error = 'noSpeech';
      }
      // Auto clean-up: cut fillers and long pauses straight away (one more undo step, so it can be undone alone).
      if (cleanup.auto && ed.captions.length) {
        const r = cleanupRanges(ed.captions.flatMap((c) => c.words), ed.duration, ed.segments);
        if (r.fillers.length || r.silences.length) ed.cutRanges([...r.fillers, ...r.silences]);
      }
    } catch (e) {
      ed.error = (e as Error).message;
      logError(e, 'transcribe');
    } finally {
      end();
      ed.busy = false;
    }
  }
  async function cutAudioSilences() {
    if (!ed.hasMedia || ed.silBusy) return;
    ed.silBusy = true;
    ed.error = ed.notice = '';
    try {
      const starts = clipStarts(ed.clips, ed.durations), byAsset = new Map<string, [number, number][]>();
      const ranges: [number, number][] = [];
      for (let i = 0; i < ed.clips.length; i++) {
        const id = ed.clips[i].assetId, f = ed.files.get(id), len = clipLen(ed.durations, ed.clips[i]);
        if (!f || ed.kindOf(id) === 'image') continue;
        if (!byAsset.has(id)) byAsset.set(id, await fileSilences(f, cleanup.db, cleanup.min, cleanup.pad).catch(() => []));
        for (const [a, b] of byAsset.get(id)!) if (a < len) ranges.push([starts[i] + a, starts[i] + Math.min(b, len)]);
      }
      const fresh = ranges.filter(([a, b]) => !isCut(ed.segments, { start: a, end: b }));
      if (fresh.length) ed.cutRanges(fresh);
      else ed.error = 'noSilence';
    } finally {
      ed.silBusy = false;
    }
  }
  const focusOf = (i: number) => focusOfSeg(ed.segments[i]);
  async function focusOfSeg(s: Segment): Promise<{ x: number; y: number } | null> {
    const starts = clipStarts(ed.clips, ed.durations);
    const ci = ed.clips.findIndex((_, k) => s.start >= starts[k] - 1e-6 && s.start < starts[k] + clipLen(ed.durations, ed.clips[k]));
    if (ci < 0) return null;
    const v = document.createElement('video');
    v.muted = true;
    v.src = ed.urls[ed.clips[ci].assetId];
    await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = j)));
    const xs: number[] = [], ys: number[] = [];
    for (let k = 0; k < 5; k++) {
      v.currentTime = s.start - starts[ci] + ((k + 0.5) / 5) * (s.end - s.start);
      await new Promise((r) => (v.onseeked = r));
      const c = await subjectCenter(v, v.videoWidth, v.videoHeight).catch(() => null);
      if (c) (xs.push(c.x), ys.push(c.y));
    }
    v.removeAttribute('src');
    return xs.length ? { x: median(xs), y: median(ys) } : null;
  }
  async function autoReframe(i: number) {
    ed.reframing = true;
    ed.error = '';
    try {
      const f = await focusOf(i);
      if (!f) return void (ed.error = 'noPerson');
      ed.commit();
      ed.segments = ed.segments.with(i, { ...ed.segments[i], fx: { ...ed.segments[i].fx, focus: f } });
    } catch {
      ed.error = 'noPerson';
    } finally {
      ed.reframing = false;
    }
  }
  async function autoReframeAll() {
    ed.reframing = true;
    try {
      const fs: ({ x: number; y: number } | null)[] = [];
      for (let i = 0; i < ed.segments.length; i++) fs.push(await focusOf(i).catch(() => null));
      ed.commit();
      ed.segments = ed.segments.map((s, i) => (fs[i] ? { ...s, fx: { ...s.fx, focus: fs[i]! } } : s));
    } finally {
      ed.reframing = false;
    }
  }
  function colorToAll() {
    ed.commit();
    const color = $state.snapshot(ed.selColor);
    ed.segments = ed.segments.map((s) => ({ ...s, fx: { ...s.fx, color } }));
  }
  async function translateAll() {
    if (!ed.captions.length) return;
    ed.trBusy = true;
    ed.error = '';
    try {
      const texts = await translateTexts(ed.captions.map(captionText), ed.trDir, (st, p) => ((ed.status = st), (ed.pct = p)));
      const byId = new Map(ed.captions.map((c, i) => [c.id, texts[i]]));
      ed.setCaps(ed.captions.map((c) => ({ ...c, tr: byId.get(c.id) || undefined })));
      ed.showTr = true;
    } catch (e) {
      ed.error = (e as Error).message || 'err.translate';
    } finally {
      ed.trBusy = false;
      ed.status = '';
    }
  }
  async function detectBeatsFor(assetId: string) {
    const f = ed.files.get(assetId);
    if (!f) return;
    ed.beatBusy = true;
    try {
      const r = await beatsOfFile(f);
      ed.assets = ed.assets.map((a) => (a.id === assetId ? { ...a, beats: r.times, bpm: r.bpm } : a));
      if (!r.times.length) ed.error = 'noBeats';
    } catch {
      ed.error = 'noBeats';
    } finally {
      ed.beatBusy = false;
    }
  }
  // Split the main video on every beat of the selected music (every `every`-th beat).
  function cutOnBeats(item: AudioItem, every = 1) {
    const a = ed.assets.find((x) => x.id === item.assetId);
    if (!a?.beats) return;
    const off = item.offset ?? 0, len = itemLen(item, a.duration), end = outDuration(ed.segments);
    const outs = a.beats.filter((_, i) => i % every === 0).map((b) => item.at + b - off).filter((t) => t > item.at && t < Math.min(item.at + len, end));
    ed.setSegs(outs.reduce((s, o) => splitAt(s, toSource(s, o)), ed.segments));
  }

  return { aimZooms, stabilize, reverseStrip, renderItem, setVoiceFx, detectSpeakers, findClips, setHlLen, makeAllShorts, previewClip, makeShort, run, cutAudioSilences, autoReframe, autoReframeAll, colorToAll, translateAll, detectBeatsFor, cutOnBeats };
}
