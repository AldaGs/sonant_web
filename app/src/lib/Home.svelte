<script lang="ts">
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import { t, ui, setLang } from './i18n.svelte';
  import {
    listProjects, createProject, renameProject, duplicateProject, deleteProject,
    importProjectFile, saveProjectFile, storageInfo, requestPersist, type ProjectMeta,
  } from './projects';

  let projects = $state<ProjectMeta[]>([]);
  let loaded = $state(false);
  let error = $state('');
  let busy = $state(false);
  let renaming = $state<string | null>(null);
  let menu = $state<string | null>(null);
  let dragging = $state(false);
  let storage = $state<{ used: number; quota: number; persisted: boolean } | null>(null);

  async function refresh() {
    projects = await listProjects();
    storage = await storageInfo();
    loaded = true;
  }
  onMount(refresh);

  const open = (id: string) => (location.hash = '#/p/' + id);

  async function newProject() {
    open((await createProject()).id);
  }

  async function openFile(f: File | undefined | null) {
    if (!f) return;
    error = '';
    busy = true;
    try {
      open((await importProjectFile(f)).id);
    } catch (e) {
      error = (e as Error).message.startsWith('err.') ? (e as Error).message : 'err.badProject';
    } finally {
      busy = false;
    }
  }

  async function rename(p: ProjectMeta, value: string) {
    renaming = null;
    if (value.trim() !== p.name) await renameProject(p.id, value.trim());
    refresh();
  }

  async function duplicate(p: ProjectMeta) {
    menu = null;
    await duplicateProject(p.id, t('copySuffix'));
    refresh();
  }

  async function remove(p: ProjectMeta) {
    menu = null;
    if (!confirm(t('confirmDeleteProject', { name: p.name || t('untitled') }))) return;
    await deleteProject(p.id);
    refresh();
  }

  async function saveFile(p: ProjectMeta) {
    menu = null;
    await saveProjectFile(p.id, p.name, false).catch(() => (error = 'err.saveFile'));
  }

  async function protect() {
    await requestPersist();
    storage = await storageInfo();
  }

  const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function ago(ts: number) {
    const rtf = new Intl.RelativeTimeFormat(ui.lang, { numeric: 'auto' });
    const s = (ts - Date.now()) / 1000;
    for (const [unit, n] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]] as const)
      if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
    return rtf.format(0, 'minute');
  }
</script>

<svelte:window onclick={() => (menu = null)} />

