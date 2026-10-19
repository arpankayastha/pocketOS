// Pairing the eChopdo Android app (quick-add widget) with a household. See PhoneWidget.jsx and
// supabase/functions/quickadd. The code is shown once; only its SHA-256 is stored.
export const ANDROID_PACKAGE = 'app.echopdo'
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32: no I, L, O, U

export function newPairCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('')
}

export async function pairCodeHash(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.toUpperCase().replace(/[^0-9A-Z]/g, '')))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Opens the Android app's pairing screen with the code filled in; without the app, Chrome
// falls back to the download page.
export function pairIntentUrl(code) {
  const fallback = encodeURIComponent(`${location.origin}/download/`)
  return `intent://pair?code=${code}#Intent;scheme=echopdo;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`
}

// Opens the Android app's own Phone settings (pairing, widgets, bank SMS).
export function phoneSettingsUrl() {
  const fallback = encodeURIComponent(`${location.origin}/download/`)
  return `intent://pair#Intent;scheme=echopdo;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`
}

// A phone that pairs again (reinstall, cleared data) leaves its old row behind with a dead token. Of the paired rows
// with the same household and phone name, only the newest pairing is kept; these are the ids of the older ones.
// (Two different phones of the same model in one household would look like one — pair the second under another
// household or accept re-pairing the older one.)
export function supersededIds(devices) {
  const newest = new Map()
  for (const d of devices) {
    if (!d.paired_at) continue
    const k = `${d.household_id}|${d.name || ''}`
    const cur = newest.get(k)
    if (!cur || d.paired_at > cur.paired_at) newest.set(k, d)
  }
  return devices.filter((d) => d.paired_at && newest.get(`${d.household_id}|${d.name || ''}`).id !== d.id).map((d) => d.id)
}
