// Media and persistence: registering files (thumbnails, waveforms, proxies, noise-reduced audio),
// loading and autosaving the project, version history and project files, importing media.
import { linkLegacy } from '../links';
import { onMount } from 'svelte';
import { migrateStyle } from '../render';
import { registerFont, type SavedFont } from '../fonts';
import { toOutput, outDuration } from '../cuts';
import { type Asset, type AudioItem } from '../project';
import { type Lut } from '../grade';
import { wantsProxy, makeProxy, loadProxy, saveProxy, deleteProxy } from '../proxy';
import { cleanAudio, cleanKey } from '../denoise';
import { importFile, loadFile, mediaKind } from '../assets';
import { thumbnails } from '../thumbs';
import { audioPeaks } from '../waveform';
import * as store from '../store';
import { t, ui } from '../i18n.svelte';
import { begin, end, logError } from '../crash';
import { loadDoc, saveDoc, saveProjectFile, addVersion, listVersions, type ProjectDoc, type ProjectMeta, type Version } from '../projects';
import type { Ed } from './ed';

export function createMedia(ed: Ed) {
  let ready = false; // assetId → cleaned WAV at the current level
  const cleanLevel = new Map<string, number>(); // progress while cleaning
  let cleanRun = 0;
  $effect(() => {
    // Main clips, plus video layers whose sound is on.
    const level = ed.denoise, ids = [...new Set([...ed.clips.map((c) => c.assetId), ...ed.overlays.filter((o) => o.kind === 'video' && o.volume).map((o) => o.assetId!)])].filter((id) => ed.assets.find((a) => a.id === id)?.kind === 'video');
    const run = ++cleanRun;
    const drop = (id: string) => {
      const el = ed.player.clean.get(id);
      if (el) (el.pause(), URL.revokeObjectURL(el.src), ed.player.clean.delete(id));
      ed.cleanBlobs.delete(id);
      cleanLevel.delete(id);
    };
    for (const id of [...ed.player.clean.keys()]) if (!level || !ids.includes(id) || cleanLevel.get(id) !== level) drop(id);
    if (!level) return void (ed.cleanPct = null);
    (async () => {
      const todo = ids.filter((id) => ed.files.get(id) && !ed.player.clean.has(id)); // already cleaned at this level: keep
      for (const [k, id] of todo.entries()) {
        if (run !== cleanRun) return;
        let blob = await store.get<Blob>(cleanKey(id, level));
        if (!blob) {
          ed.cleanPct = (k / todo.length) * 100;
          blob = (await cleanAudio(ed.files.get(id)!, level, (p) => run === cleanRun && (ed.cleanPct = ((k + p / 100) / todo.length) * 100)).catch(() => null)) ?? undefined;
          if (blob) store.set(cleanKey(id, level), blob).catch(() => {}); // over quota: still used this session
        }
        if (run !== cleanRun || !blob) continue;
        drop(id);
        ed.cleanBlobs.set(id, blob);
        cleanLevel.set(id, level);
        const el = new Audio(URL.createObjectURL(blob));
        el.preload = 'auto';
        ed.player.clean.set(id, el);
      }
      if (run === cleanRun) ed.cleanPct = null;
    })();
  }); // assetId → progress while building
  const previewUrl = (id: string) => ed.proxyUrls[id] ?? ed.urls[id];
  async function buildProxy(a: Asset) {
    const f = ed.files.get(a.id);
    if (!f || a.id in ed.proxyPct) return;
    ed.proxyPct[a.id] = 0;
    begin('proxy', { file: a.name, secs: Math.round(a.duration) }, ed.projectId);
    try {
      const blob = await makeProxy(f, (p) => (ed.proxyPct[a.id] = p));
      await saveProxy(a.id, blob).catch(() => {}); // over quota: still used this session
      ed.proxyUrls[a.id] = URL.createObjectURL(blob);
      ed.assets = ed.assets.map((x) => (x.id === a.id ? { ...x, proxy: true } : x));
    } catch (e) {
      ed.notice = 'err.proxy';
      logError(e, 'proxy');
    } finally {
      end();
      delete ed.proxyPct[a.id];
    }
  }
  async function dropProxy(a: Asset) {
    if (ed.proxyUrls[a.id]) URL.revokeObjectURL(ed.proxyUrls[a.id]);
    delete ed.proxyUrls[a.id];
    ed.assets = ed.assets.map((x) => (x.id === a.id ? { ...x, proxy: undefined } : x));
    await deleteProxy(a.id);
  }

  // Make a file usable: object URL, thumbnails, waveform.
  function register(a: Asset, f: File) {
    ed.files.set(a.id, f);
    const url = URL.createObjectURL(f);
    ed.urls[a.id] = url;
    if (a.kind === 'image') {
      createImageBitmap(f).then(async (full) => {
        const k = Math.min(1, ed.PIC_MAX / Math.max(full.width, full.height));
        let bmp = full;
        if (k < 1) {
          bmp = await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: 'high' });
          full.close();
        }
        ed.pics.set(a.id, { src: bmp, w: bmp.width, h: bmp.height });
      }).catch(() => {});
      ed.thumbs[a.id] = Array.from({ length: 120 }, (_, i) => ({ t: i * 5, url })); // a still looks the same all along (up to 10 min)
      return;
    }
    if (a.kind === 'video') thumbnails(url, a.duration).then((th) => (ed.thumbs[a.id] = th)).catch(() => {});
    if (a.proxy) loadProxy(a.id).then((b) => b && (ed.proxyUrls[a.id] = URL.createObjectURL(b)));
    audioPeaks(f).then((p) => (ed.peaks[a.id] = p)).catch(() => {}); // no audio track: no waveform
  }

  onMount(async () => {
    begin('open', {}, ed.projectId); // cleared once the editor has been up for a few seconds
    document.documentElement.lang = ui.lang;
    const [doc, fts] = await Promise.all([loadDoc(ed.projectId), store.get<SavedFont[]>('fonts')]);
    for (const f of fts ?? []) {
      try {
        ed.fonts = [...ed.fonts, await registerFont(f)];
        ed.savedFonts.push(f);
      } catch {}
    }
    if (doc) {
      let missing = false;
      for (const a of doc.assets ?? []) {
        const f = await loadFile(a.id);
        if (f) register(a, f);
        else missing = true;
      }
      ed.assets = doc.assets ?? [];
      ed.clips = doc.clips ?? [];
      ed.audios = doc.audios ?? [];
      ed.overlays = doc.overlays ?? [];
      relink();
      ed.clipVolume = doc.clipVolume ?? 1;
      ed.wordCache = doc.words ?? {};
      restoreDoc(doc);
      if (missing) ed.notice = 'err.missingMedia';
    }
    if (ed.clips.length && !ed.segments.length) ed.segments = [{ start: 0, end: ed.duration }];
    ready = true;
    setTimeout(end, 4000); // opened and drawing: no longer "crashed while opening"
  });

  // Video layers saved with their own sound get it as a linked audio item (links.ts).
  function relink() {
    const r = linkLegacy(ed.overlays, ed.audios, (id) => ed.durations.get(id) ?? 0);
    if (r) ((ed.overlays = r.overlays), (ed.audios = r.audios));
  }
  function restoreDoc(doc: ProjectDoc) {
    ed.name = doc.name ?? '';
    ed.speakers = doc.speakers ?? [];
    ed.captions = doc.captions ?? [];
    ed.segments = doc.segments ?? [];
    ed.style = migrateStyle(doc.style ?? {});
    ed.language = doc.language ?? null;
    ed.showTr = doc.showTr ?? false;
    ed.autoZoom = doc.autoZoom ?? null;
    ed.denoise = doc.denoise ?? 0;
    ed.tracks = doc.tracks ?? { v: [], a: [] };
    ed.canvasAspect = doc.aspect ?? 'source';
    Promise.all((doc.luts ?? []).map((l) => store.get<Lut>('lut:' + l.id))).then((r) => (ed.luts = r.filter((x): x is Lut => !!x)));
    // A local (installed) font isn't in the list until "Use my fonts" runs again; keep it selectable.
    if (!ed.fonts.some((f) => f.family === ed.style.family)) ed.fonts = [...ed.fonts, { family: ed.style.family, weight: ed.style.weight }];
  }

  // Autosave ~0.4s after any change. The home page card gets the name, length and (every ~10s) a thumbnail.
  let lastThumb = 0;
  // Card image for the home page: a frame from the first clip (its timeline thumbnails are real decoded frames).
  function thumbnail(): string | undefined {
    const th = ed.clips.length ? ed.thumbs[ed.clips[0].assetId] : undefined;
    return th?.length ? th[Math.floor(th.length / 3)].url : undefined;
  }



  async function saveNow() {
    const doc: ProjectDoc = { ...$state.snapshot({ name: ed.name, captions: ed.captions, segments: ed.segments, style: ed.style, language: ed.language, speakers: ed.speakers, assets: ed.assets, clips: ed.clips, audios: ed.audios, clipVolume: ed.clipVolume, overlays: ed.overlays, showTr: ed.showTr, autoZoom: ed.autoZoom, denoise: ed.denoise, tracks: ed.tracks }), luts: ed.luts.map((l) => ({ id: l.id, name: l.name })), aspect: ed.canvasAspect, words: ed.wordCache };
    const meta: Partial<ProjectMeta> = { duration: outDuration(ed.segments), clips: ed.clips.length };
    if (Date.now() - lastThumb > 10000) {
      const th = thumbnail();
      if (th) ((meta.thumb = th), (lastThumb = Date.now()));
    }
    await saveDoc(ed.projectId, doc, meta);
    addVersion(ed.projectId, doc).catch(() => {}); // a snapshot every ~2 minutes of editing
  }
  $effect(() => {
    $state.snapshot({ name: ed.name, captions: ed.captions, segments: ed.segments, style: ed.style, language: ed.language, speakers: ed.speakers, assets: ed.assets, clips: ed.clips, audios: ed.audios, clipVolume: ed.clipVolume, overlays: ed.overlays, showTr: ed.showTr, autoZoom: ed.autoZoom, denoise: ed.denoise, tracks: ed.tracks });
    void ed.luts.length, ed.canvasAspect;
    void (ed.clips.length && ed.thumbs[ed.clips[0].assetId]?.length); // first-clip thumbnails ready → refresh the card
    if (!ready) return;
    ed.saving = true;
    const id = setTimeout(() => saveNow().catch(() => {}).finally(() => (ed.saving = false)), 400);
    return () => clearTimeout(id);
  });
  async function openHistory() {
    ed.versions = (await listVersions(ed.projectId)).toReversed();
    ed.histDialog?.showModal();
  }
  async function restoreVersion(v: Version) {
    // Keep the current state as a version first, so restoring can itself be undone from here.
    await addVersion(ed.projectId, { ...$state.snapshot({ name: ed.name, captions: ed.captions, segments: ed.segments, style: ed.style, language: ed.language, speakers: ed.speakers, assets: ed.assets, clips: ed.clips, audios: ed.audios, clipVolume: ed.clipVolume, overlays: ed.overlays, showTr: ed.showTr, autoZoom: ed.autoZoom, denoise: ed.denoise, tracks: ed.tracks }), aspect: ed.canvasAspect } as ProjectDoc, { force: true, label: t('beforeRestore') });
    ed.commit();
    const d = v.doc;
    const have = new Set(ed.assets.map((a) => a.id)); // media deleted since then can't come back
    ed.clips = (d.clips ?? []).filter((c) => have.has(c.assetId));
    ed.audios = (d.audios ?? []).filter((a) => have.has(a.assetId));
    ed.overlays = (d.overlays ?? []).filter((o) => !o.assetId || have.has(o.assetId));
    relink();
    ed.clipVolume = d.clipVolume ?? 1;
    restoreDoc({ ...d, assets: ed.assets } as ProjectDoc);
    ed.histDialog?.close();
    ed.announce(t('versionRestored'));
  }
  const ago = (ms: number) => {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? t('justNow') : m < 60 ? t('minAgo', { n: m }) : new Date(ms).toLocaleString(ui.lang);
  };
  async function saveToFile(again = true) {
    await saveNow();
    const r = await saveProjectFile(ed.projectId, ed.name, again).catch(() => 'error' as const);
    ed.fileStatus = r === 'saved' ? 'fileSaved' : r === 'downloaded' ? 'fileDownloaded' : r === 'error' ? 'err.saveFile' : '';
    setTimeout(() => (ed.fileStatus = ''), 3000);
  }

  // ---- Media library ----
  // Import any number of files at once: probed in parallel, added in the order picked.
  // Videos join the end of the sequence; audio goes onto the Music & VO track at the playhead.
  async function importMedia(list: FileList | File[] | undefined | null) {
    const media = [...(list ?? [])].filter((f) => mediaKind(f));
    if (!media.length) return;
    ed.error = ed.notice = '';
    const at = toOutput(ed.segments, ed.time) ?? 0;
    const results = await Promise.all(media.map((f) => importFile(f).then((r) => ({ f, ...r }), () => null)));
    for (const r of results) {
      if (!r) {
        ed.error = 'err.badMedia';
        continue;
      }
      if (!r.saved) ed.notice = 'err.saveVideo';
      ed.assets = [...ed.assets, r.asset];
      register(r.asset, r.f);
      if (!ed.name) ed.name = r.f.name.replace(/\.[^.]+$/, '');
      if (wantsProxy(r.asset)) buildProxy(r.asset); // big or long footage: fast preview copy in the background
      // Images start a slideshow on the main track when there's no video yet; over video they're layers.
      if (r.asset.kind === 'video' || (r.asset.kind === 'image' && !ed.hasVideoClip())) ed.addClip(r.asset.id);
      else if (r.asset.kind === 'image') ed.addOverlay(r.asset, at);
      else ed.addAudio(r.asset.id, at);
    }
  }


  // Generated voiceover: each file becomes an audio asset on the Music & VO track (one undo step).
  async function addVoiceover(items: { file: File; at: number }[]) {
    const now = toOutput(ed.segments, ed.time) ?? 0;
    const added: AudioItem[] = [];
    for (const { file, at } of items) {
      const r = await importFile(file).catch(() => null);
      if (!r) { ed.error = 'err.badMedia'; continue; }
      if (!r.saved) ed.notice = 'err.saveVideo';
      ed.assets = [...ed.assets, r.asset];
      register(r.asset, file);
      added.push({ id: crypto.randomUUID(), assetId: r.asset.id, at: Number.isFinite(at) ? at : now, volume: 1 });
    }
    if (!added.length) return;
    ed.commit();
    ed.audios = [...ed.audios, ...added];
    ed.selectedAudio = added[0].id;
    ed.announce(t('voAdded', { n: added.length }));
  }

  return { previewUrl, buildProxy, dropProxy, register, openHistory, restoreVersion, ago, saveToFile, importMedia, addVoiceover };
}
