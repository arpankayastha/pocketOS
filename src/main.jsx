import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DialogProvider from './components/DialogProvider'
import { installSheetDrag } from './lib/sheetDrag'
import { applyTheme } from './lib/theme'

window.__gxStarted = true
// A code-split screen that can't load (its file was replaced by a newer deploy): repair once and reload.
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); window.__gxRecover?.() })
// Started fine: allow a future repair in this tab.
setTimeout(() => { try { sessionStorage.removeItem('gx.recovered') } catch { /* ignore */ } }, 30_000)

// Pick up new deploys without clearing site data: check for a new service worker when the app comes back
// to the front (and hourly); when the new one takes over, reload once so the screen is the new version.
if ('serviceWorker' in navigator) {
  const check = () => navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {})
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  setInterval(check, 10 * 60_000) // the counter PC never leaves the screen, so check often
  const hadController = !!navigator.serviceWorker.controller
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return
    reloaded = true
    // Don't throw away a form or sheet someone is using: reload as soon as nothing is open (checked every
    // 15 s — on the always-on counter PC the app is never hidden, so waiting for that would mean never).
    const busy = () => document.activeElement?.matches?.('input, textarea, select') || document.querySelector('.modal-bg, .dialog-bg')
    if (!busy()) location.reload()
    else { const t = setInterval(() => { if (!busy()) { clearInterval(t); location.reload() } }, 15_000) }
  })
}
installSheetDrag()
applyTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </StrictMode>,
)
