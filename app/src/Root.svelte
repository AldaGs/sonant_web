<script lang="ts">
  import { onMount } from 'svelte';
  import App from './App.svelte';
  import Home from './lib/Home.svelte';
  import Help from './lib/Help.svelte';
  import { listProjects, migrateLegacy, requestPersist } from './lib/projects';
  import { probe } from './lib/assets';

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
    id = want;
  }

  onMount(() => {
    (async () => {
      await migrateLegacy(probe); // one-time move from the old single-project storage
      requestPersist(); // ask the browser not to auto-delete projects
      await route();
      ready = true;
    })();
    window.addEventListener('hashchange', route);
    return () => window.removeEventListener('hashchange', route);
  });
</script>

<!-- No browser right-click menu, except in text fields (keeps copy/paste there). -->
<svelte:window oncontextmenu={(e) => !(e.target as Element).closest('input, textarea, [contenteditable]') && e.preventDefault()} />

{#if ready}
  {#if help}
    <Help />
  {:else if id}
    {#key id}<App projectId={id} />{/key}
  {:else}
    <Home />
  {/if}
{/if}
