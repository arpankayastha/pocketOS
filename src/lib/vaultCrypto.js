// Client-side crypto for the Vault module (Web Crypto only, no dependencies).
//
// Model: one random 256-bit vault key encrypts every item (AES-GCM). The vault key
// itself is only ever stored *wrapped* by a key-encryption key (KEK) derived from
// an unlocker: master password (PBKDF2), recovery code (HKDF) or a device
// fingerprint (WebAuthn PRF output → HKDF). Supabase never sees plaintext.

const enc = new TextEncoder()
const dec = new TextDecoder()
const subtle = globalThis.crypto.subtle

export const PBKDF2_ITERATIONS = 600_000 // OWASP 2023 recommendation for PBKDF2-HMAC-SHA256
const WRAP_AAD = enc.encode('pocketos-vault-key-v1')

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function toB64(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromB64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0))
}

export function toB64Url(bytes) {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64Url(str) {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : ''
  return fromB64(str.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

async function aesKey(raw, usages) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages)
}

export async function kekFromPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// For high-entropy secrets (recovery code bytes, WebAuthn PRF output) — no stretching needed.
export async function kekFromSecret(secret, salt, info) {
  const base = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function wrapVaultKey(rawVaultKey, kek) {
  const iv = randomBytes(12)
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: WRAP_AAD }, kek, rawVaultKey)
  return { iv: toB64(iv), wrapped_key: toB64(new Uint8Array(ct)) }
}

// Throws (OperationError) when the KEK is wrong — that's how a bad password is detected.
export async function unwrapVaultKey({ iv, wrapped_key }, kek) {
  const raw = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: WRAP_AAD }, kek, fromB64(wrapped_key))
  return new Uint8Array(raw)
}

export async function importVaultKey(raw) {
  return aesKey(raw, ['encrypt', 'decrypt'])
}

// Item id is bound as associated data so ciphertexts can't be swapped between rows.
export async function encryptItem(vaultKey, id, data) {
  const iv = randomBytes(12)
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(id) }, vaultKey, enc.encode(JSON.stringify(data)))
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(ct)) }
}

export async function decryptItem(vaultKey, row) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(row.iv), additionalData: enc.encode(row.id) }, vaultKey, fromB64(row.ciphertext))
  return JSON.parse(dec.decode(pt))
}

// Recovery code: 20 random bytes (160 bits) as 32 Crockford base32 chars, shown as 8 groups of 4.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateRecoveryCode() {
  const bytes = randomBytes(20)
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out.match(/.{4}/g).join('-')
}

// Normalises user input (case, dashes, spaces, easily-confused letters) back to bytes.
export function recoveryCodeBytes(code) {
  const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (clean.length !== 32) throw new Error('A recovery code has 32 characters.')
  let bits = 0, value = 0
  const out = []
  for (const ch of clean) {
    const v = B32.indexOf(ch)
    if (v < 0) throw new Error('That recovery code contains an invalid character.')
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}
