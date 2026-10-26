// Searching Hisab entries (no imports, so plain node can test it: `npm run test:hisabsearch`).
// A query matches the note, the category, the source or the amount (typed with or without commas / ₹).

const norm = (s) => String(s || '').toLowerCase()
const digits = (s) => String(s || '').replace(/[^0-9.]/g, '')

export function matches(e, q) {
  const needle = norm(q).trim()
  if (!needle) return true
  const text = `${norm(e.note)} ${norm(e.category)} ${norm(e.source)}`
  if (text.includes(needle)) return true
  const d = digits(q)
  if (d && /[0-9]/.test(d)) {
    const amount = String(Number(e.amount))
    // an exact amount, or the start of one once three digits are typed ("900" finds 90,000; "90" would find far too much)
    return amount === String(Number(d)) || (d.length >= 3 && amount.startsWith(d))
  }
  return false
}

// range: 'all' | 'month' (the month of `today`); dir: 'both' | 'out' | 'in'. Newest first.
export function searchEntries(entries, { q = '', range = 'all', dir = 'both', today }) {
  const month = today.slice(0, 7)
  return entries
    .filter((e) => (range === 'month' ? e.occurred_on.startsWith(month) : true) && (dir === 'both' || e.direction === dir) && matches(e, q))
    .sort((a, b) => (a.occurred_on === b.occurred_on ? String(b.created_at || '').localeCompare(String(a.created_at || '')) : a.occurred_on < b.occurred_on ? 1 : -1))
}

// [{ month: '2026-10', spent, rows }] in the order given.
export function groupByMonth(rows) {
  const groups = []
  for (const e of rows) {
    const m = e.occurred_on.slice(0, 7)
    let g = groups[groups.length - 1]
    if (!g || g.month !== m) { g = { month: m, spent: 0, rows: [] }; groups.push(g) }
    g.rows.push(e)
    if (e.direction === 'out') g.spent += Number(e.amount)
  }
  return groups
}

// The part of `text` that matches the query, so it can be highlighted: [before, hit, after].
export function highlight(text, q) {
  const t = String(text || ''), needle = norm(q).trim()
  const i = needle ? norm(t).indexOf(needle) : -1
  return i < 0 ? [t, '', ''] : [t.slice(0, i), t.slice(i, i + needle.length), t.slice(i + needle.length)]
}

export const totals = (rows) => ({
  out: rows.filter((e) => e.direction === 'out').reduce((s, e) => s + Number(e.amount), 0),
  in: rows.filter((e) => e.direction === 'in').reduce((s, e) => s + Number(e.amount), 0),
})
