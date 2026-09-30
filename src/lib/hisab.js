import { supabase } from './supabase'
import { PALETTE } from './colors'
import { today } from './format'

// Hisab: Money Tracker-style cash books kept apart from Budget. Each household has one
// "daily" book (created on first visit) plus any number of occasion books. Category and
// source are free text on each entry; the pickers below are just the starting set.

export const CATEGORIES = [
  { name: 'Shopping', icon: '🛍️' }, { name: 'Clothes', icon: '👗' }, { name: 'Food', icon: '🍽️' },
  { name: 'Groceries', icon: '🥦' }, { name: 'Sweets', icon: '🍬' }, { name: 'Gifts', icon: '🎁' },
  { name: 'Puja', icon: '🪔' }, { name: 'Decor', icon: '🎉' }, { name: 'Flowers', icon: '💐' },
  { name: 'Travel', icon: '🚕' }, { name: 'Fuel', icon: '⛽' }, { name: 'Beauty', icon: '💄' },
  { name: 'Medical', icon: '💊' }, { name: 'Home', icon: '🏠' }, { name: 'Other', icon: '📦' },
]
export const IN_CATEGORIES = [
  { name: 'Shagun', icon: '🧧' }, { name: 'Gift', icon: '🎁' }, { name: 'Refund', icon: '↩️' },
  { name: 'Cash in', icon: '💵' }, { name: 'Other', icon: '📦' },
]
export const SOURCES = ['Cash', 'UPI', 'Card']

const ICONS = Object.fromEntries([...CATEGORIES, ...IN_CATEGORIES].map((c) => [c.name.toLowerCase(), c.icon]))
let custom = {} // icons of the household's managed categories (registerIcons)
export const iconFor = (category) => { const k = (category || '').toLowerCase(); return custom[k] || ICONS[k] || '🏷️' }
export function registerIcons(list) { custom = Object.fromEntries(list.map((c) => [c.name.toLowerCase(), c.icon])) }

// The household's Hisab categories (managed in Settings). The first time, seed the defaults.
export async function loadCategories(householdId) {
  const { data, error } = await supabase.from('hisab_categories').select('*').eq('household_id', householdId).order('position')
  if (error) throw error
  if (data.length) { registerIcons(data); return data }
  const rows = [
    ...CATEGORIES.map((c, i) => ({ household_id: householdId, direction: 'out', name: c.name, icon: c.icon, position: i })),
    ...IN_CATEGORIES.map((c, i) => ({ household_id: householdId, direction: 'in', name: c.name, icon: c.icon, position: i })),
  ]
  // Two screens can seed at once; the unique (household, direction, name) makes the second a no-op.
  const { error: err } = await supabase.from('hisab_categories').upsert(rows, { onConflict: 'household_id,direction,name', ignoreDuplicates: true })
  if (err) throw err
  const { data: seeded, error: err2 } = await supabase.from('hisab_categories').select('*').eq('household_id', householdId).order('position')
  if (err2) throw err2
  registerIcons(seeded)
  return seeded
}

// Stable colour per category name (charts key by name here: names are the identity).
export function colorFor(category, order) {
  const i = order.indexOf(category)
  return PALETTE[(i < 0 ? order.length : i) % PALETTE.length]
}

export async function loadBooks(householdId) {
  const [b, e] = await Promise.all([
    supabase.from('hisab_books').select('*').eq('household_id', householdId).order('created_at'),
    supabase.from('hisab_entries').select('book_id, direction, amount, occurred_on').eq('household_id', householdId),
  ])
  if (b.error || e.error) throw b.error || e.error
  let books = b.data
  if (!books.some((x) => x.kind === 'daily')) {
    const { data, error } = await supabase.from('hisab_books').insert({ household_id: householdId, name: 'Daily', kind: 'daily' }).select('*').single()
    if (error) throw error
    books = [data, ...books]
  }
  return books.map((book) => {
    const rows = e.data.filter((x) => x.book_id === book.id)
    const out = rows.filter((x) => x.direction === 'out').reduce((s, x) => s + Number(x.amount), 0)
    const inn = rows.filter((x) => x.direction === 'in').reduce((s, x) => s + Number(x.amount), 0)
    const dates = rows.map((x) => x.occurred_on).sort()
    const thisMonth = new Date().toLocaleDateString('en-CA').slice(0, 7)
    const monthOut = rows.filter((x) => x.direction === 'out' && x.occurred_on.startsWith(thisMonth)).reduce((s, x) => s + Number(x.amount), 0)
    return { ...book, out, in: inn, monthOut, count: rows.length, first: dates[0], last: dates[dates.length - 1] }
  }).sort((a, b) => (a.kind === 'daily' ? -1 : b.kind === 'daily' ? 1 : (b.last || b.created_at).localeCompare(a.last || a.created_at)))
}

export async function loadEntries(bookId) {
  const { data, error } = await supabase.from('hisab_entries').select('*').eq('book_id', bookId)
    .order('occurred_on', { ascending: false }).order('occurred_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// When an entry happened, "7:53 pm": the SMS's time for bank payments, the time it was added for
// ones typed in on the day. Back-dated entries (and old SMS synced before times were kept) have none.
export const entryTime = (e) => (e.occurred_at
  ? new Date(e.occurred_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '\u202f').toLowerCase()
  : null)

export async function saveBook({ id, householdId, name, target }) {
  const fields = { name: name.trim(), target: target || null }
  const { data, error } = id
    ? await supabase.from('hisab_books').update(fields).eq('id', id).select('*').single()
    : await supabase.from('hisab_books').insert({ ...fields, household_id: householdId, kind: 'occasion' }).select('*').single()
  if (error) throw error
  return data
}

export async function deleteBook(id) {
  const { error } = await supabase.from('hisab_books').delete().eq('id', id)
  if (error) throw error
}

// `book` is where the entry goes: saving an existing entry with another book moves it there.
export async function saveEntry(book, { id, direction, amount, occurredOn, category, source, note }) {
  const fields = { direction, amount, occurred_on: occurredOn, category: category || null, source: source || null, note: note || null, book_id: book.id }
  const { error } = id
    ? await supabase.from('hisab_entries').update(fields).eq('id', id)
    : await supabase.from('hisab_entries').insert({ ...fields, household_id: book.household_id, occurred_at: occurredOn === today() ? new Date().toISOString() : null })
  if (error) throw error
}

export async function deleteEntry(id) {
  const { error } = await supabase.from('hisab_entries').delete().eq('id', id)
  if (error) throw error
}

// Calculator input: numbers joined by + − × (× binds tighter). Returns null if incomplete.
export function evaluate(expr) {
  const tokens = expr.replace(/−/g, '-').replace(/×/g, '*').match(/\d*\.?\d+|[+\-*]/g)
  if (!tokens || /[+\-*]/.test(tokens[tokens.length - 1])) return null
  const terms = []
  let sign = 1, product = null, op = null
  for (const t of tokens) {
    if (t === '+' || t === '-') { terms.push(sign * product); sign = t === '-' ? -1 : 1; product = null; op = null }
    else if (t === '*') op = '*'
    else { const n = Number(t); product = op === '*' && product !== null ? product * n : n; op = null }
  }
  terms.push(sign * product)
  const total = terms.reduce((s, n) => s + n, 0)
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : null
}
