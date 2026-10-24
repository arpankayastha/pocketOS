// Pure logic behind the Home tab (no imports, so plain node can test it: `npm run test:home`).
// Wording is deliberately gentle: progress made, never a bare "you owe".

// Morning 5–11, afternoon 12–16, evening 17–20, night 21–4 (so 1 am is never "good morning").
export const greeting = (now) => {
  const h = now.getHours()
  return h >= 21 || h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
export const greetingEmoji = (now) => { const h = now.getHours(); return h >= 21 || h < 5 ? '🌙' : '🙏' }

// "arpan@alchemytech.ca" → "Arpan"; "pinu" → "Pinu".
// "Vaibhav Kayasth" -> Vaibhav (the Google profile name); "first.last@x.com" -> First (an email, when there is no name).
export function firstName(label) {
  const base = String(label || '').trim().split('@')[0].split(/[\s._\-\d]/)[0]
  return base ? base[0].toUpperCase() + base.slice(1) : ''
}

// The name in the greeting: the household being viewed ("Arpan", "Mummy"…), unless it is still the generic default
// ("Home"), then the person's own first name (`fallback`).
export function greetName(householdName, fallback) {
  const n = String(householdName || '').trim()
  return n && !/^(my )?home$/i.test(n) ? n : fallback || ''
}

const pad = (n) => String(n).padStart(2, '0')
export const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}
export const daysInMonthOf = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }

// How the month feels: the share of this month's money still left, against how much of the month is still ahead.
export function mood({ left, total, today }) {
  const day = Number(today.slice(8)), dim = daysInMonthOf(today), daysLeft = dim - day
  const togo = daysLeft === 0 ? 'last day of the month' : daysLeft === 1 ? '1 day to go' : `${daysLeft} days to go`
  const share = total > 0 ? Math.max(0, Math.min(1, left / total)) : null
  if (left < 0) return { share: 0, emoji: '🌱', text: `This month needs a little care · ${togo}` }
  if (share === null) return { share: null, emoji: '🙂', text: `Here is your month · ${togo}` }
  const ratio = share / Math.max(daysLeft / dim, 0.05)
  if (ratio >= 0.9) return { share, emoji: '🙂', text: `A comfortable month · ${togo}` }
  if (ratio >= 0.5) return { share, emoji: '🌤️', text: `Going steadily · ${togo}` }
  return { share, emoji: '🌱', text: `A little tight, take it easy · ${togo}` }
}

// The date a Plan line falls due in `month` ('YYYY-MM'), or null when it has no date.
export function dueDateOf(it, month) {
  if (it.auto_loan && it.loanDue) return it.loanDue
  if (it.auto_card) return it.bill?.due || null
  if (!it.day_of_month) return null
  return `${month}-${pad(Math.min(it.day_of_month, daysInMonthOf(`${month}-01`)))}`
}

// What is due from `today` up to `days` days ahead and not paid yet. `byMonth` = { 'YYYY-MM': Plan items }.
export function weekItems(byMonth, today, days = 7) {
  const end = addDays(today, days)
  const rows = []
  for (const [ym, items] of Object.entries(byMonth)) {
    for (const it of items || []) {
      if (it.actual || !(Number(it.amount) > 0)) continue
      const date = dueDateOf(it, ym)
      if (!date || date < today || date > end) continue
      rows.push({ id: `${ym}:${it.id}`, name: it.name, kind: it.kind, amount: Number(it.amount), date, auto_card: !!it.auto_card, auto_loan: !!it.auto_loan, category_id: it.category_id, account_id: it.account_id })
    }
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

// A property deal as progress made: what has been paid (buying) or received (selling) so far.
export function dealProgress(deal, due) {
  const sell = deal.kind === 'sell'
  const entries = due?.entries || []
  const sum = (dir) => entries.filter((e) => e.direction === dir).reduce((s, e) => s + Number(e.amount), 0)
  const paid = due ? sum(sell ? 'in' : 'out') : 0
  const other = due ? sum(sell ? 'out' : 'in') : 0
  const price = Number(deal.price) || 0
  const total = price > 0 ? price : other
  const papers = deal.checklist || []
  return {
    sell, paid, total, hasDue: !!due,
    pct: total > 0 ? Math.min(1, paid / total) : null,
    done: papers.filter((p) => p.done).length, count: papers.length,
    next: papers.find((p) => !p.done)?.label || null,
  }
}

// A home loan as a journey: how far along, what has been paid, the next step.
export function loanJourney(loan, s, today) {
  if (!s || s.incomplete || s.gold) return null
  const begins = loan.start_date > today
  const pct = Math.round((s.progress || 0) * 100)
  return {
    begins, beginsOn: loan.start_date, pct, justBegun: !begins && (s.progress || 0) < 0.01,
    paid: s.paidPrincipal || 0, nextDate: s.nextDate, nextAmount: (s.nextAmount || s.emi || 0) + (s.coverEmi || 0),
    years: Math.floor((s.monthsLeft || 0) / 12), months: (s.monthsLeft || 0) % 12,
  }
}

// Which household spent what: { householdId: total } from Daily-book spends.
export function spendByHousehold(entries, dailyBookIds) {
  const out = {}
  for (const e of entries) if (e.direction === 'out' && dailyBookIds.has(e.book_id)) out[e.household_id] = (out[e.household_id] || 0) + Number(e.amount)
  return out
}

// Open dues in two gentle buckets, leaving out those that belong to a property deal (shown there).
export function peopleSummary(dues, excludeIds = new Set()) {
  let lent = 0, settling = 0, open = 0
  for (const d of dues) {
    if (excludeIds.has(d.id) || !d.balance) continue
    open++
    if (d.balance > 0) lent += d.balance; else settling += -d.balance
  }
  return { lent, settling, open }
}
