<script lang="ts">
  import { onMount } from 'svelte';
  import { transcribe } from './lib/transcribe';
  import { groupWords, captionText, setText, setRange, split, mergeNext, toSRT, toVTT, startOf, endOf, setSpeaker, type Caption } from './lib/captions';
  import { drawCaption, fontString, DEFAULT_STYLE, migrateStyle, type Style } from './lib/render';
  import { BUNDLED, localFonts, uploadFont, registerFont, type Font, type SavedFont } from './lib/fonts';
  import { splitAt, remove, trim, toSource, toOutput, nextKept, outDuration, captionsForOutput, cutRange, keepRange, keptCaptions, type Segment } from './lib/cuts';
  import { thumbnails, type Thumb } from './lib/thumbs';
  import { audioPeaks } from './lib/waveform';
  import * as store from './lib/store';
  import { t, ui, setLang } from './lib/i18n.svelte';
  import Timeline from './lib/Timeline.svelte';
  import ExportDialog from './lib/ExportDialog.svelte';
  import StylePanel from './lib/StylePanel.svelte';
  import TranscriptView from './lib/TranscriptView.svelte';

  let file = $state<File | null>(null);
  let src = $state<string | null>(null);
  let duration = $state(0);
  let time = $state(0);
  let paused = $state(true);
  let dragging = $state(false);
  let language = $state<'english' | 'spanish' | null>(null);
  let busy = $state(false);
  let status = $state('');
  let pct = $state(0);
  let error = $state('');
  let notice = $state('');
  let captions = $state<Caption[]>([]);
  let video = $state<HTMLVideoElement>();
  let canvas = $state<HTMLCanvasElement>();
  let style = $state<Style>({ ...DEFAULT_STYLE });
  let fonts = $state<Font[]>([...BUNDLED]);
  let fontError = $state('');
  let segments = $state<Segment[]>([]);
  let selected = $state(-1);
  let thumbs = $state<Thumb[]>([]);
  let peaks = $state<Float32Array | null>(null);
  let tlZoom = $state(1);
  let videoWidth = $state(0);
  let videoHeight = $state(0);
  let exporter = $state<ExportDialog>();

  // Undo/redo: snapshots of the editable project (cuts + captions).
  type Snap = { segments: Segment[]; captions: Caption[] };
  let past = $state<Snap[]>([]);
  let future = $state<Snap[]>([]);
  const snap = (): Snap => $state.snapshot({ segments, captions });
  const restore = (s: Snap) => ((segments = s.segments), (captions = s.captions), (selected = -1));
  function commit() {
    past = [...past.slice(-99), snap()]; // ponytail: 100-step cap, full snapshots; fine at caption-list sizes
    future = [];
  }
  function undo() {
    const s = past.at(-1);
    if (s) ((future = [snap(), ...future]), (past = past.slice(0, -1)), restore(s));
  }
  function redo() {
    const s = future[0];
    if (s) ((past = [...past, snap()]), (future = future.slice(1)), restore(s));
  }
  const setCaps = (c: Caption[]) => (commit(), (captions = c));
  const setSegs = (s: Segment[]) => s !== segments && (commit(), (segments = s));

  // ---- Persistence (IndexedDB): video file, editable doc, uploaded fonts ----
  type Doc = { name: string; captions: Caption[]; segments: Segment[]; style: Style; language: typeof language; speakers?: string[] };
  let speakers = $state<string[]>([]);
  let name = $state('');
  let saving = $state(false);
  let ready = false; // no autosave until the saved project has been restored
  let pendingSegs: Segment[] | null = null; // saved cuts, applied once the video's metadata is known
  let savedFonts: SavedFont[] = [];

  onMount(async () => {
    document.documentElement.lang = ui.lang;
    const [v, doc, fts] = await Promise.all([
      store.get<File>('video'), store.get<Doc>('doc'), store.get<SavedFont[]>('fonts'),
    ]);
    for (const f of fts ?? []) {
      try {
        fonts = [...fonts, await registerFont(f)];
        savedFonts.push(f);
      } catch {}
    }
    if (v) {
      load(v, false);
      if (doc) {
        name = doc.name ?? name;
        speakers = doc.speakers ?? [];
        captions = doc.captions;
        pendingSegs = doc.segments;
        style = migrateStyle(doc.style);
        language = doc.language;
        // A local (installed) font isn't in the list until "Use my fonts" runs again; keep it selectable.
        if (!fonts.some((f) => f.family === style.family)) fonts = [...fonts, { family: style.family, weight: style.weight }];
        notice = 'restored';
      }
    }
    ready = true;
  });

  $effect(() => {
    const doc: Doc = $state.snapshot({ name, captions, segments, style, language, speakers });
    if (!ready || !file) return;
    saving = true;
    const id = setTimeout(() => store.set('doc', doc).catch(() => {}).finally(() => (saving = false)), 400);
    return () => clearTimeout(id);
  });

  function load(f: File | undefined, save = true) {
    if (!f?.type.startsWith('video/')) return;
    if (src) URL.revokeObjectURL(src);
    src = URL.createObjectURL(f);
    file = f;
    if (save) ((name = f.name.replace(/\.[^.]+$/, '')), (speakers = []));
    captions = [];
    segments = [];
    thumbs = [];
    peaks = null;
    tlZoom = 1;
    past = future = [];
    selected = -1;
    error = notice = '';
    if (save) {
      pendingSegs = null;
      store.del('doc');
      store.set('video', f).catch(() => (store.del('video'), (notice = 'err.saveVideo')));
    }
  }

  async function newProject() {
    if (!confirm(t('confirmNew'))) return;
    await Promise.all([store.del('video'), store.del('doc')]);
    if (src) URL.revokeObjectURL(src);
    src = file = null;
    name = '';
    speakers = [];
    captions = segments = thumbs = [];
    peaks = null;
    past = future = [];
    selected = -1;
    error = notice = '';
  }

  async function onMeta() {
    const v = video, s = src;
    if (!v || !s) return;
    // Browser-recorded WebM often has no duration header; seeking far forces the browser to find it.
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e9;
      await new Promise((r) => v.addEventListener('durationchange', r, { once: true }));
      v.currentTime = 0;
      await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
      duration = v.duration;
    }
    segments = pendingSegs ?? [{ start: 0, end: v.duration }];
    pendingSegs = null;
    thumbnails(s, v.duration).then((t) => src === s && (thumbs = t)).catch(() => {});
    if (file) audioPeaks(file).then((p) => src === s && (peaks = p)).catch(() => {}); // no audio track: no waveform
  }

  async function run() {
    if (!file) return;
    busy = true;
    error = notice = '';
    try {
      const words = await transcribe(file, language, (s, p) => ((status = s), (pct = p)));
      setCaps(groupWords(words));
      if (!captions.length) error = 'noSpeech';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  const active = (c: Caption) => time >= startOf(c) && time < endOf(c);
  const seek = (t: number) => video && (video.currentTime = Math.max(0, Math.min(t, duration || t)));
  function toggle() {
    if (!video) return;
    if (!video.paused) return video.pause();
    if (segments.length && nextKept(segments, video.currentTime) === null) seek(segments[0].start); // at end: restart
    video.play();
  }
  const update = (i: number, c: Caption) => setCaps(captions.with(i, c));
  const outTime = $derived(toOutput(segments, time) ?? 0);

  function download(ext: 'srt' | 'vtt') {
    const caps = captionsForOutput(captions, segments);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ext === 'srt' ? toSRT(caps) : toVTT(caps)], { type: 'text/plain' }));
    a.download = (file?.name.replace(/\.[^.]+$/, '') ?? 'captions') + '.' + ext;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // While playing, jump over cut ranges. Returns the (possibly corrected) time.
  function skipCuts(v: HTMLVideoElement) {
    const t = v.currentTime;
    if (v.paused || !segments.length) return t;
    const k = nextKept(segments, t);
    if (k === null) {
      v.pause();
      return (v.currentTime = segments[segments.length - 1].end - 0.01);
    }
    if (k !== t) v.currentTime = k;
    return k;
  }

  // Draw loop: video frame + active caption, every animation frame.
  $effect(() => {
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d')!;
    const v = video, cv = canvas;
    let id = 0;
    const tick = () => {
      const w = v.videoWidth || 1280, h = v.videoHeight || 720;
      if (cv.width !== w || cv.height !== h) ((cv.width = w), (cv.height = h));
      const t = skipCuts(v);
      time = t;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      if (v.readyState >= 2 && v.videoWidth) ctx.drawImage(v, 0, 0, w, h);
      const cap = visibleCaps.find((c) => t >= startOf(c) && t < endOf(c));
      if (cap) drawCaption(ctx, cap, t, style);
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  });

  // Make sure the chosen font is downloaded before the canvas uses it.
  $effect(() => {
    document.fonts.load(fontString(style, 40)).catch(() => {});
  });

  // Drag on the canvas moves the caption; a click without moving plays/pauses.
  let drag: { moved: boolean } | null = null;
  function pointer(e: PointerEvent) {
    const r = canvas!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (e.type === 'pointerdown') ((drag = { moved: false }), canvas!.setPointerCapture(e.pointerId));
    else if (e.type === 'pointermove' && drag) {
      drag.moved = true;
      style.x = Math.min(0.95, Math.max(0.05, x));
      style.y = Math.min(0.95, Math.max(0.05, y));
    } else if (e.type === 'pointerup' && drag) {
      if (!drag.moved) toggle();
      drag = null;
    }
  }

  function pickFont(family: string) {
    const f = fonts.find((x) => x.family === family);
    if (f) ((style.family = f.family), (style.weight = f.weight));
  }

  async function addLocalFonts() {
    fontError = '';
    try {
      const have = new Set(fonts.map((f) => f.family));
      fonts = [...fonts, ...(await localFonts()).filter((f) => !have.has(f.family))];
    } catch (e) {
      fontError = (e as Error).message;
    }
  }

  async function addUploadedFont(f: File | undefined) {
    if (!f) return;
    fontError = '';
    try {
      const saved = await uploadFont(f);
      if (!fonts.some((x) => x.family === saved.family)) fonts = [...fonts, { family: saved.family, weight: 400 }];
      savedFonts = [...savedFonts.filter((x) => x.family !== saved.family), saved];
      store.set('fonts', savedFonts).catch(() => {});
      pickFont(saved.family);
    } catch {
      fontError = 'badFont';
    }
  }

  // ---- Layout state ----
  let tab = $state<'transcript' | 'captions'>('transcript');
  let assetsOpen = $state(true);
  let zoom = $state(1); // 1 = fit to the stage

  let transcriptView = $state<TranscriptView>();
  const cutRanges = (r: [number, number][]) => setSegs(r.reduce((s, [a, b]) => cutRange(s, a, b), segments));
  const keepRanges = (r: [number, number][]) => setSegs(r.reduce((s, [a, b]) => keepRange(s, a, b), segments));
  const visibleCaps = $derived(keptCaptions(captions, segments)); // what the preview draws

  // Add a 2-second line at the playhead, kept in time order.
  function addLine() {
    const s = time, e = Math.min(duration || s + 2, s + 2);
    const c = setText({ id: crypto.randomUUID(), words: [{ text: '…', start: s, end: e }] }, t('newLine'));
    const i = captions.findIndex((x) => startOf(x) > s);
    setCaps(i < 0 ? [...captions, c] : captions.toSpliced(i, 0, c));
    tab = 'captions';
  }

  const animName = $derived(t('anim.' + style.animation));
  const saveState = $derived(saving ? t('saving') : t('saved'));

  const cutHere = () => video && setSegs(splitAt(segments, video.currentTime));
  const deleteSelected = () => selected >= 0 && (setSegs(remove(segments, selected)), (selected = -1));

  function keys(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') (e.preventDefault(), e.shiftKey ? redo() : undo());
    else if (mod && e.key.toLowerCase() === 'y') (e.preventDefault(), redo());
    else if (mod) return;
    else if (e.code === 'Space' && !(e.target as HTMLElement).closest('button')) (e.preventDefault(), toggle());
    else if (e.key.toLowerCase() === 's') cutHere();
    else if (e.key === 'Delete' || e.key === 'Backspace') (tab === 'transcript' && transcriptView?.toggleSelection()) || deleteSelected();
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  // 00:00:08.12 (hh:mm:ss.cc)
  const tc = (s: number) => {
    const cs = Math.floor(s * 100), p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(cs / 360000))}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
  };
