// Appearance: 'dark' (default), 'light', or 'system' (follows the phone). The choice is per device
// (localStorage) and applied as <html data-theme="dark|light">; index.html applies it before first paint
// with the same rules, so keep the two in sync.
const KEY = 'pocketos.theme'
const BG = { dark: '#1e2330', light: '#f3f4f6' }
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null

export function themePref() {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'system' ? v : 'dark' } catch { return 'dark' }
}

const resolve = (pref) => (pref === 'system' ? (media?.matches ? 'light' : 'dark') : pref)

export function applyTheme(pref = themePref()) {
  const t = resolve(pref)
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BG[t])
}

export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref) } catch { /* private mode: still applies for this visit */ }
  applyTheme(pref)
}

// "System" follows the phone switching between light and dark while the app is open.
media?.addEventListener?.('change', () => { if (themePref() === 'system') applyTheme('system') })