<div class="home" role="region" aria-label={t('projects')} class:dragging
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={(e) => { e.preventDefault(); dragging = false; openFile(e.dataTransfer?.files[0]); }}>
  <header class="top">
    <div class="brand">
      <svg width="26" height="26" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="6" fill="#C8F560" />
        <g fill="none" stroke-linecap="round" stroke-width="5">
          <path d="M24 11A13 13 0 0 1 37 24M11 24A13 13 0 0 0 24 37" stroke="#C8F560" />
          <path d="M24 4A20 20 0 0 1 44 24M4 24A20 20 0 0 0 24 44" stroke="#707070" />
        </g>
      </svg>
      <span class="logo">Sonant</span>
    </div>
    <select class="lang" value={ui.lang} onchange={(e) => setLang(e.currentTarget.value as 'en' | 'es')} aria-label="Interface language / Idioma">
      <option value="en">EN</option>
      <option value="es">ES</option>
    </select>
  </header>

  <main>
    <div class="hero">
      <div>
        <h1>{t('projects')}</h1>
        <p class="muted">{t('homeHint')}</p>
      </div>
      <div class="acts">
        <label class="btn" class:disabled={busy}>
          {t('openProjectFile')}
          <input type="file" accept=".sonant" hidden disabled={busy} onchange={(e) => openFile(e.currentTarget.files?.[0])} />
        </label>
        <button class="primary" onclick={newProject}><Icon name="add" /> {t('newProject')}</button>
      </div>
    </div>
    {#if error}<p class="error">{t(error)}</p>{/if}

    {#if loaded && !projects.length}
      <div class="empty">
        <p>{t('noProjects')}</p>
        <button class="primary" onclick={newProject}><Icon name="add" /> {t('newProject')}</button>
      </div>
    {:else}
      <ul class="grid">
        {#each projects as p (p.id)}
          <li class="card">
            <button class="thumb" onclick={() => open(p.id)} aria-label={t('openProject', { name: p.name || t('untitled') })}>
              {#if p.thumb}<img src={p.thumb} alt="" />{:else}
                <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="6" fill="#3a3a3a" /><g fill="none" stroke="#3a3a3a" stroke-width="5" stroke-linecap="round"><path d="M24 11A13 13 0 0 1 37 24M11 24A13 13 0 0 0 24 37" /></g></svg>
              {/if}
              {#if p.duration}<span class="dur mono">{fmt(p.duration)}</span>{/if}
            </button>
            <div class="info">
              {#if renaming === p.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input class="rename" value={p.name} autofocus aria-label={t('projectName')}
                  onkeydown={(e) => { if (e.key === 'Enter') rename(p, e.currentTarget.value); if (e.key === 'Escape') renaming = null; }}
                  onblur={(e) => rename(p, e.currentTarget.value)} />
              {:else}
                <button class="name" onclick={() => open(p.id)}>{p.name || t('untitled')}</button>
              {/if}
              <span class="meta muted">{ago(p.updated)} · {t('clipsN', { n: p.clips })}</span>
            </div>
            <div class="more">
              <button class="sm icon" aria-label={t('projectActions', { name: p.name || t('untitled') })} aria-expanded={menu === p.id}
                onclick={(e) => { e.stopPropagation(); menu = menu === p.id ? null : p.id; }}><Icon name="more_horiz" /></button>
              {#if menu === p.id}
                <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
                <div class="menu" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()}>
                  <button role="menuitem" onclick={() => ((menu = null), (renaming = p.id))}>{t('rename')}</button>
                  <button role="menuitem" onclick={() => duplicate(p)}>{t('duplicate')}</button>
                  <button role="menuitem" onclick={() => saveFile(p)}>{t('saveFile')}</button>
                  <button role="menuitem" class="danger" onclick={() => remove(p)}>{t('del')}</button>
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if storage}
      <section class="storage">
        <div class="srow">
          <span>{t('storageUsed', { used: mb(storage.used), quota: mb(storage.quota) })}</span>
          <span class="badge" class:ok={storage.persisted}>{storage.persisted ? t('protected') : t('notProtected')}</span>
        </div>
        <div class="bar"><span style:width="{storage.quota ? Math.min(100, (storage.used / storage.quota) * 100) : 0}%"></span></div>
        <p class="muted small">{storage.persisted ? t('protectedHint') : t('notProtectedHint')}</p>
        {#if !storage.persisted}<button class="sm" onclick={protect}>{t('protect')}</button>{/if}
      </section>
    {/if}
  </main>
</div>

<style>
  .home { min-height: calc(100dvh / var(--ui-zoom)); border: 2px dashed transparent; }
  .home.dragging { border-color: var(--accent); }
  .top { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid var(--border-soft); }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { font-family: var(--display); font-weight: 700; font-size: 18px; }
  .lang { height: 36px; padding: 0 8px; }
  main { max-width: 1200px; margin: 0 auto; padding: 32px 24px 48px; display: grid; gap: 24px; }
  .hero { display: flex; justify-content: space-between; align-items: end; gap: 16px; flex-wrap: wrap; }
  h1 { font-family: var(--display); font-size: 28px; margin: 0 0 4px; }
  .hero p { margin: 0; }
  .acts { display: flex; gap: 8px; }
  .btn.disabled { opacity: .5; pointer-events: none; }
  .grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
  .card { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start;
    background: var(--panel); border: 1px solid var(--border-soft); border-radius: 12px; padding: 10px; }
  .card:hover { border-color: var(--border); }
  .thumb { grid-column: 1 / -1; position: relative; height: auto; aspect-ratio: 16 / 9; padding: 0; overflow: hidden;
    border-radius: 8px; border: 0; background: var(--surface); display: grid; place-items: center; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .thumb svg { width: 48px; height: 48px; }
  .thumb:focus-visible { outline: 2px solid var(--accent); }
  .dur { position: absolute; right: 6px; bottom: 6px; background: rgb(0 0 0 / .75); font-size: 11px; padding: 1px 5px; border-radius: 4px; }
  .info { display: grid; gap: 2px; min-width: 0; }
  .name { height: auto; padding: 0; border: 0; justify-content: flex-start; font-weight: 600; text-align: left;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
  .rename { height: 28px; padding: 2px 6px; font-weight: 600; }
  .meta { font-size: 12px; }
  .more { position: relative; }
  .menu { position: absolute; right: 0; top: 34px; z-index: 5; min-width: 150px; display: grid; padding: 4px;
    background: var(--raised); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 10px 30px rgb(0 0 0 / .5); }
  .menu button { height: 32px; border: 0; justify-content: flex-start; border-radius: 6px; font-size: 13px; }
  .menu button:hover { background: var(--tab-on); }
  .menu .danger { color: var(--danger); }
  .empty { display: grid; justify-items: center; gap: 12px; padding: 56px 16px; border: 1px dashed var(--border); border-radius: 12px; }
  .storage { display: grid; gap: 8px; padding: 14px 16px; background: var(--panel); border: 1px solid var(--border-soft); border-radius: 12px; max-width: 520px; }
  .srow { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; flex-wrap: wrap; }
  .badge { font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--raised); color: #ffb86b; }
  .badge.ok { color: var(--accent); }
  .bar { height: 6px; background: var(--surface); border-radius: 999px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); }
  .storage p { margin: 0; }
  .storage button { justify-self: start; }
  .small { font-size: 12px; }
  @media (max-width: 560px) { main { padding: 20px 16px 40px; } .acts { width: 100%; } .acts > * { flex: 1; } }
</style>
