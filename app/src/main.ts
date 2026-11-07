import { mount } from 'svelte'
import './app.css'
import Root from './Root.svelte'

// Block browser page zoom: Ctrl/⌘+wheel (trackpad pinch), Safari gesture events and two-finger pinch.
// The timeline handles these itself (pinch zooms it, scroll scrubs).
addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }, { passive: false })
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) addEventListener(t, (e) => e.preventDefault(), { passive: false })
addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })

const app = mount(Root, {
  target: document.getElementById('app')!,
})

export default app
