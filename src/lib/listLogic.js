// Pure helpers for the Lists module (no Supabase), tested in listLogic.test.mjs.

const UNITS = '(?:kg|kgs|g|gm|gms|gram|grams|l|ltr|ltrs|litre|litres|ml|pack|packs|pkt|pkts|pcs|pc|piece|pieces|dozen|doz|box|boxes|bottle|bottles|set|sets)'
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

// "milk 2 L" -> { name: 'Milk', qty: '2 L' };  "2 kg onions" -> { name: 'Onions', qty: '2 kg' };  "coriander" -> no qty.
export function parseQuick(text) {
  const t = (text || '').trim().replace(/\s+/g, ' ')
  if (!t) return { name: '', qty: '' }
  const tail = t.match(new RegExp(`^(.*\\S)\\s+(\\d+(?:\\.\\d+)?(?:\\s?${UNITS})?)$`, 'i'))
  if (tail) return { name: cap(tail[1]), qty: tail[2].replace(/(\d)([a-z])/i, '$1 $2') }
  const head = t.match(new RegExp(`^(\\d+(?:\\.\\d+)?\\s?${UNITS})\\s+(.+)$`, 'i'))
  if (head) return { name: cap(head[2]), qty: head[1].replace(/(\d)([a-z])/i, '$1 $2') }
  // a bare leading number is the quantity: "4 kela" -> Kela, 4
  const bare = t.match(/^(\d+(?:\.\d+)?)\s+(.+)$/)
  if (bare) return { name: cap(bare[2]), qty: bare[1] }
  return { name: cap(t), qty: '' }
}

export const isOpen = (i) => !i.done && !i.cleared
export const openItems = (items) => items.filter(isOpen)
export const gotItems = (items) => items.filter((i) => i.done && !i.cleared)

// [{ section, items }] in the list's section order, then anything else under "Other"; empty sections are left out.
export function groupBySection(items, sections = [], fallback = 'Other') {
  const order = [...sections]
  const map = new Map(order.map((s) => [s, []]))
  for (const it of items) {
    const key = it.section && map.has(it.section) ? it.section : fallback
    if (!map.has(key)) { map.set(key, []); order.push(key) }
    map.get(key).push(it)
  }
  return order.filter((s) => map.get(s).length).map((s) => ({ section: s, items: map.get(s) }))
}

// What was bought before: one row per name (case-insensitive), most often first. `onList` = already open on the list.
export function historyOf(items) {
  const by = new Map()
  for (const it of items) {
    const key = it.name.trim().toLowerCase()
    const cur = by.get(key) || { name: it.name.trim(), times: 0, last: '', qty: '', section: null, weekly: false, onList: false }
    cur.times += 1
    if ((it.created_at || '') >= cur.last) { cur.last = it.created_at || ''; cur.qty = it.qty || ''; cur.section = it.section || null; cur.weekly = !!it.repeat_weekly }
    if (isOpen(it)) cur.onList = true
    by.set(key, cur)
  }
  return [...by.values()].sort((a, b) => b.times - a.times || b.last.localeCompare(a.last))
}

export const progress = (items) => ({ done: items.filter((i) => i.done).length, total: items.length })

// Whole days from `today` to `iso` (negative = past); null without a date. Both are YYYY-MM-DD.
export function daysTo(iso, today) {
  if (!iso) return null
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
}

export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Ticked items older than `days` (auto-clear), and weekly-repeat items ticked 7+ days ago (they come back).
export function autoClearIds(items, days, now = Date.now()) {
  if (!days) return []
  return items.filter((i) => i.done && !i.cleared && i.done_at && now - Date.parse(i.done_at) >= days * 86400000).map((i) => i.id)
}
export function repeatIds(items, now = Date.now()) {
  return items.filter((i) => i.repeat_weekly && i.done && !i.cleared && i.done_at && now - Date.parse(i.done_at) >= 7 * 86400000).map((i) => i.id)
}

// Tasks grouped by when they're due: Overdue, This week (next 7 days), Later, No date. Done ones go last.
export function taskGroups(tasks, today) {
  const g = { Overdue: [], 'This week': [], Later: [], 'No date': [], Done: [] }
  for (const t of tasks) {
    if (t.done) { g.Done.push(t); continue }
    const d = daysTo(t.due_date, today)
    if (d === null) g['No date'].push(t)
    else if (d < 0) g.Overdue.push(t)
    else if (d <= 7) g['This week'].push(t)
    else g.Later.push(t)
  }
  const byDate = (a, b) => (a.due_date || '9').localeCompare(b.due_date || '9')
  Object.values(g).forEach((a) => a.sort(byDate))
  return Object.entries(g).filter(([, a]) => a.length).map(([label, items]) => ({ label, items }))
}

export const RSVP_NEXT = { null: 'yes', undefined: 'yes', yes: 'maybe', maybe: 'no', no: null }
export function rsvpCounts(people) {
  const c = { yes: 0, maybe: 0, no: 0, asked: 0 }
  for (const p of people) { if (p.rsvp) c[p.rsvp] += 1; else c.asked += 1 }
  return c
}

export const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
export const shortTime = (hhmm) => {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

