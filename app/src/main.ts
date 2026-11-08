import { mount } from 'svelte'
import './app.css'
import Root from './Root.svelte'

// Block browser page zoom: Ctrl/⌘+wheel (trackpad pinch), Safari gesture events and two-finger pinch.
// The timeline handles these itself (pinch zooms it, scroll scrubs).
addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }, { passive: false })
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) addEventListener(t, (e) => e.preventDefault(), { passive: false })
addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })

// Range sliders paint their filled part from --p; keep it in sync however the value changes
// (user drag, or Svelte setting .value programmatically).
const fill = (el: HTMLInputElement) => {
  const min = +el.min || 0, max = el.max === '' ? 100 : +el.max, v = +el.value
  el.style.setProperty('--p', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`)
}
const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
Object.defineProperty(HTMLInputElement.prototype, 'value', {
  ...desc,
  set(v) { desc.set!.call(this, v); if (this.type === 'range') fill(this) },
})
addEventListener('input', (e) => { const el = e.target as HTMLInputElement; if (el?.type === 'range') fill(el) }, true)
new MutationObserver((ms) => {
  for (const m of ms) {
    if (m.type === 'attributes') { const el = m.target as HTMLInputElement; if (el.type === 'range') fill(el); continue }
    for (const n of m.addedNodes) if (n instanceof Element)
      for (const el of n.matches('input[type=range]') ? [n] : n.querySelectorAll('input[type=range]')) fill(el as HTMLInputElement)
  }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['min', 'max', 'value'] })

const app = mount(Root, {
  target: document.getElementById('app')!,
})

export default app