</script>

<svelte:window onkeydown={keys} />

<div class="app" class:no-assets={!assetsOpen}>
  <header class="top">
    <div class="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" aria-hidden="true">
        <rect x="2" y="5" width="14" height="14" rx="3" /><path d="M16 10l6-3v10l-6-3z" stroke-linejoin="round" />
      </svg>
      <span class="logo">Sonant</span>
      <span class="slash">/</span>
      <input class="pname" bind:value={name} placeholder={t('untitled')} aria-label={t('projectName')} disabled={!file} />
      {#if file}<span class="pill">{saveState}</span>{/if}
    </div>
    <div class="actions">
      <select class="lang" value={ui.lang} onchange={(e) => setLang(e.currentTarget.value as 'en' | 'es')} aria-label="Interface language / Idioma">
        <option value="en">EN</option>
        <option value="es">ES</option>
      </select>
      {#if file}<button onclick={newProject}>{t('newProject')}</button>{/if}
      <button class:on={assetsOpen} onclick={() => (assetsOpen = !assetsOpen)} aria-pressed={assetsOpen} title={t('toggleAssets')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
        {t('assets')}
      </button>
      <button class="primary" onclick={() => exporter?.open()} disabled={!file || !segments.length || !videoWidth}>{t('ex.title')}</button>
    </div>
  </header>

  {#if assetsOpen}
    <aside class="assets panel">
      <div class="phead">
        <h2>{t('assets')}</h2>
        <button class="icon sm" onclick={() => (assetsOpen = false)} aria-label={t('collapse')}>‹</button>
      </div>
      <label class="import">
        {t('importMedia')}
        <input type="file" accept="video/*" hidden onchange={(e) => load(e.currentTarget.files?.[0])} />
      </label>
      {#if file}
        <div class="grid">
          <div class="asset">
            <div class="thumb">
              {#if thumbs[0]}<img src={thumbs[Math.floor(thumbs.length / 3)].url} alt="" />{:else}<span class="muted">Video</span>{/if}
              <span class="dur mono">{fmt(duration || 0)}</span>
            </div>
            <span class="aname">{file.name}</span>
          </div>
        </div>
      {/if}
      <p class="muted small">{t('assetsHint')}</p>
    </aside>
  {/if}

  <section class="text panel">
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'transcript'} class:on={tab === 'transcript'} onclick={() => (tab = 'transcript')}>{t('transcript')}</button>
      <button role="tab" aria-selected={tab === 'captions'} class:on={tab === 'captions'} onclick={() => (tab = 'captions')}>{t('captions')}</button>
    </div>
    <div class="scroll">
      {#if notice}<p class="notice">{t(notice)}</p>{/if}
      <div class="row">
        <select bind:value={language} disabled={busy} aria-label={t('language')}>
          <option value={null}>{t('auto')}</option>
          <option value="english">English</option>
          <option value="spanish">Español</option>
        </select>
        <button onclick={run} disabled={!file || busy}>{captions.length ? t('retranscribe') : t('transcribe')}</button>
      </div>
      {#if busy}
        <p class="muted small">{t(status)}</p>
        <progress max="100" value={pct}></progress>
      {/if}
      {#if error}<p class="error small">{t(error)}</p>{/if}

      {#if tab === 'transcript'}
        {#if !captions.length && !busy}<p class="muted small">{t('transcriptEmpty')}</p>{/if}
        {#if captions.length}
          <TranscriptView bind:this={transcriptView} {captions} {segments} {time} {duration}
            {speakers} onseek={seek} oncut={cutRanges} onkeep={keepRanges}
            onspeaker={(ids, k) => { if (k === speakers.length) speakers = [...speakers, '']; setCaps(setSpeaker(captions, new Set(ids), k)); }}
            onrename={(k, n) => (speakers = speakers.with(k, n))} />
        {/if}
      {:else}
        <p class="muted small">{t('captionsHint')}</p>
        <ol class="caps">
          {#each captions as c, i (c.id)}
            <li class:on={active(c)}>
              <div class="times mono">
                <input type="number" step="0.1" min="0" aria-label={t('start')} value={startOf(c).toFixed(2)}
                  onchange={(e) => update(i, setRange(c, +e.currentTarget.value, endOf(c)))} />
                <input type="number" step="0.1" min="0" aria-label={t('end')} value={endOf(c).toFixed(2)}
                  onchange={(e) => update(i, setRange(c, startOf(c), +e.currentTarget.value))} />
              </div>
              <textarea rows="2" aria-label={t('capText')} value={captionText(c)} onfocus={() => seek(startOf(c))}
                onchange={(e) => update(i, setText(c, e.currentTarget.value))}></textarea>
              <span class="tools">
                <button class="sm icon" title={t('playHere')} aria-label={t('playHere')} onclick={() => seek(startOf(c))}>▶</button>
                <button class="sm icon" title={t('splitCap')} aria-label={t('splitCap')} disabled={c.words.length < 2} onclick={() => setCaps(split(captions, i))}>✂</button>
                <button class="sm icon" title={t('mergeNext')} aria-label={t('mergeNext')} disabled={i === captions.length - 1} onclick={() => setCaps(mergeNext(captions, i))}>⤓</button>
                <button class="sm icon" title={t('del')} aria-label={t('del')} onclick={() => setCaps(captions.toSpliced(i, 1))}>✕</button>
              </span>
            </li>
          {/each}
        </ol>
        <button class="add" onclick={addLine} disabled={!file}>{t('addLine')}</button>
        {#if captions.length}
          <h3 class="sub">{t('subtitleFiles')}</h3>
          <div class="row">
            <button class="sm" onclick={() => download('srt')}>{t('dlSrt')}</button>
            <button class="sm" onclick={() => download('vtt')}>{t('dlVtt')}</button>
          </div>
        {/if}
      {/if}
    </div>
  </section>

  <section class="center">
    <div
      class="stage"
      class:dragging
      class:zoomed={zoom !== 1}
      aria-label={t('preview')}
      role="region"
      ondragover={(e) => { e.preventDefault(); dragging = true; }}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => { e.preventDefault(); dragging = false; load(e.dataTransfer?.files[0]); }}
    >
      {#if src}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video {src} bind:this={video} bind:duration bind:paused bind:videoWidth bind:videoHeight playsinline hidden onloadedmetadata={onMeta}
          ontimeupdate={(e) => skipCuts(e.currentTarget)}></video>
        <div class="frame" style:width={zoom !== 1 ? `${zoom * 100}%` : null}>
          <span class="badge">{t('animBadge', { name: animName })}</span>
          <canvas bind:this={canvas} onpointerdown={pointer} onpointermove={pointer} onpointerup={pointer}
            aria-label={t('preview')}></canvas>
        </div>
      {:else}
        <label class="empty">
          <span>{t('drop')}</span>
          <input type="file" accept="video/*" hidden onchange={(e) => load(e.currentTarget.files?.[0])} />
        </label>
      {/if}
    </div>
    <div class="transport">
      <div class="row">
        <button class="round" onclick={() => seek(time - 5)} disabled={!src} aria-label={t('back')}>«</button>
        <button class="round play" onclick={toggle} disabled={!src} aria-label={paused ? t('play') : t('pause')}>{paused ? '▶' : '❚❚'}</button>
        <button class="round" onclick={() => seek(time + 5)} disabled={!src} aria-label={t('forward')}>»</button>
        <span class="mono tcode">{tc(outTime)} <span class="muted">/ {tc(outDuration(segments))}</span></span>
      </div>
      <div class="row">
        <button class="sm icon" onclick={() => (zoom = Math.max(0.5, zoom - 0.25))} aria-label={t('zoomOut')}>−</button>
        <span class="mono small zl">{zoom === 1 ? t('fit') : `${Math.round(zoom * 100)}%`}</span>
        <button class="sm icon" onclick={() => (zoom = Math.min(3, zoom + 0.25))} aria-label={t('zoomIn')}>+</button>
        <button class="sm" class:on={zoom === 1} onclick={() => (zoom = 1)} aria-pressed={zoom === 1}>⛶ {t('fit')}</button>
      </div>
    </div>
  </section>

  <aside class="style panel">
    <StylePanel bind:style {fonts} {fontError} onlocal={addLocalFonts} onupload={addUploadedFont} />
  </aside>

  <section class="timeline-area">
    <div class="thead">
      <h2>{t('timelineH')}</h2>
      <div class="row">
        <button class="sm" onclick={cutHere} disabled={!segments.length} title={t('splitTip')}>{t('splitAt')}</button>
        <button class="sm" onclick={deleteSelected} disabled={selected < 0 || segments.length < 2} title={t('delTip')}>{t('del')}</button>
        <button class="sm icon" onclick={undo} disabled={!past.length} title={t('undo')} aria-label={t('undo')}>↶</button>
        <button class="sm icon" onclick={redo} disabled={!future.length} title={t('redo')} aria-label={t('redo')}>↷</button>
        <button class="sm icon" onclick={() => (tlZoom = Math.max(1, tlZoom / 1.5))} disabled={tlZoom <= 1} aria-label={t('zoomOut')}>−</button>
        <button class="sm icon" onclick={() => (tlZoom = Math.min(16, tlZoom * 1.5))} aria-label={t('zoomIn')}>+</button>
      </div>
    </div>
    <Timeline {segments} {time} {thumbs} {peaks} {duration} {captions} zoom={tlZoom} bind:selected
      animLabel={t('allCaptions', { name: animName })}
      onseek={(o) => seek(toSource(segments, o))}
      oncommit={commit}
      ontrim={(i, s, e) => (segments = trim(segments, i, s, e, duration))}
      onmovecap={(id, s, e) => (captions = captions.map((c) => (c.id === id ? setRange(c, s, e) : c)))} />
  </section>
</div>

{#if file}
  <ExportDialog bind:this={exporter} {file} {segments} {captions} {style} srcW={videoWidth} srcH={videoHeight} />
{/if}

<style>
  .app {
    height: 100vh; display: grid;
    grid-template-columns: 270px 340px minmax(0, 1fr) 340px;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas: 'top top top top' 'assets text center style' 'tl tl tl tl';
  }
  .app.no-assets { grid-template-columns: 340px minmax(0, 1fr) 340px; grid-template-areas: 'top top top' 'text center style' 'tl tl tl'; }
  .top { grid-area: top; display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 20px; border-bottom: 1px solid var(--border-soft); }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .logo { font-family: var(--display); font-weight: 700; font-size: 18px; letter-spacing: -.01em; }
  .slash { color: var(--muted); }
  .pname { background: none; border: 1px solid transparent; font-weight: 600; padding: 4px 6px; min-width: 0; width: 22ch; }
  .pname:hover:not(:disabled) { border-color: var(--border); }
  .pill { background: var(--raised); color: var(--muted); font-size: 12px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
  .actions { display: flex; gap: 8px; align-items: center; }
  .actions button.on { border-color: var(--accent); background: rgb(200 245 96 / .06); }
  .lang { height: 36px; padding: 0 8px; }
  .panel { background: var(--panel); min-height: 0; display: flex; flex-direction: column; }
  .assets { grid-area: assets; border-right: 1px solid var(--border-soft); padding: 16px; gap: 12px; overflow: auto; }
  .phead { display: flex; justify-content: space-between; align-items: center; }
  .import { display: flex; align-items: center; justify-content: center; height: 42px; border: 1px dashed var(--border);
    border-radius: 10px; cursor: pointer; }
  .import:hover { border-color: var(--accent); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .asset { display: grid; gap: 4px; min-width: 0; }
  .thumb { position: relative; aspect-ratio: 16 / 11; background: var(--tab-on); border-radius: 8px; overflow: hidden;
    display: grid; place-items: center; outline: 2px solid var(--accent); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .dur { position: absolute; right: 4px; bottom: 4px; background: rgb(0 0 0 / .75); font-size: 11px; padding: 1px 4px; border-radius: 4px; }
  .aname { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .small { font-size: 12px; }
  .text { grid-area: text; border-right: 1px solid var(--border-soft); }
  .tabs { display: flex; gap: 4px; padding: 12px 16px; }
  .tabs button { border: 0; height: 36px; color: var(--muted); font-weight: 500; border-radius: 8px; }
  .tabs button.on { background: var(--tab-on); color: var(--text); }
  .scroll { overflow: auto; padding: 0 16px 16px; display: grid; gap: 10px; align-content: start; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row select { flex: 1; height: 36px; padding: 0 8px; }
  progress { width: 100%; accent-color: var(--accent); }
  .notice { font-size: 13px; padding: 8px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); margin: 0; }
  .caps { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .caps li { position: relative; display: grid; grid-template-columns: 72px 1fr; gap: 8px; padding: 10px 12px;
    background: var(--card); border: 1px solid var(--border-soft); border-radius: 10px; }
  .caps li.on { border-color: var(--accent); }
  .times { display: grid; gap: 2px; align-content: start; }
  .times input { width: 100%; font-family: var(--mono); font-size: 12px; color: var(--muted); background: none; border: 1px solid transparent; padding: 1px 2px; }
  .times input:hover, .times input:focus { border-color: var(--border); color: var(--text); }
  textarea { resize: vertical; background: none; border: 1px solid transparent; padding: 2px 4px; font-size: 14px; line-height: 1.4; }
  textarea:hover, textarea:focus { border-color: var(--border); }
  .tools { position: absolute; top: 6px; right: 6px; display: none; gap: 2px; background: var(--card); }
  .caps li:hover .tools, .caps li:focus-within .tools { display: flex; }
  .tools button { width: 26px; height: 26px; font-size: 11px; }
  .add { border-style: dashed; height: 40px; }
  .sub { margin-top: 8px; }
  .center { grid-area: center; display: grid; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; }
  .stage { display: grid; place-items: center; padding: 24px; min-height: 0; overflow: auto; border: 2px dashed transparent; }
  .stage.dragging { border-color: var(--accent); }
  .stage.zoomed { place-items: start center; }
  .frame { position: relative; display: grid; max-width: 100%; max-height: 100%; }
  .stage.zoomed .frame { max-width: none; max-height: none; }
  canvas { display: block; max-width: 100%; max-height: calc(100vh - 360px); width: auto; height: auto; border-radius: 12px; background: #000; cursor: move; touch-action: none; }
  .stage.zoomed canvas { width: 100%; max-height: none; }
  .badge { position: absolute; top: 12px; left: 12px; z-index: 1; background: rgb(15 15 15 / .8); font-size: 12px; padding: 4px 10px; border-radius: 999px; pointer-events: none; }
  .empty { display: grid; place-items: center; width: 100%; height: 100%; min-height: 200px; border: 1px dashed var(--border); border-radius: 12px; cursor: pointer; color: var(--muted); text-align: center; padding: 16px; }
  .transport { display: grid; gap: 10px; padding: 12px 20px 16px; border-top: 1px solid var(--border-soft); }
  .round { width: 40px; height: 40px; border-radius: 50%; padding: 0; }
  .round.play { width: 48px; height: 48px; background: var(--text); color: var(--bg); border-color: var(--text); font-size: 16px; }
  .tcode { margin-left: 8px; font-size: 13px; white-space: nowrap; }
  .zl { min-width: 44px; text-align: center; }
  .transport button.on { border-color: var(--accent); }
  .style { grid-area: style; border-left: 1px solid var(--border-soft); overflow: auto; }
  .timeline-area { grid-area: tl; border-top: 1px solid var(--border-soft); padding: 12px 20px 16px; display: grid; gap: 10px; }
  .thead { display: flex; justify-content: space-between; align-items: center; }

  @media (max-width: 1100px) {
    .app, .app.no-assets {
      height: auto; min-height: 100vh;
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'top' 'center' 'text' 'style' 'assets' 'tl';
    }
    .top { flex-wrap: wrap; position: sticky; top: 0; z-index: 2; background: var(--bg); }
    .assets, .text, .style { border: 0; border-top: 1px solid var(--border-soft); }
    .text .scroll { max-height: 60vh; }
    canvas { max-height: 60vh; }
  }
  @media (max-width: 560px) {
    .top, .timeline-area { padding-left: 16px; padding-right: 16px; }
    .pname { width: 14ch; }
    .thead { flex-wrap: wrap; gap: 8px; }
  }
</style>
