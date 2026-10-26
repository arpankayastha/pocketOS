import { useEffect, useState } from 'react'

// "Hide amounts" (the eye beside the Home greeting): masks every number on Home until tapped again.
// Remembered on this phone; every open screen follows the change.
const KEY = 'pocketos.hideAmounts'
const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

export function useHideAmounts() {
  const [hidden, setHidden] = useState(read)
  useEffect(() => {
    const sync = () => setHidden(read())
    window.addEventListener('hide-amounts-changed', sync)
    return () => window.removeEventListener('hide-amounts-changed', sync)
  }, [])
  const toggle = () => {
    const next = !read()
    try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* ignore */ }
    setHidden(next)
    window.dispatchEvent(new Event('hide-amounts-changed'))
  }
  return [hidden, toggle]
}
export const MASK = '₹ ••••'
