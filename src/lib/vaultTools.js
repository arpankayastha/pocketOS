// Helpers for the Vault's extras: TOTP codes, password generator, LastPass CSV import,
// and the Pwned Passwords breach check.

// ---------- TOTP (RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0, value = 0
  const out = []
  for (const ch of clean) {
    const v = B32.indexOf(ch)
    if (v < 0) throw new Error('Invalid 2FA secret (expected base32).')
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

// Accepts a bare base32 secret or an otpauth://totp/... URI.
export function parseTotp(input) {
  const s = (input || '').trim()
  if (!s) return null
  if (s.toLowerCase().startsWith('otpauth://')) {
    const url = new URL(s)
    const p = url.searchParams
    return {
      secret: base32Decode(p.get('secret') || ''),
      digits: Number(p.get('digits')) || 6,
      period: Number(p.get('period')) || 30,
      algorithm: ({ SHA256: 'SHA-256', SHA512: 'SHA-512' })[(p.get('algorithm') || '').toUpperCase()] || 'SHA-1',
    }
  }
  return { secret: base32Decode(s), digits: 6, period: 30, algorithm: 'SHA-1' }
}

export async function totpCode(cfg, now = Date.now()) {
  const counter = Math.floor(now / 1000 / cfg.period)
  const msg = new Uint8Array(8)
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter))
  const key = await crypto.subtle.importKey('raw', cfg.secret, { name: 'HMAC', hash: cfg.algorithm }, false, ['sign'])
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const o = h[h.length - 1] & 15
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 10 ** cfg.digits).padStart(cfg.digits, '0')
}

// ---------- Password generator ----------
const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%^&*-_=+?',
}
// Look-alikes (l/1/I, O/0) are left out of the sets above so passwords are easy to read and type.

function randomIndex(n) {
  // Rejection sampling: avoid modulo bias.
  const limit = Math.floor(0x100000000 / n) * n
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf); while (buf[0] >= limit)
  return buf[0] % n
}

export function generatePassword({ length = 20, lower = true, upper = true, digits = true, symbols = true } = {}) {
  const sets = Object.entries({ lower, upper, digits, symbols }).filter(([, on]) => on).map(([k]) => SETS[k])
  if (!sets.length) sets.push(SETS.lower)
  const all = sets.join('')
  // Guarantee one character from every chosen set, then fill and shuffle.
  const chars = sets.map((s) => s[randomIndex(s.length)])
  while (chars.length < length) chars.push(all[randomIndex(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.slice(0, length).join('')
}

// Rough strength estimate in bits, for the meter.
export function passwordBits(pw) {
  if (!pw) return 0
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/[0-9]/.test(pw)) pool += 10
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 20
  return Math.round(pw.length * Math.log2(pool || 1))
}

// ---------- CSV (RFC 4180: quotes, escaped quotes, newlines inside quotes) ----------
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f.trim()))
}

// LastPass export columns: url,username,password,totp,extra,name,grouping,fav
// Secure notes (url "http://sn") are passed to `parseNote(extra)` if given, which returns
// the typed fields (see typedFromLastPassNote in vaultTypes); otherwise they become plain notes.
export function itemsFromLastPassCsv(text, parseNote) {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''))
  if (!header) return []
  const col = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]))
  if (col.password === undefined || col.url === undefined) throw new Error("This doesn't look like a LastPass CSV export (no url/password columns).")
  const get = (r, k) => (col[k] === undefined ? '' : (r[col[k]] || '').trim())
  return rows.map((r) => {
    if (get(r, 'url') === 'http://sn') {
      const typed = parseNote ? parseNote(get(r, 'extra')) : { type: 'note', notes: get(r, 'extra') }
      return { title: get(r, 'name') || 'Untitled', folder: get(r, 'grouping'), ...typed }
    }
    const url = get(r, 'url')
    return {
      type: 'password',
      title: get(r, 'name') || hostOf(url) || 'Untitled',
      url,
      username: get(r, 'username'),
      password: get(r, 'password'),
      totp: get(r, 'totp'),
      notes: get(r, 'extra'),
      folder: get(r, 'grouping'),
    }
  })
}

export function hostOf(url) {
  if (!url) return ''
  try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '') } catch { return '' }
}

// ---------- Pwned Passwords (k-anonymity) ----------
// Only the first 5 hex chars of the password's SHA-1 leave the device; the match is done locally.
export async function pwnedCount(password) {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))))
    .map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } })
  if (!res.ok) throw new Error(`Breach check failed (${res.status}).`)
  const suffix = hash.slice(5)
  for (const line of (await res.text()).split('\n')) {
    const [s, count] = line.trim().split(':')
    if (s === suffix) return Number(count)
  }
  return 0
}

// ---------- Clipboard ----------
let clearTimer = null

// Copies a secret and clears the clipboard after `clearAfterMs`, unless the user has
// copied something else since (when the browser lets us read the clipboard to check).
export async function copySecret(text, clearAfterMs = 30_000) {
  await navigator.clipboard.writeText(text)
  clearTimeout(clearTimer)
  clearTimer = setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText()
      if (current !== text) return
    } catch { /* can't read — clear anyway */ }
    try { await navigator.clipboard.writeText('') } catch { /* page not focused; nothing we can do */ }
  }, clearAfterMs)
}
