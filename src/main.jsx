import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DialogProvider from './components/DialogProvider'
import { installSheetDrag } from './lib/sheetDrag'
import { applyTheme } from './lib/theme'

installSheetDrag()
applyTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </StrictMode>,
)
