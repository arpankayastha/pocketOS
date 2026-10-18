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

// Best-guess category from a file name; "Other" when nothing matches.
const CATEGORY_WORDS = [
  ['Insurance', /insur|policy|polic|lic\b|mediclaim|premium|claim|renewal/i],
  ['Health', /health|medical|report|lab|blood|prescription|scan|x-?ray|vaccin|hospital|doctor|discharge/i],
  ['Identity', /aadhaar|aadhar|pan\b|passport|voter|licen[cs]e|\bid\b|birth|marriage|certificate/i],
  ['Property', /property|flat|house|plot|deed|agreement|sale|rent|society|maintenance/i],
  ['Vehicle', /vehicle|car\b|bike|rc\b|puc|registration/i],
  ['Tax', /tax|itr|form ?16|gst|26as/i],
  ['Education', /marksheet|degree|school|college|fee|admission|result/i],
  ['Salary', /salary|payslip|pay slip|slip|appointment|offer letter|pf\b/i],
  ['Appliances', /warranty|invoice|bill|appliance|manual|purchase/i],
  ['Loans', /loan|emi|statement|sanction|mortgage/i],
]
export function guessCategory(name) {
  const hit = CATEGORY_WORDS.find(([, re]) => re.test(name || ''))
  return hit ? hit[0] : 'Other'
}

// Member and year from the folders above a file ("Member" / "2025" in either order).
export function guessFromPath(names) {
  const year = names.find((n) => /^(19|20)\d{2}$/.test(n.trim()))
  const member = names.find((n) => n !== year && !/^(19|20)\d{2}/.test(n.trim()))
  return { year: year?.trim() || '', member: member?.trim() || '' }
}
