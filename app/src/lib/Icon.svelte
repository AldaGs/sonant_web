<script lang="ts">
  import { ICONS, type IconName } from './icons';
  // Decorative icon: the button or link around it carries the accessible name.
  let { name, size = 18 }: { name: IconName; size?: number } = $props();
</script>

<span class="ic" style:--s="{size}px">{@html ICONS[name]}</span>

<style>
  .ic { display: inline-flex; width: var(--s); height: var(--s); flex: none; vertical-align: middle; line-height: 0; }
  .ic :global(svg) { width: 100%; height: 100%; }
</style>
