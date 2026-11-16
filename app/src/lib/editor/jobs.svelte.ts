// Long-running analysis and rendering jobs: auto-zoom aim, stabilize, reverse, voice effects, speakers,
// highlights/shorts, transcription, silence cuts, auto-reframe, translation and beat detection.
import { transcribe } from '../transcribe';
import { groupWords, captionText, replaceInRange, type Word } from '../captions';
import { itemLen, type AudioItem } from '../project';
import { assetAtSrc, captionsOut, keptCaps, fileAt, srcLen, srcToOut, isCutW } from '../model';
import { trackOf } from '../tracks';
import type { Overlay } from '../overlay';
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
import { DOC_VERSION } from '../migrate';
import type { Ed } from './ed';

export function createJobs(ed: Ed) {
  // The video showing at output time t: the lowest one on a visible track.
  const videoAt = (t: number) => ed.shownOverlays.filter((o) => o.kind === 'video' && !o.fx?.hold && t >= o.at && t < o.at + o.len)
    .sort((a, b) => trackOf(a) - trackOf(b))[0] ?? null;
  const item = (id: string) => ed.overlays.find((o) => o.id === id && o.kind === 'video');
  async function aimZooms() {
    if (!ed.autoZoom) return;
    ed.aimBusy = true;
    const aim: Record<string, [number, number]> = { ...ed.autoZoom.aim };
    const els = new Map<string, HTMLVideoElement>();
    try {
      for (const m of ed.zooms) {
        const o = videoAt(m.start + 0.2);
        if (!o || !m.key) continue;
        const id = o.assetId!;
        let v = els.get(id);
        if (!v) {
          v = document.createElement('video');
          v.muted = true;
          v.src = ed.previewUrl(id);
          await new Promise((r, j) => ((v!.onloadeddata = r), (v!.onerror = j)));
          els.set(id, v);
        }
        v.currentTime = fileAt(o, m.start + 0.2);
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
  // Stabilize a video item: measure the camera's shake over the part of the file it plays (file time).
  async function stabilize(id: string) {
    const o = item(id);
    if (!o || o.fx?.hold) return;
    if (o.fx?.stab) return void ed.setFx({ stab: undefined }); // toggle off
    const a = o.offset ?? 0, b = a + srcLen(o);
    ed.stabPct = 0;
    ed.error = '';
    begin('stabilize', { secs: +(b - a).toFixed(1) }, ed.projectId);
    const v = document.createElement('video');
    v.muted = true;
    v.src = ed.previewUrl(o.assetId!); // the proxy seeks much faster when there is one
    try {
      await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = j)));
      const w = STAB_W, h = Math.max(2, Math.round((STAB_W * v.videoHeight) / v.videoWidth / 2) * 2);
      const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
      const n = Math.max(2, Math.ceil((b - a) * STAB_FPS));
      const shifts: [number, number][] = [];
      let prev: Uint8Array | null = null;
      for (let k = 0; k < n; k++) {
        // A few ms past the sample time, so the seek lands inside a frame rather than on the boundary between two.
        v.currentTime = Math.min(b - 0.01, a + k / STAB_FPS + 0.008);
        await new Promise((r) => (v.onseeked = r));
        const g = grey(c, v, w, h);
        if (prev) shifts.push(shiftOf(prev, g, w, h));
        prev = g;
        ed.stabPct = ((k + 1) / n) * 100;
      }
      const stab = planStab(shifts, w, h, STAB_FPS, a);
      ed.commit();
      ed.overlays = ed.overlays.map((x) => (x.id === id ? { ...x, fx: { ...x.fx, stab } } : x));
    } catch (e) {
      ed.error = 'err.stab';
      logError(e, 'stabilize');
    } finally {
      end();
      v.removeAttribute('src');
      ed.stabPct = null;
    }
  }
  // Reverse a video item: a reversed copy of the part of the file it plays is made once and played instead
  // (its linked sound plays the copy too).
  async function reverseStrip(id: string) {
    const o = item(id);
    if (!o || o.fx?.hold) return;
    if (o.fx?.rev) return void ed.setFx({ rev: undefined }); // toggle off (the copy stays in the library)
    const f = ed.files.get(o.assetId!), a = o.offset ?? 0, b = a + srcLen(o);
    if (!f) return;
    ed.revPct = 0;
    ed.error = '';
    begin('reverse', { secs: +(b - a).toFixed(1) }, ed.projectId);
    try {
      const blob = await makeReversed(f, a, b, (p) => (ed.revPct = p));
      const file = new File([blob], `${(ed.names.get(o.assetId!) ?? 'clip').replace(/\.[^.]+$/, '')} · ${t('reversed')}.mp4`, { type: 'video/mp4' });
      const r = await importFile(file);
      ed.assets = [...ed.assets, r.asset];
      ed.register(r.asset, file);
      ed.commit();
      ed.overlays = ed.overlays.map((x) => (x.id === id ? { ...x, fx: { ...x.fx, rev: { assetId: r.asset.id, start: a, end: b } } } : x));
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
      const pcm = new Map<string, Float32Array | null>();
      const ids: string[] = [], pieces: Float32Array[] = [], spans: number[] = [], used: Unit[] = [];
      ed.spkStatus = 'st.reading';
      // Whole captions, or ~1.2s pieces of them when lines may be split at speaker changes.
      const list: Unit[] = ed.spkSplit ? units(ed.captions) : ed.captions.filter((c) => c.words.length).map((c) => ({ capId: c.id, from: 0, to: c.words.length, start: c.words[0].start, end: c.words[c.words.length - 1].end }));
      for (const u of list) {
        const c = { id: u.capId, words: [{ text: '', start: u.start, end: u.end }] };
        const [a, b] = spanOf(c), at = assetAtSrc(ed.assets, (a + b) / 2);
        if (!at) continue;
        const id = at.asset.id, f = ed.files.get(id);
        if (!f || at.asset.kind === 'image') continue;
        if (!pcm.has(id)) pcm.set(id, await decodeAudio(f).catch(() => null));
        const x = pcm.get(id);
        if (!x) continue;
        const off = at.asset.base!, i0 = Math.max(0, Math.floor((a - off) * 16000)), i1 = Math.min(x.length, Math.ceil((b - off) * 16000));
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
  // Loudness from the waveform peaks over an output range: mean peak of the sound playing there, or null.
  function loudness(a: number, b: number): number | null {
    const m = (a + b) / 2, x = ed.liveAudios.filter((y) => m >= y.at && m < y.at + itemLen(y, ed.durations.get(y.assetId) ?? 0)).sort((p, q) => trackOf(p) - trackOf(q))[0];
    const pk = x && ed.peaks[x.assetId], dur = x && ed.durations.get(x.assetId);
    if (!x || !pk || !dur) return null;
    const m2 = { ...x, len: itemLen(x, dur) }, fa = fileAt(m2, a), fb = fileAt(m2, b);
    const i0 = Math.max(0, Math.floor((fa / dur) * pk.length)), i1 = Math.min(pk.length, Math.ceil((fb / dur) * pk.length));
    let s = 0;
    for (let i = i0; i < i1; i++) s += pk[i];
    return i1 > i0 ? s / (i1 - i0) : null;
  }
  // Highlights are found in output time (the words as they play on the timeline).
  const findClips = () => ((ed.highlights = findHighlights(captionsOut(keptCaps(ed.captions, ed.pieces).filter((c) => !c.free), ed.pieces), $state.snapshot(ed.hlOpts), loudness)), (ed.shortsMade = {}));
  const setHlLen = (min: number, max: number) => ((ed.hlOpts.min = min), (ed.hlOpts.max = max), findClips());
  async function makeAllShorts() {
    for (const [i, h] of (ed.highlights ?? []).entries()) if (!ed.shortsMade[h.start]) { ed.hlBusy = t('hlMaking', { n: i + 1 }); await makeShort(h, i + 1); }
    ed.hlBusy = '';
  }
  function previewClip(h: Highlight) {
    ed.seekOut(h.start);
    if (!ed.player.playing) ed.toggle();
  }
  async function makeShort(h: Highlight, n: number) {
    const durOf = (id: string) => ed.durations.get(id) ?? 0;
    const cut = shortOf($state.snapshot({ overlays: ed.overlays, audios: ed.audios, captions: ed.captions }) as Parameters<typeof shortOf>[0], ed.pieces, h.start, h.end, (x) => itemLen(x, durOf(x.assetId)));
    if (ed.hlReframe) {
      // Find the person in each video of the short (the segmenter downloads once), so 9:16 keeps them in frame.
      ed.hlBusy = t('hlReframing');
      for (const [k, o] of cut.overlays.entries()) {
        if (o.kind !== 'video' || !o.fill) continue;
        const f = await focusOfItem(o).catch(() => null);
        if (f) cut.overlays[k] = { ...o, fx: { ...o.fx, focus: f } };
      }
      ed.hlBusy = '';
    }
    const title = `${ed.name || t('untitled')} · ${t('short')} ${n}`;
    const doc: ProjectDoc = {
      ...$state.snapshot({ style: ed.style, language: ed.language, speakers: ed.speakers, assets: ed.assets, clipVolume: ed.clipVolume, showTr: ed.showTr, autoZoom: ed.autoZoom, denoise: ed.denoise, tracks: ed.tracks }),
      ...cut, v: DOC_VERSION, name: title, luts: ed.luts.map((l) => ({ id: l.id, name: l.name })), aspect: '9:16', words: ed.wordCache,
    };
    const meta = await createProject(title);
    await saveDoc(meta.id, doc, { duration: h.end - h.start, clips: cut.overlays.length });
    ed.shortsMade = { ...ed.shortsMade, [h.start]: meta.id };
  }
  // Transcribe the videos on the timeline (every one, or just the chosen item's file). Words are cached per file
  // in file time; captions keep the words inside the parts of each file the timeline uses, in source time.
  async function run() {
    if (!ed.hasMedia) return;
    ed.busy = true;
    ed.error = ed.notice = '';
    const lang = ed.language ?? 'auto';
    const vids = ed.overlays.filter((o) => o.kind === 'video' && o.assetId && !o.fx?.hold && !o.fx?.rev);
    const chosen = ed.targetClip ? vids.filter((o) => o.id === ed.targetClip!.id) : vids;
    begin('transcribe', { clips: chosen.length, language: lang }, ed.projectId);
    try {
      const ids = [...new Set(chosen.map((o) => o.assetId!))];
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
      // Each file's words between the first and last moment the timeline uses of it (this also drops timestamps
      // Whisper hallucinates past the end of short or silent clips).
      const wordsOf = (id: string, items: Overlay[]): Word[] => {
        const base = ed.assets.find((a) => a.id === id)?.base ?? 0;
        const lo = Math.min(...items.map((o) => o.offset ?? 0)), hi = Math.max(...items.map((o) => (o.offset ?? 0) + srcLen(o)));
        return (ed.wordCache[`${id}|${lang}`] ?? []).filter((w) => w.start >= lo - 1e-6 && w.start < hi)
          .map((w) => ({ ...w, start: w.start + base, end: Math.min(w.end, hi) + base }));
      };
      const fresh = groupWords(ids.flatMap((id) => wordsOf(id, chosen.filter((o) => o.assetId === id))).sort((a, b) => a.start - b.start));
      if (ed.targetClip) {
        const o = ed.targetClip, base = ed.assets.find((a) => a.id === o.assetId)?.base ?? 0;
        ed.setCaps(replaceInRange(ed.captions, fresh, base + (o.offset ?? 0), base + (o.offset ?? 0) + srcLen(o)));
        if (!fresh.length) ed.error = 'noSpeech';
      } else {
        ed.setCaps([...ed.captions.filter((c) => c.free), ...fresh]);
        if (!fresh.length) ed.error = 'noSpeech';
      }
      // Auto clean-up: cut fillers and long pauses straight away (one more undo step, so it can be undone alone).
      if (cleanup.auto && fresh.length) {
        const r = cleanupRanges(fresh.flatMap((c) => c.words), ed.pieces);
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
  // Cut silences from the sound itself (no transcript): quiet stretches in the part of each video the timeline plays.
  async function cutAudioSilences() {
    if (!ed.hasMedia || ed.silBusy) return;
    ed.silBusy = true;
    ed.error = ed.notice = '';
    try {
      const byAsset = new Map<string, [number, number][]>();
      const ranges: [number, number][] = [];
      for (const o of ed.overlays) {
        const id = o.assetId, f = id && ed.files.get(id), base = ed.assets.find((a) => a.id === id)?.base;
        if (o.kind !== 'video' || !f || base === undefined || o.fx?.hold || o.fx?.rev) continue;
        const lo = o.offset ?? 0, hi = lo + srcLen(o);
        if (!byAsset.has(id!)) byAsset.set(id!, await fileSilences(f, cleanup.db, cleanup.min, cleanup.pad).catch(() => []));
        for (const [a, b] of byAsset.get(id!)!) if (a < hi && b > lo) ranges.push([base + Math.max(a, lo), base + Math.min(b, hi)]);
      }
      const fresh = ranges.filter(([a, b]) => !isCutW(ed.pieces, { start: a, end: b }));
      if (fresh.length) ed.cutRanges(fresh);
      else ed.error = 'noSilence';
    } finally {
      ed.silBusy = false;
    }
  }
  // Where the person is in a video item: the median of the subject's centre over five frames of it.
  async function focusOfItem(o: Overlay): Promise<{ x: number; y: number } | null> {
    if (o.kind !== 'video' || !o.assetId) return null;
    const v = document.createElement('video');
    v.muted = true;
    v.src = ed.urls[o.assetId];
    await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = j)));
    const xs: number[] = [], ys: number[] = [];
    for (let k = 0; k < 5; k++) {
      v.currentTime = fileAt(o, o.at + ((k + 0.5) / 5) * o.len);
      await new Promise((r) => (v.onseeked = r));
      const c = await subjectCenter(v, v.videoWidth, v.videoHeight).catch(() => null);
      if (c) (xs.push(c.x), ys.push(c.y));
    }
    v.removeAttribute('src');
    return xs.length ? { x: median(xs), y: median(ys) } : null;
  }
  async function autoReframe(id: string) {
    const o = ed.overlays.find((x) => x.id === id);
    if (!o) return;
    ed.reframing = true;
    ed.error = '';
    try {
      const f = await focusOfItem(o);
      if (!f) return void (ed.error = 'noPerson');
      ed.commit();
      ed.overlays = ed.overlays.map((x) => (x.id === id ? { ...x, fx: { ...x.fx, focus: f } } : x));
    } catch {
      ed.error = 'noPerson';
    } finally {
      ed.reframing = false;
    }
  }
  // Every video that fills the frame.
  async function autoReframeAll() {
    ed.reframing = true;
    try {
      const fs = new Map<string, { x: number; y: number }>();
      for (const o of ed.overlays) if (o.kind === 'video' && o.fill) {
        const f = await focusOfItem(o).catch(() => null);
        if (f) fs.set(o.id, f);
      }
      ed.commit();
      ed.overlays = ed.overlays.map((x) => (fs.has(x.id) ? { ...x, fx: { ...x.fx, focus: fs.get(x.id) } } : x));
    } finally {
      ed.reframing = false;
    }
  }
  // The selected item's colour on every video and picture.
  function colorToAll() {
    ed.commit();
    const color = $state.snapshot(ed.selColor);
    ed.overlays = ed.overlays.map((x) => (x.kind === 'text' ? x : { ...x, fx: { ...x.fx, color } }));
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
  // Split the videos on V1 on every beat of the selected music (every `every`-th beat).
  function cutOnBeats(item: AudioItem, every = 1) {
    const a = ed.assets.find((x) => x.id === item.assetId);
    if (!a?.beats) return;
    const off = item.offset ?? 0, len = itemLen(item, a.duration);
    const outs = a.beats.filter((_, i) => i % every === 0).map((b) => item.at + b - off).filter((t) => t > item.at && t < item.at + len);
    const ids = () => ed.overlays.filter((o) => trackOf(o) === 0 && o.kind !== 'text').map((o) => o.id);
    ed.commit();
    for (const t of outs) ed.splitItems(ids(), t, false);
  }

  return { aimZooms, stabilize, reverseStrip, renderItem, setVoiceFx, detectSpeakers, findClips, setHlLen, makeAllShorts, previewClip, makeShort, run, cutAudioSilences, autoReframe, autoReframeAll, colorToAll, translateAll, detectBeatsFor, cutOnBeats };
}
