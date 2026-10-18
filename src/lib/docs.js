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

// The date a reminder next falls on: the saved date, or for "every year" the next anniversary of it.
export function dueDate(d) {
  if (!d.expiry) return null
  if (d.repeat !== 'yearly') return d.expiry
  const [, m, day] = d.expiry.split('-')
  let y = Number(today().slice(0, 4))
  if (`${y}-${m}-${day}` < today()) y += 1
  return `${y}-${m}-${day}`
}

export const REMIND_OPTIONS = [15, 30, 45, 60, 90]

// Reminders inside their window (default 45 days ahead, or what the document asks for) or lapsed in the last 30 days.
export function dueSoon(docs) {
  return (docs || [])
    .filter((d) => d.expiry && !d.corrupt)
    .map((d) => ({ doc: d, days: daysUntil(dueDate(d)) }))
    .filter((x) => x.days <= (Number(x.doc.remindDays) || REMIND_DAYS) && x.days >= -30)
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

// Year from the folders above a file, and the family member only when a folder is named like
// "<Name> Docs" (one word, e.g. "Mom Docs"); "Common Docs" means everyone. Other folders
// (a loan, a property, a bill type) are never mistaken for a person.
export function guessFromPath(names) {
  const year = names.find((n) => /^(19|20)\d{2}$/.test(n.trim()))?.trim() || ''
  let member = ''
  for (const n of names) {
    const m = n.trim().match(/^([\p{L}]+)\s+docs?$/iu)
    if (!m) continue
    member = /^common$/i.test(m[1]) ? EVERYONE : m[1][0].toUpperCase() + m[1].slice(1)
    break
  }
  return { year, member }
}
