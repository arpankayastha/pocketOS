import { useState } from 'react'
import { copySecret } from '../lib/vaultTools'

// Share ready-made text: straight to WhatsApp, through the phone's share sheet, or onto the clipboard.
// The text is editable first. `secret` (a vault note) clears the clipboard after 30 s like other copied secrets.
export default function ShareSheet({ title, text: initial, secret = false, extra = null, onClose }) {
  const [text, setText] = useState(initial)
  const [msg, setMsg] = useState(null)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const toWhatsApp = () => { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener') }
  async function native() {
    try { await navigator.share({ text }) } catch (e) { if (e?.name !== 'AbortError') setMsg("Couldn't open the share sheet.") }
  }
  async function copy() {
    try {
      if (secret) await copySecret(text); else await navigator.clipboard.writeText(text)
      setMsg(secret ? 'Copied — clipboard clears in 30s' : 'Copied')
    } catch { setMsg("Couldn't copy — select the text and copy it.") }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal share-sheet">
        <h3>{title}</h3>
        {extra}
        <textarea className="share-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} aria-label="Text to share" />
        {msg && <div className="muted small">{msg}</div>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={copy}>Copy</button>
          {canShare && <button type="button" className="btn" onClick={native}>Share…</button>}
          <button type="button" className="btn primary" onClick={toWhatsApp}>WhatsApp</button>
        </div>
      </div>
    </div>
  )
}
