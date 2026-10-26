// The Hisab calendar's day-by-day facts (no imports, so plain node can test them: `npm run test:hisabcal`).
// Each day gets a bubble sized by what was spent (area follows the amount), coloured by its biggest category,
// a ring when a Plan commitment was paid that day, and a quiet mark when nothing was spent.
const pad = (n) => String(n).padStart(2, '0')

export function calendarDays({ month, entries, today, trackQuiet = false }) {
  const [y, m] = month.split('-').map(Number)
  const dim = new Date(y, m, 0).getDate()
  const byDay = {}
  let first = null // the first day anything was logged in this book: days before it were not "no spending", just before eChopdo
  for (const e of entries) {
    if (first === null || e.occurred_on < first) first = e.occurred_on
    if (!e.occurred_on.startsWith(month)) continue
    const d = Number(e.occurred_on.slice(8, 10))
    const t = byDay[d] || (byDay[d] = { out: 0, in: 0, cats: {}, bill: false })
    t[e.direction] += Number(e.amount)
    if (e.direction === 'out') {
      const c = e.category || 'Other'
      t.cats[c] = (t.cats[c] || 0) + Number(e.amount)
      if (e.recurring_item_id) t.bill = true
    }
  }
  const max = Math.max(0, ...Object.values(byDay).map((t) => t.out))
  // Bubbles are scaled to a typical big day (the 85th percentile), not the single biggest, so one month's rent
  // doesn't shrink every other day; bigger days simply stop growing.
  const sorted = Object.values(byDay).map((t) => t.out).filter((n) => n > 0).sort((a, b) => a - b)
  const ref = sorted.length < 4 ? max : sorted[Math.floor(0.85 * (sorted.length - 1))]
  const days = []
  let quiet = 0
  for (let d = 1; d <= dim; d++) {
    const date = `${month}-${pad(d)}`
    const t = byDay[d]
    const past = date <= today
    const spent = !!t && t.out > 0
    const isQuiet = trackQuiet && past && first !== null && date >= first && !spent
    if (isQuiet) quiet += 1
    days.push({
      day: d, date, out: t?.out || 0, in: t?.in || 0, future: !past, quiet: isQuiet, bill: !!t?.bill,
      top: spent ? Object.entries(t.cats).sort((a, b) => b[1] - a[1])[0][0] : null,
      size: spent ? Math.round(14 + 22 * Math.sqrt(Math.min(1, t.out / ref))) : 0,
    })
  }
  return { days, quiet, max }
}
