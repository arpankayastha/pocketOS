import { today } from './format'

// Docs module: links to the family's important documents (kept in Google Drive). Each one is a
// vault item with type 'doc' — encrypted with the Vault key and shared with households exactly
// like a password — so nothing about it is readable in the database.
export const DOC_CATEGORIES = ['Health', 'Insurance', 'Identity', 'Property', 'Vehicle', 'Tax', 'Education', 'Salary', 'Appliances', 'Loans', 'Other']
export const REMIND_DAYS = 45 // expiry / renewal shows up in Home "Coming up" this many days ahead

export const EVERYONE = 'Everyone'

const DAY = 86_400_000
const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY)

// Days from today to a YYYY-MM-DD date (negative = already passed).
export const daysUntil = (iso) => (iso ? dayNumber(iso) - dayNumber(today()) : null)

export function dueLabel(days) {
  if (days == null) return ''
  if (days < 0) return `expired ${-days} day${days === -1 ? '' : 's'} ago`
  if (days === 0) return 'today'
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

// Documents whose expiry / renewal is within the reminder window (or already passed in the last 30 days).
export function dueSoon(docs, window = REMIND_DAYS) {
  return (docs || [])
    .filter((d) => d.expiry && !d.corrupt)
    .map((d) => ({ doc: d, days: daysUntil(d.expiry) }))
    .filter((x) => x.days <= window && x.days >= -30)
    .sort((a, b) => a.days - b.days)
}

export const docSubtitle = (d) => [d.member, d.year, d.category].filter(Boolean).join(' · ')

export function docSearchText(d) {
  return [d.title, d.category, d.member, d.year, d.number, d.notes].filter(Boolean).join(' ').toLowerCase()
}

export const hasDriveLink = (d) => !!d.link
export const linkHref = (v) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`)
