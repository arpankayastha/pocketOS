const currency = import.meta.env.VITE_CURRENCY || 'INR'
const locale = import.meta.env.VITE_LOCALE || 'en-IN'

const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 })
const fmtShort = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })

export const money = (n) => fmt.format(Number(n) || 0)
// ICU's en-IN compact form writes thousands as "T" (₹40T); use the familiar K / L / Cr instead.
const fmtPlain = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
const symbol = fmt.formatToParts(0).find((p) => p.type === 'currency')?.value || ''
export const moneyShort = (n) => {
  const v = Number(n) || 0
  if (locale !== 'en-IN') return fmtShort.format(v)
  const a = Math.abs(v), sign = v < 0 ? '-' : ''
  const [d, unit] = a >= 1e7 ? [1e7, 'Cr'] : a >= 1e5 ? [1e5, 'L'] : a >= 1e3 ? [1e3, 'K'] : [1, '']
  return `${sign}${symbol}${fmtPlain.format(a / d)}${unit}`
}

export const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time

export const monthKey = (d) => String(d).slice(0, 7) // 'YYYY-MM'
export const currentMonth = () => today().slice(0, 7)
export const monthStart = (ym) => `${ym}-01`
export const monthEnd = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).toLocaleDateString('en-CA')
}
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'short', year: 'numeric' })
}
export const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
