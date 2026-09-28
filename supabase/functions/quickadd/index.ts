// Quick add from the eChopdo Android app (home-screen widget, quick-settings tile, shortcut).
// No user JWT: a paired phone holds a device token (see public.quick_devices). The token can
// only add entries to its one household, undo its own recent ones, and read the names the
// pickers need. Deployed with verify_jwt = false; every action checks the token itself.
//   { action: 'pair', code, name }           → { token, household }
//   { action: 'config', token }              → pickers + frequent entries
//   { action: 'add', token, target, ... }    → { id }
//   { action: 'undo', token, target, id }    → { ok }
//   { action: 'capture', token, direction, amount, date, account_hint, card, payee, ref, bank }
//                                            → a bank SMS read on the phone (the SMS itself never
//                                              leaves it) → { id, suggestion, match } | { duplicate }
//   { action: 'file' | 'ignore' | 'match', token, capture_id, … } → file / drop a capture
//   { action: 'refile', token, capture_id, target, … } → change an auto-added capture (learns the payee)
//   { action: 'unfile', token, capture_id }  → remove an auto-added entry (capture ignored)
// With the phone's auto_capture on (default), a capture is filed on arrival: the payee's
// remembered category, else a guess from the payee's name, else "Other"; note = UPI id / name.
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
// Payee name → Hisab category, for payees seen for the first time (only names the household has).
const GUESS: [RegExp, string][] = [
  [/swiggy|zomato|restaurant|resto|cafe|caf[eé]|dhaba|pizza|burger|kfc|mcdonald|domino|bakery|bakers|sweets?\b|mithai|food|eats|chai|tea ?stall|juice|canteen|mess\b/i, 'Food'],
  [/blinkit|zepto|instamart|bigbasket|big basket|dmart|d-mart|jiomart|grocer|kirana|provision|supermarket|super market|\bmart\b|dairy|milk|vegetable|sabji|fruit/i, 'Groceries'],
  [/petrol|fuel|hpcl|iocl|bpcl|indian ?oil|bharat ?petro|hindustan ?petro|nayara|filling ?st|service ?st/i, 'Fuel'],
  [/pharma|medical|medicos|chemist|apollo|medplus|hospital|clinic|diagnostic|patholog|\blab\b|netmeds|1mg|pharmeasy|doctor|dr\.? /i, 'Medical'],
  [/irctc|railw|uber|\bola\b|rapido|redbus|metro|makemytrip|goibibo|indigo|air ?india|airline|travels?\b|\bcab\b|taxi|toll|fastag|parking/i, 'Travel'],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|snapdeal|\bshop\b|shopping|\bstores?\b|\bmall\b|retail|electronics|mobile/i, 'Shopping'],
  [/cloth|garment|fashion|textile|saree|sari|boutique|tailor/i, 'Clothes'],
  [/salon|parlou?r|beauty|\bspa\b|cosmetic/i, 'Beauty'],
  [/flower|florist|phool/i, 'Flowers'],
  [/pooja|puja|temple|mandir|trust/i, 'Puja'],
  [/gift/i, 'Gifts'],
  [/electric|torrent|power|\bgas\b|water|broadband|airtel|\bjio\b|vodafone|\bvi\b|recharge|\bbill|society|maintenance|rent\b/i, 'Home'],
]
function guessName(payee: string | null, direction: string) {
  const p = payee || ''
  if (direction === 'in') return /refund|reversal|cashback/i.test(p) ? 'Refund' : 'Cash in'
  return GUESS.find(([re]) => re.test(p))?.[1] || 'Other'
}

