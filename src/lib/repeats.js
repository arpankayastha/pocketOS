// "Repeats we noticed": payments that came in again and again about a month apart at about the same amount (rent to the
// same person, an SIP, a streaming plan) and aren't on the Plan yet. Pure, so plain node can test it (`npm run test:repeats`).
// It only looks at spends with a note (an SMS payee, or what you typed): a note-less "Food" entry is a habit, not a bill.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ').trim()
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
const daysBack = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const titleCase = (s) => s.trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase())

export const REPEAT_LOOKBACK_DAYS = 150

export function findRepeats({ entries, planItems = [], today, hidden = [], limit = 4 }) {
  const cutoff = daysBack(today, REPEAT_LOOKBACK_DAYS)
  const recent = daysBack(today, 62) // a payment that stopped months ago isn't a repeat any more
  const groups = new Map()
  for (const e of entries) {
    if (e.direction !== 'out' || e.recurring_item_id || e.occurred_on < cutoff || e.occurred_on > today) continue
    const key = norm(e.note)
    if (key.length < 3) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(e)
  }
  const planNames = planItems.filter((p) => p.kind === 'expense').map((p) => ({ name: norm(p.name), amount: Number(p.expected_amount) || 0 }))
  const out = []
  for (const [key, rows] of groups) {
    if (hidden.includes(key)) continue
    const byMonth = new Map()
    for (const e of rows) { const m = e.occurred_on.slice(0, 7); byMonth.set(m, [...(byMonth.get(m) || []), e]) }
    if (byMonth.size < 3 || [...byMonth.values()].some((l) => l.length > 2)) continue // three months, and not a weekly habit
    const amount = median(rows.map((e) => Number(e.amount)))
    const picks = [...byMonth.values()].map((l) => l.sort((a, b) => Math.abs(Number(a.amount) - amount) - Math.abs(Number(b.amount) - amount))[0])
    if (picks.some((e) => Math.abs(Number(e.amount) - amount) > amount * 0.1)) continue // the amount stays about the same
    const days = picks.map((e) => Number(e.occurred_on.slice(8)))
    if (Math.max(...days) - Math.min(...days) > 7) continue // and it comes round at about the same time
    if (rows.reduce((m, e) => (e.occurred_on > m ? e.occurred_on : m), '') < recent) continue
    // Already on the Plan: the same amount, or the same name.
    if (planNames.some((p) => (p.amount > 0 && Math.abs(p.amount - amount) <= Math.max(1, amount * 0.03)) || (p.name.length >= 4 && (p.name.includes(key) || key.includes(p.name))))) continue
    const cats = {}
    for (const e of rows) if (e.category) cats[e.category] = (cats[e.category] || 0) + 1
    const latest = rows.reduce((a, b) => (a.occurred_on >= b.occurred_on ? a : b))
    out.push({ key, name: titleCase(latest.note), amount: Math.round(amount), day: Math.round(median(days)), months: byMonth.size, category: Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] || null })
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, limit)
}

export const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`
