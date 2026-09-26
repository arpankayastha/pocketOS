const currency = import.meta.env.VITE_CURRENCY || 'INR'
const locale = import.meta.env.VITE_LOCALE || 'en-IN'

const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 })
const fmtShort = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })

export const money = (n) => fmt.format(Number(n) || 0)
export const moneyShort = (n) => fmtShort.format(Number(n) || 0)

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
