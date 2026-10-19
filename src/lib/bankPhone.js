// Pairing the GRANDXGAMER Android app on the café's phone (it reads the bank's "money received" SMS).
// See ⚙ → Bank SMS phone (ShopSettings) and supabase/functions/bank-sms. The code is shown once; only its
// SHA-256 is stored.
export const ANDROID_PACKAGE = 'app.grandxgamer'
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32: no I, L, O, U

export function newPairCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('')
}

export async function pairCodeHash(code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.toUpperCase().replace(/[^0-9A-Z]/g, '')))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Opens the app's pairing screen with the code filled in; without the app, Chrome goes to the download page.
export function pairIntentUrl(code) {
  const fallback = encodeURIComponent(`${location.origin}/download/`)
  return `intent://pair?code=${code}#Intent;scheme=grandxgamer;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`
}
