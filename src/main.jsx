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

installSheetDrag()
applyTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </StrictMode>,
)
