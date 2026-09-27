import { useEffect, useRef } from 'react'

// Android back button / gesture for the installed PWA. Without this, "back" leaves the app
// (and the next open asks for the fingerprint again). Order on back:
//   1. close the top overlay (dialog, preview, modal form, menu)
//   2. the highest-level registered action (a module's tab → its first tab; a module → Budget)
//   3. at the root: first press shows a hint, a second press within 2 s really exits.
// We keep one extra history entry on top so each back press lands here instead of exiting.

const actions = [] // { level, ref }
const PUSH = () => history.pushState({ pocketos: true }, '')

export function useBackAction(active, fn, level = 1) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  useEffect(() => {
    if (!active) return
    const entry = { level, ref }
    actions.push(entry)
    return () => { const i = actions.indexOf(entry); if (i >= 0) actions.splice(i, 1) }
  }, [active, level])
}

// Closes the top-most overlay if there is one. Relies on the app's overlay conventions.
function closeTopOverlay() {
  if (document.querySelector('.dialog-bg')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return true
  }
  const menu = document.querySelector('.hh-backdrop, .fab-backdrop')
  if (menu) { menu.click(); return true }
  const preview = document.querySelector('.preview-screen .preview-bar button')
  if (preview) { preview.click(); return true }
  const modals = document.querySelectorAll('.modal-bg')
  if (modals.length) {
    modals[modals.length - 1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return true
  }
  return false
}

let installed = false

// Call once from the app shell. `onRootBack` shows the "press again to exit" hint.
export function useBackButton(onRootBack) {
  const hint = useRef(onRootBack)
  useEffect(() => { hint.current = onRootBack })
  useEffect(() => {
    if (installed) return
    installed = true
    PUSH()
    let lastRoot = 0
    const onPop = () => {
      if (closeTopOverlay()) return PUSH()
      const top = actions.reduce((best, a) => (!best || a.level >= best.level ? a : best), null)
      if (top) { top.ref.current(); return PUSH() }
      if (Date.now() - lastRoot < 2000) return history.back() // really leave
      lastRoot = Date.now()
      hint.current?.()
      PUSH()
    }
    window.addEventListener('popstate', onPop)
    return () => { window.removeEventListener('popstate', onPop); installed = false }
  }, [])
}
