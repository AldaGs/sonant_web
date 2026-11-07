<script lang="ts">
  import { onMount } from 'svelte';
  import App from './App.svelte';
  import Home from './lib/Home.svelte';
  import Help from './lib/Help.svelte';
  import { listProjects, migrateLegacy, requestPersist } from './lib/projects';
  import { probe } from './lib/assets';
  import CrashReport from './lib/CrashReport.svelte';
  import { installHandlers, checkLastRun, logError, type Crash } from './lib/crash';

  installHandlers();
  // The tab died last time? (Out of memory during export, etc.) Say what was running.
  const found = checkLastRun();
  let crash = $state<Crash | null>(found);
  // Crashed while opening a project: don't open it again by itself (that could crash again in a loop).
  let held = $state<string | null>(found?.op === 'open' ? found.project ?? null : null);

  // Routes: #/ = home (project list), #/p/<id> = editor for that project, #/help = help page.
  const parse = () => location.hash.match(/^#\/p\/([\w-]+)$/)?.[1] ?? null;
  let id = $state<string | null>(null);
  let help = $state(false);
  let ready = $state(false);

  async function route() {
    help = location.hash === '#/help';
    if (help) return;
    const want = parse();
    // Unknown project ids (deleted, or a link from another browser) go back home.
    if (want && !(await listProjects()).some((p) => p.id === want)) return void (location.hash = '#/');
    if (want && want === held) return void (id = null); // shown on the home page with "Open anyway"
    id = want;
  }

  onMount(() => {
    (async () => {
      try {
        await migrateLegacy(probe); // one-time move from the old single-project storage
        requestPersist(); // ask the browser not to auto-delete projects
        await route();
      } catch (e) {
        logError(e, 'startup'); // never leave a blank page: show home and keep the error for the report
      } finally {
        ready = true;
      }
    })();
    window.addEventListener('hashchange', route);
    return () => window.removeEventListener('hashchange', route);
  });
</script>

<!-- No browser right-click menu, except in text fields (keeps copy/paste there). -->
<svelte:window oncontextmenu={(e) => !(e.target as Element).closest('input, textarea, [contenteditable]') && e.preventDefault()} />

{#if crash}
  <div class="crashwrap">
    <CrashReport {crash} onclose={() => (crash = null)}
      onopen={held ? () => { const p = held; held = null; crash = null; id = p; } : undefined} />
  </div>
{/if}
{#if ready}
  {#if help}
    <Help />
  {:else if id}
    <!-- If the editor fails to start or breaks, show what happened instead of a blank page. -->
    <svelte:boundary onerror={(e) => logError(e, 'editor')}>
      {#key id}<App projectId={id} />{/key}
      {#snippet failed(error)}
        <div class="crashwrap static"><CrashReport crash={null} {error} onclose={() => (location.hash = '#/')} /></div>
      {/snippet}
    </svelte:boundary>
  {:else}
    <Home />
  {/if}
{/if}

<style>
  .crashwrap { position: fixed; z-index: 100; left: 50%; transform: translateX(-50%); top: 12px; width: min(560px, calc(100% - 32px));
    background: var(--surface, #161616); border-radius: 12px; box-shadow: 0 8px 30px #0008; }
  .crashwrap.static { position: static; transform: none; margin: 24px auto; }
</style>
