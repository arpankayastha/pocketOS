import { addDays } from '../../lib/shop'
import { toCsv } from '../../lib/reports'

// ‹ October 2026 › for the portal's month views (never past this month).
export function useMonthRange(offset) {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = end > addDays(today, 1) ? addDays(today, 1) : end // this month: up to today
  return { from, to, label: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
}

export function MonthPicker({ offset, setOffset, label }) {
  return (
    <div className="admin-month">
      <button className="btn icon" aria-label="Previous month" onClick={() => setOffset(offset - 1)}>‹</button>
      <b>{label}</b>
      <button className="btn icon" aria-label="Next month" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>›</button>
    </div>
  )
}

// Saves a CSV that opens in Excel (the portal's "Excel export").
export function downloadCsv(name, columns, rows) {
  const url = URL.createObjectURL(new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.csv` })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const ymd = (d) => new Date(d).toLocaleDateString('en-CA')