const payeeKey = (p: string) => 'payee:' + p.trim().toLowerCase()
const acctKey = (bank: string | null, hint: string) => `acct:${(bank || '').toLowerCase()}:${hint}`

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
  const { data: dev } = await db.from('quick_devices').select('id, user_id, household_id, default_target, name, auto_capture')
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

  // Names the phone needs to show a capture's suggestion ("🍽️ Food", "Bills").
  async function pickerNames() {
    const [hc, cats] = await Promise.all([
      db.from('hisab_categories').select('direction, name, icon').eq('household_id', hid),
      db.from('categories').select('id, name, kind').eq('household_id', hid),
    ])
    const icons = new Map<string, string>([...OUT, ...IN].map(([n, i]) => [n.toLowerCase(), i]))
    for (const c of hc.data || []) icons.set(c.name.toLowerCase(), c.icon)
    const hisab = { out: (hc.data || []).filter((c) => c.direction === 'out').map((c) => c.name), in: (hc.data || []).filter((c) => c.direction === 'in').map((c) => c.name) }
    if (!hisab.out.length) hisab.out = OUT.map(([n]) => n)
    if (!hisab.in.length) hisab.in = IN.map(([n]) => n)
    return { icons, cats: new Map((cats.data || []).map((c) => [c.id, c.name])), hisab, budget: cats.data || [] }
  }
  type Capture = { id: string, direction: string, amount: number, occurred_on: string, account_hint: string | null, card: boolean,
    payee: string | null, bank: string | null, match_target: string | null, match_entry_id: string | null }
  async function decorate(list: Capture[]) {
    if (!list.length) return []
    const { data: rules } = await db.from('capture_rules').select('key, target, category, category_id, account_id, source, book_id, hits, auto').eq('household_id', hid)
    const byKey = new Map((rules || []).map((r) => [r.key, r]))
    const names = await pickerNames()
    return list.map((c) => {
      const r = c.payee ? byKey.get(payeeKey(c.payee)) : undefined
      const a = c.account_hint ? byKey.get(acctKey(c.bank, c.account_hint)) : undefined
      const suggestion = r?.target ? {
        target: r.target, category: r.category, category_id: r.category_id, account_id: r.account_id || a?.account_id || null,
        source: r.source, book_id: r.book_id, auto: r.auto, hits: r.hits,
        label: r.target === 'budget' ? (names.cats.get(r.category_id) || 'Budget') : r.category || 'Hisab',
        icon: r.target === 'hisab' && r.category ? names.icons.get(r.category.toLowerCase()) || '🏷️' : null,
      } : null
      // No rule for this payee yet: guess from the name (only categories the household has).
      const target = dev!.default_target === 'budget' ? 'budget' : 'hisab'
      const name = guessName(c.payee, c.direction)
      const list = c.direction === 'in' ? names.hisab.in : names.hisab.out
      const hisabCat = list.find((n) => n.toLowerCase() === name.toLowerCase()) || list.find((n) => n.toLowerCase() === 'other') || null
      const budgetCat = names.budget.find((b) => b.kind === (c.direction === 'in' ? 'income' : 'expense') && b.name.toLowerCase() === name.toLowerCase())
      const guess = target === 'budget'
        ? { target, category: null, category_id: budgetCat?.id || null, account_id: a?.account_id || null, label: budgetCat?.name || 'Budget', icon: null }
        : { target, category: hisabCat, category_id: null, account_id: null, label: hisabCat || 'Hisab', icon: hisabCat ? names.icons.get(hisabCat.toLowerCase()) || '🏷️' : null }
      return { id: c.id, direction: c.direction, amount: Number(c.amount), date: c.occurred_on, account_hint: c.account_hint, card: c.card,
        payee: c.payee, bank: c.bank, suggestion, guess: suggestion ? null : guess, account_id: a?.account_id || null,
        match: c.match_entry_id ? { target: c.match_target } : null }
    })
  }
  const CAPTURE_COLS = 'id, direction, amount, occurred_on, account_hint, card, payee, bank, match_target, match_entry_id'
  async function pending() {
    const { data } = await db.from('captures').select(CAPTURE_COLS).eq('household_id', hid).eq('status', 'new').order('created_at', { ascending: false }).limit(10)
    return decorate((data || []) as Capture[])
  }
  async function fileCapture(id: string, f: Record<string, unknown>, learn = true) {
    const { data, error } = await db.rpc('file_capture_as', {
      p_user: dev!.user_id, p_capture: id, p_target: f.target === 'budget' ? 'budget' : 'hisab',
      p_category: clean(f.category, 60), p_category_id: clean(f.category_id, 64), p_account_id: clean(f.account_id, 64),
      p_source: clean(f.source, 40), p_book_id: clean(f.book_id, 64), p_note: clean(f.note, 500),
      p_auto: typeof f.auto === 'boolean' ? f.auto : null, p_learn: learn,
    })
    if (error) throw error
    return data as { id?: string, target?: string, already?: string }
  }
  type Decorated = Awaited<ReturnType<typeof decorate>>[number]
  // Auto mode: file on arrival with the payee's rule or the guess; skip ones already added by hand.
  async function autoFile(d: Decorated) {
    if (d.match) {
      const cap = await ownCapture(d.id)
      if (cap?.match_entry_id) await db.from('captures').update({ status: 'matched', target: cap.match_target, entry_id: cap.match_entry_id, filed_at: new Date().toISOString() }).eq('id', d.id).eq('status', 'new')
      return { ...d, matched: true }
    }
    const pick = (d.suggestion || d.guess)!
    const res = await fileCapture(d.id, { ...pick, note: d.payee }, false)
    return { ...d, filed: res, label: pick.label, icon: pick.icon, guessed: !d.suggestion }
  }
  async function resetCapture(cap: Capture & { status: string, entry_id?: string | null, target?: string | null }) {
    const { data: full } = await db.from('captures').select('status, entry_id, target').eq('id', cap.id).single()
    if (full?.status === 'filed' && full.entry_id) {
      await db.from(full.target === 'budget' ? 'transactions' : 'hisab_entries').delete().eq('id', full.entry_id).eq('household_id', hid)
    }
    await db.from('captures').update({ status: 'new', entry_id: null, target: null, filed_at: null }).eq('id', cap.id)
  }

  async function ownCapture(id: unknown) {
    const { data } = await db.from('captures').select(CAPTURE_COLS + ', status').eq('id', clean(id, 64) || '').eq('household_id', hid).maybeSingle()
    return data as (Capture & { status: string }) | null
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
      pending: await (async () => {
        if (!dev.auto_capture) return pending()
        for (const d of await pending()) { try { await autoFile(d) } catch { /* stays in the list */ } }
        return pending()
      })(),
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
    // An undone capture goes back to the "To add" list.
    await db.from('captures').update({ status: 'new', entry_id: null, target: null, filed_at: null }).eq('household_id', hid).eq('entry_id', row.id)
    return json({ ok: true })
  }

  if (action === 'capture') {
    const amount = amountOf(body.amount)
    if (!amount) return json({ error: 'No amount.' }, 400)
    const direction = body.direction === 'in' ? 'in' : 'out'
    const date = isDate(body.date) ? body.date as string : todayIST()
    const ref = clean(body.ref, 40)
    const row = {
      user_id: dev.user_id, household_id: hid, device_id: dev.id, direction, amount, occurred_on: date,
      account_hint: clean(body.account_hint, 8), card: body.card === true, payee: clean(body.payee, 80), ref, bank: clean(body.bank, 40),
    }
    const ins = ref
      ? await db.from('captures').upsert(row, { onConflict: 'household_id,ref', ignoreDuplicates: true }).select(CAPTURE_COLS).maybeSingle()
      : await db.from('captures').insert(row).select(CAPTURE_COLS).single()
    if (ins.error) return json({ error: ins.error.message }, 500)
    if (!ins.data) return json({ duplicate: true }) // same UPI ref already captured (e.g. by the other phone)
    const cap = ins.data as Capture

    // Already added by hand from the widget or the app? Same amount + day, added in the last day, not yet linked.
    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    const [h, t] = await Promise.all([
      db.from('hisab_entries').select('id').eq('household_id', hid).eq('amount', amount).eq('occurred_on', date).eq('direction', direction).gte('created_at', since).limit(5),
      db.from('transactions').select('id').eq('household_id', hid).eq('amount', amount).eq('occurred_on', date).eq('kind', direction === 'in' ? 'income' : 'expense').is('transfer_id', null).gte('created_at', since).limit(5),
    ])
    const cands = [...(h.data || []).map((x) => ({ target: 'hisab', id: x.id })), ...(t.data || []).map((x) => ({ target: 'budget', id: x.id }))]
    if (cands.length) {
      const ids = cands.map((c) => c.id)
      const [a, b] = await Promise.all([
        db.from('captures').select('entry_id').eq('household_id', hid).in('entry_id', ids),
        db.from('captures').select('match_entry_id').eq('household_id', hid).in('match_entry_id', ids).neq('id', cap.id),
      ])
      const used = new Set([...(a.data || []).map((x) => x.entry_id), ...(b.data || []).map((x) => x.match_entry_id)])
      const m = cands.find((c) => !used.has(c.id))
      if (m) {
        await db.from('captures').update({ match_target: m.target, match_entry_id: m.id }).eq('id', cap.id)
        cap.match_target = m.target; cap.match_entry_id = m.id
      }
    }
    const [d] = await decorate([cap])
    if (dev.auto_capture) {
      try { return json(await autoFile(d)) } catch { /* fall back to the list */ }
    }
    if (d.suggestion?.auto && !d.match) {
      try {
        const res = await fileCapture(cap.id, d.suggestion)
        return json({ ...d, filed: res })
      } catch { /* leave it in the list */ }
    }
    return json(d)
  }

  if (action === 'file') {
    const cap = await ownCapture(body.capture_id)
    if (!cap) return json({ error: 'That payment is no longer in the list.' }, 404)
    try { return json(await fileCapture(cap.id, body)) } catch (e) { return json({ error: String((e as Error).message || e) }, 500) }
  }

  if (action === 'refile' || action === 'unfile') {
    const cap = await ownCapture(body.capture_id)
    if (!cap) return json({ error: 'That payment is no longer in eChopdo.' }, 404)
    await resetCapture(cap)
    if (action === 'unfile') {
      await db.from('captures').update({ status: 'ignored', filed_at: new Date().toISOString() }).eq('id', cap.id)
      return json({ ok: true })
    }
    try { return json(await fileCapture(cap.id, body, true)) } catch (e) { return json({ error: String((e as Error).message || e) }, 500) }
  }

  if (action === 'ignore' || action === 'match') {
    const cap = await ownCapture(body.capture_id)
    if (!cap) return json({ error: 'That payment is no longer in the list.' }, 404)
    if (cap.status !== 'new') return json({ ok: true, already: cap.status })
    const upd = action === 'ignore'
      ? { status: 'ignored', filed_at: new Date().toISOString() }
      : cap.match_entry_id ? { status: 'matched', target: cap.match_target, entry_id: cap.match_entry_id, filed_at: new Date().toISOString() } : null
    if (!upd) return json({ error: 'Nothing to match it with.' }, 400)
    const { error } = await db.from('captures').update(upd).eq('id', cap.id)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  return json({ error: 'Unknown action.' }, 400)
})
