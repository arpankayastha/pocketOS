import { useEffect, useState } from 'react'

// The signed-in app's place lives in the address (owner: "on refresh it should stay on the same page"):
//   #/shop/slots · #/money/cashbook · #/vault/items · #/shop/settings (internal ids get plain-English slugs)
// Level 0 = module, level 1 = its tab. The address is updated with replaceState (no new history entry), so the
// Android back button handling in backNav.js is unchanged. Public pages keep their own hashes (#book, #jobs…).
const SLUG = { budget: 'money', hisab: 'cashbook', floor: 'slots', dashboard: 'home', transactions: 'entries' }
const ID = Object.fromEntries(Object.entries(SLUG).map(([k, v]) => [v, k]))
export const routeParts = () => (location.hash.startsWith('#/') ? location.hash.slice(2).split('/').map((p) => { const v = decodeURIComponent(p); return ID[v] || v }) : [])

function writePart(level, value) {
  // A tab left over from another module is harmless: on load it's checked against that module's tabs.
  const parts = routeParts()
  parts[level] = value
  for (let i = 0; i < level; i++) parts[i] = parts[i] || ''
  const next = `#/${parts.map((p) => encodeURIComponent(SLUG[p] || p)).join('/')}`
  if (next !== location.hash) history.replaceState(history.state, '', next)
}

// useState whose value is mirrored into the address at `level`; starts from the address when it's valid.
export function useRouteState(level, fallback, valid) {
  const [value, setValue] = useState(() => {
    const v = routeParts()[level]
    return v && valid(v) ? v : (typeof fallback === 'function' ? fallback() : fallback)
  })
  useEffect(() => { writePart(level, value) }, [level, value])
  return [value, setValue]
}

// Whether the address named this level when the app opened (so defaults don't override a refresh).
export const routeHas = (level) => !!routeParts()[level]
