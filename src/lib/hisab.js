import { supabase } from './supabase'
import { PALETTE } from './colors'

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
export const iconFor = (category) => ICONS[(category || '').toLowerCase()] || '🏷️'

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
    .order('occurred_on', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return data
}

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

export async function saveEntry(book, { id, direction, amount, occurredOn, category, source, note }) {
  const fields = { direction, amount, occurred_on: occurredOn, category: category || null, source: source || null, note: note || null }
  const { error } = id
    ? await supabase.from('hisab_entries').update(fields).eq('id', id)
    : await supabase.from('hisab_entries').insert({ ...fields, book_id: book.id, household_id: book.household_id })
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
