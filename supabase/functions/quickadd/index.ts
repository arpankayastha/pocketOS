// Quick add from the eChopdo Android app (home-screen widget, quick-settings tile, shortcut).
// No user JWT: a paired phone holds a device token (see public.quick_devices). The token can
// only add entries to its one household, undo its own recent ones, and read the names the
// pickers need. Deployed with verify_jwt = false; every action checks the token itself.
//   { action: 'pair', code, name }           → { token, household }
//   { action: 'config', token }              → pickers + frequent entries
//   { action: 'add', token, target, ... }    → { id }
//   { action: 'undo', token, target, id }    → { ok }
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Same starting set as src/lib/hisab.js, for a household that hasn't opened Hisab yet.
const OUT = [['Shopping', '🛍️'], ['Clothes', '👗'], ['Food', '🍽️'], ['Groceries', '🥦'], ['Sweets', '🍬'], ['Gifts', '🎁'], ['Puja', '🪔'], ['Decor', '🎉'], ['Flowers', '💐'], ['Travel', '🚕'], ['Fuel', '⛽'], ['Beauty', '💄'], ['Medical', '💊'], ['Home', '🏠'], ['Other', '📦']]
const IN = [['Shagun', '🧧'], ['Gift', '🎁'], ['Refund', '↩️'], ['Cash in', '💵'], ['Other', '📦']]
const SOURCES = ['Cash', 'UPI', 'Card']
const UNDO_MS = 15 * 60_000

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const clean = (s: unknown, max = 200) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null)
function amountOf(v: unknown) {
  const n = Math.round(Number(v) * 100) / 100
  return Number.isFinite(n) && n > 0 && n < 1e10 ? n : null
}
// "Today" in India, where the family lives (the phone also sends its own date).
const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const action = body.action

  if (action === 'pair') {
    const code = String(body.code || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    if (code.length < 6) return json({ error: 'Enter the code shown in eChopdo.' }, 400)
    const { data: dev } = await db.from('quick_devices').select('id, household_id, pair_expires, token_hash')
      .eq('pair_code_hash', await sha256(code)).maybeSingle()
    if (!dev || dev.token_hash || !dev.pair_expires || new Date(dev.pair_expires).getTime() < Date.now()) {
      return json({ error: 'That code has expired or is wrong. Make a new one in eChopdo → Settings → Phone widget.' }, 400)
    }
    const token = randomToken()
    const { error } = await db.from('quick_devices').update({
      token_hash: await sha256(token), pair_code_hash: null, pair_expires: null, paired_at: new Date().toISOString(),
      name: clean(body.name, 60) || 'Phone',
    }).eq('id', dev.id)
    if (error) return json({ error: error.message }, 500)
    const { data: hh } = await db.from('households').select('name').eq('id', dev.household_id).single()
    return json({ token, household: hh?.name || '' })
  }

  // Every other action needs a paired device.
  const token = String(body.token || '')
  if (!token) return json({ error: 'This phone is not paired.' }, 401)
  const { data: dev } = await db.from('quick_devices').select('id, user_id, household_id, default_target, name')
    .eq('token_hash', await sha256(token)).maybeSingle()
  if (!dev) return json({ error: 'This phone was removed from eChopdo. Pair it again.', unpaired: true }, 401)
  const hid = dev.household_id
  await db.from('quick_devices').update({ last_used_at: new Date().toISOString() }).eq('id', dev.id)

  async function dailyBook() {
    const { data } = await db.from('hisab_books').select('id').eq('household_id', hid).eq('kind', 'daily').order('created_at').limit(1)
    if (data?.length) return data[0].id
    const { data: made, error } = await db.from('hisab_books').insert({ household_id: hid, user_id: dev!.user_id, name: 'Daily', kind: 'daily' }).select('id').single()
    if (error) throw error
    return made.id
  }

  if (action === 'config') {
    const since = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
    const [hh, books, hcats, cats, accts, recent] = await Promise.all([
      db.from('households').select('name, color').eq('id', hid).single(),
      db.from('hisab_books').select('id, name, kind, created_at').eq('household_id', hid).order('created_at'),
      db.from('hisab_categories').select('direction, name, icon, position').eq('household_id', hid).order('position'),
      db.from('categories').select('id, name, kind, color').eq('household_id', hid).order('name'),
      db.from('accounts').select('id, name, color').eq('household_id', hid).order('name'),
      db.from('hisab_entries').select('direction, amount, category, source, book_id').eq('household_id', hid).gte('occurred_on', since).limit(2000),
    ])
    let bookList = books.data || []
    if (!bookList.some((b) => b.kind === 'daily')) { await dailyBook(); bookList = (await db.from('hisab_books').select('id, name, kind, created_at').eq('household_id', hid).order('created_at')).data || [] }
    bookList.sort((a, b) => (a.kind === 'daily' ? -1 : b.kind === 'daily' ? 1 : b.created_at.localeCompare(a.created_at)))
    const hc = hcats.data || []
    const pick = (dir: string, fallback: string[][]) => {
      const rows = hc.filter((c) => c.direction === dir)
      return rows.length ? rows.map((c) => ({ name: c.name, icon: c.icon })) : fallback.map(([name, icon]) => ({ name, icon }))
    }
    const outCats = pick('out', OUT), inCats = pick('in', IN)
    // Frequent entries: the same category + amount seen at least twice recently (Hisab only).
    const counts = new Map<string, { direction: string, amount: number, category: string, source: string | null, n: number }>()
    const sources = new Map<string, number>()
    for (const e of recent.data || []) {
      if (e.source) sources.set(e.source, (sources.get(e.source) || 0) + 1)
      if (!e.category) continue
      const k = `${e.direction}|${e.category}|${Number(e.amount)}`
      const c = counts.get(k) || { direction: e.direction, amount: Number(e.amount), category: e.category, source: e.source, n: 0 }
      c.n++; counts.set(k, c)
    }
    const icons = new Map([...outCats, ...inCats].map((c) => [c.name.toLowerCase(), c.icon]))
    const frequent = [...counts.values()].filter((c) => c.n >= 2).sort((a, b) => b.n - a.n).slice(0, 4)
      .map((c) => ({ ...c, icon: icons.get(c.category.toLowerCase()) || '🏷️' }))
    const sourceList = [...new Set([...SOURCES, ...[...sources.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)])]
    return json({
      device: { name: dev.name, default_target: dev.default_target },
      household: { name: hh.data?.name || '', color: hh.data?.color || null },
      hisab: { books: bookList.map((b) => ({ id: b.id, name: b.name, kind: b.kind })), out: outCats, in: inCats, sources: sourceList },
      budget: {
        expense: (cats.data || []).filter((c) => c.kind === 'expense').map(({ id, name, color }) => ({ id, name, color })),
        income: (cats.data || []).filter((c) => c.kind === 'income').map(({ id, name, color }) => ({ id, name, color })),
        accounts: accts.data || [],
      },
      frequent,
      today: todayIST(),
    })
  }

  if (action === 'add') {
    const amount = amountOf(body.amount)
    if (!amount) return json({ error: 'Enter an amount.' }, 400)
    const date = isDate(body.date) ? body.date as string : todayIST()
    const note = clean(body.note, 500)
    if (body.target === 'budget') {
      const kind = body.kind === 'income' ? 'income' : 'expense'
      // Only ids from this household are accepted.
      const catId = clean(body.category_id, 64), acctId = clean(body.account_id, 64)
      if (catId) { const { data } = await db.from('categories').select('id').eq('id', catId).eq('household_id', hid).eq('kind', kind).maybeSingle(); if (!data) return json({ error: 'Unknown category.' }, 400) }
      if (acctId) { const { data } = await db.from('accounts').select('id').eq('id', acctId).eq('household_id', hid).maybeSingle(); if (!data) return json({ error: 'Unknown account.' }, 400) }
      const { data, error } = await db.from('transactions').insert({
        user_id: dev.user_id, household_id: hid, kind, amount, occurred_on: date, note, category_id: catId, account_id: acctId,
      }).select('id').single()
      if (error) return json({ error: error.message }, 500)
      return json({ id: data.id, target: 'budget' })
    }
    const direction = body.direction === 'in' ? 'in' : 'out'
    let bookId = clean(body.book_id, 64)
    if (bookId) { const { data } = await db.from('hisab_books').select('id').eq('id', bookId).eq('household_id', hid).maybeSingle(); if (!data) bookId = null }
    try { bookId = bookId || await dailyBook() } catch (e) { return json({ error: String((e as Error).message || e) }, 500) }
    const { data, error } = await db.from('hisab_entries').insert({
      user_id: dev.user_id, household_id: hid, book_id: bookId, direction, amount, occurred_on: date,
      category: clean(body.category, 60), source: clean(body.source, 40), note,
    }).select('id').single()
    if (error) return json({ error: error.message }, 500)
    return json({ id: data.id, target: 'hisab' })
  }

  if (action === 'undo') {
    const id = clean(body.id, 64)
    const table = body.target === 'budget' ? 'transactions' : 'hisab_entries'
    const { data: row } = await db.from(table).select('id, created_at').eq('id', id || '').eq('household_id', hid).eq('user_id', dev.user_id).maybeSingle()
    if (!row || Date.now() - new Date(row.created_at).getTime() > UNDO_MS) return json({ error: 'Too late to undo here — edit it in eChopdo.' }, 400)
    const { error } = await db.from(table).delete().eq('id', row.id)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  return json({ error: 'Unknown action.' }, 400)
})
