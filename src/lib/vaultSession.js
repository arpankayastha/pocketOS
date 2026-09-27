// Keeps an unlocked vault unlocked across a reload / pull-to-refresh — but not across closing
// the app, and not after the idle / background limits.
//
// The raw vault key is stored only *encrypted*, in sessionStorage (cleared when the app or tab
// is closed), with a random AES key that is NON-EXTRACTABLE and kept in IndexedDB — so the
// stored blob alone is useless, and the wrapping key can be used but never read out. Both are
// wiped on lock. Activity and "went to background" times are kept alongside, so a reload after
// the idle (5 min) or background (60 s) limit asks for the fingerprint again.

const DB = 'pocketos'
const STORE = 'session'
const BLOB = 'pocketos.vaultSession' // sessionStorage: { uid, iv, data, active, hiddenAt }

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbDo(mode, fn) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); resolve(req?.result) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

const b64 = (u8) => btoa(String.fromCharCode(...u8))
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const read = () => { try { return JSON.parse(sessionStorage.getItem(BLOB)) } catch { return null } }
const write = (v) => { try { sessionStorage.setItem(BLOB, JSON.stringify(v)) } catch { /* ignore */ } }

export async function saveVaultSession(uid, raw) {
  try {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await idbDo('readwrite', (s) => s.put(key, 'wrap'))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw))
    write({ uid, iv: b64(iv), data: b64(data), active: Date.now(), hiddenAt: null })
  } catch { clearVaultSession() }
}

// Returns the raw vault key if this tab's session is still fresh, else null (and clears it).
export async function restoreVaultSession(uid, { idleMs, backgroundMs }) {
  const s = read()
  if (!s || s.uid !== uid) return null
  const now = Date.now()
  if (now - s.active > idleMs || (s.hiddenAt && now - s.hiddenAt > backgroundMs)) { clearVaultSession(); return null }
  try {
    const key = await idbDo('readonly', (st) => st.get('wrap'))
    if (!key) return null
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, key, unb64(s.data)))
  } catch { clearVaultSession(); return null }
}

export function markVaultActive() { const s = read(); if (s) write({ ...s, active: Date.now(), hiddenAt: null }) }
export function markVaultHidden() { const s = read(); if (s) write({ ...s, hiddenAt: Date.now() }) }

export function clearVaultSession() {
  try { sessionStorage.removeItem(BLOB) } catch { /* ignore */ }
  idbDo('readwrite', (s) => s.delete('wrap')).catch(() => {})
}
