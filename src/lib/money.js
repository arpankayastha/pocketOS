// Pure shop money and time rules — no React, no Supabase — so `npm test` can check them in node.
// shop.js re-exports everything here; components keep importing from lib/shop.

// Every half hour up to 5 h, then every hour up to 10 h (owner: 2 h 30 m, 4 h, 5 h; then "up to 10 hours").
export const DURATIONS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 360, 420, 480, 540, 600]
const MIN = 60_000

export const durLabel = (m) => {
  m = Math.max(0, Math.round(m))
  const h = Math.floor(m / 60), r = m % 60
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r} min`
}
export const hoursLabel = (m) => `${(m / 60).toFixed(1)} h`
export const timeLabel = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).replace(' ', ' ')
export const dayLabel = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
export const dayStart = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

// Cheapest way to cover `minutes` with the rate card for this kind of system (e.g. PC: 30 min ₹50,
// 1 hr ₹80 → 90 min = ₹130, 2 hr = ₹160). Covering, not exact: a kind with only a 1-hr rate charges
// 30 min as 1 hr. `happy` uses the happy-hour rates (falls back to normal ones if the kind has none).
// Per head: multiply by the number of players. No rates for the kind → 0.
export function priceFor(rates, kind, minutes, happy = false) {
  let items = rates.filter((r) => r.kind === kind && r.minutes > 0 && !!r.happy === !!happy)
  if (!items.length && happy) items = rates.filter((r) => r.kind === kind && r.minutes > 0 && !r.happy)
  if (!items.length || minutes <= 0) return 0
  const cost = new Array(minutes + 1).fill(Infinity)
  cost[0] = 0
  for (let m = 1; m <= minutes; m++) {
    for (const it of items) cost[m] = Math.min(cost[m], cost[Math.max(0, m - it.minutes)] + Number(it.price))
  }
  return cost[minutes]
}

// When a session ends: its minutes plus any time it was paused (technical failure). While paused the end keeps
// moving, so the customer never loses time. Same rule as private.session_end in the database.
export function sessionEnd(s, now = Date.now()) {
  const base = new Date(s.started_at).getTime() + (Number(s.minutes) + Number(s.paused_minutes || 0)) * MIN
  return new Date(s.paused_at ? now + (base - new Date(s.paused_at).getTime()) : base)
}
// Minutes a session has been paused so far (owner, 17 Oct: shown next to the end time, which moves by this much).
export const pausedMinutes = (s, now = Date.now()) => Math.round(Number(s.paused_minutes || 0) + (s.paused_at && !s.waiting ? (now - new Date(s.paused_at).getTime()) / MIN : 0))
// The code a customer types on the PC / phone timer (#timer): first 6 characters of the id, like booking codes.
export const shortCode = (id) => String(id || '').replace(/-/g, '').slice(0, 6).toUpperCase()
export const sessionTotal = (s) => Number(s.gaming_amount) + Number(s.extend_amount) + Number(s.fnb_before) + Number(s.fnb_while) - Number(s.discount)
export const sessionPaid = (s) => Number(s.paid_cash) + Number(s.paid_online) + Number(s.paid_deposit || 0)

// Happy hours: full days of the week from shop_settings.happy_days (0 = Sunday; default Wed–Fri).
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const isHappyDay = (settings, d = new Date()) => (settings?.happy_days || [3, 4, 5]).includes(new Date(d).getDay())

// Deposits count within the month they were paid (Indian date) and lapse after it.
export const monthStart = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01` }
export const customerKey = (name, phone) => (phone || '').replace(/\D/g, '').slice(-10) || (name || '').trim().toLowerCase()
export function depositBalances(deposits) {
  const m = new Map()
  for (const d of deposits) {
    const k = customerKey(d.customer_name, d.customer_phone)
    const row = m.get(k) || { key: k, name: d.customer_name, phone: d.customer_phone, balance: 0 }
    row.balance += (d.kind === 'add' ? 1 : -1) * Number(d.amount)
    if (d.customer_phone) row.phone = d.customer_phone
    m.set(k, row)
  }
  return [...m.values()].filter((r) => r.balance > 0.5).sort((a, b) => a.name.localeCompare(b.name))
}
export const balanceFor = (deposits, name, phone) => {
  const k = customerKey(name, phone)
  return depositBalances(deposits).find((r) => r.key === k || (!phone && r.name.trim().toLowerCase() === (name || '').trim().toLowerCase()))
}
export const minutesLeft = (s, now = Date.now()) => (sessionEnd(s, now).getTime() - now) / MIN

// One day's money from sessions, event advances, deposits paid in, dues paid back and the cash drawer (default: today).
// A deposit is money in on the day it's paid; using it later on a session isn't counted again.
export function dayTotals({ sessions, cash, advances, deposits = [], duesPaid = [] }, from = dayStart()) {
  const t = { cash: 0, online: 0, owed: 0, sessions: 0, fnb: 0, minutes: 0, out: 0, in: 0, open: null, count: null }
  for (const s of sessions) {
    if (new Date(s.started_at) < from) continue
    t.cash += Number(s.paid_cash); t.online += Number(s.paid_online); t.owed += Number(s.owed)
    t.fnb += Number(s.fnb_before) + Number(s.fnb_while)
    if (s.status === 'closed') { t.sessions++; t.minutes += s.minutes }
  }
  for (const b of advances) { if (b.advance_mode === 'online') t.online += Number(b.advance_paid); else t.cash += Number(b.advance_paid) }
  const to = addDays(from, 1)
  for (const d of deposits) {
    if ((d.kind !== 'add' && d.kind !== 'refund') || new Date(d.created_at) < from || new Date(d.created_at) >= to) continue
    // A deposit returned (owner, 19 Oct) is money out that day, from the drawer or online.
    const v = (d.kind === 'refund' ? -1 : 1) * Number(d.amount)
    if (d.mode === 'online') t.online += v; else t.cash += v
    if (d.kind === 'refund') t.refunds = (t.refunds || 0) + Number(d.amount)
    else t.deposits = (t.deposits || 0) + Number(d.amount)
  }
  for (const p of duesPaid) {
    if (new Date(p.created_at) < from || new Date(p.created_at) >= to) continue
    if (p.mode === 'online') t.online += Number(p.amount); else t.cash += Number(p.amount)
    t.duesIn = (t.duesIn || 0) + Number(p.amount)
  }
  for (const c of cash) {
    if (c.kind === 'out') t.out += Number(c.amount)
    else if (c.kind === 'in') t.in += Number(c.amount)
    else if (c.kind === 'open' && t.open === null) t.open = c // newest first
    else if (c.kind === 'count' && t.count === null) t.count = c
  }
  t.drawer = Number(t.open?.amount || 0) + t.cash + t.in - t.out
  return t
}

// Open customer dues grouped by customer (same key as deposits), oldest session first.
export function duesByCustomer(dues = []) {
  const m = new Map()
  for (const s of dues) {
    const k = customerKey(s.customer_name, s.customer_phone)
    const row = m.get(k) || { key: k, name: s.customer_name, phone: s.customer_phone, total: 0, sessions: [] }
    row.total += Number(s.owed); row.sessions.push(s)
    if (s.customer_phone) row.phone = s.customer_phone
    m.set(k, row)
  }
  return [...m.values()].sort((a, b) => b.total - a.total)
}
// Rupees for saved text (session notes): never masked, unlike rs() on screen.
export const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`

// What a session still owes before End & collect: the bill, what's paid, what's already in their dues.
export const dueOf = (s) => Math.max(0, sessionTotal(s) - sessionPaid(s) - Number(s.owed || 0))

// Why a customer owes: the "Due: …" parts of the session note, else the parts of the bill (older dues).
export function dueReason(x) {
  const notes = (x.note || '').split(' · ').filter((t) => t.startsWith('Due:')).map((t) => t.slice(5))
  if (notes.length) return notes.join(' · ')
  return [Number(x.gaming_amount) && 'game', Number(x.extend_amount) && 'extend', (Number(x.fnb_before) + Number(x.fnb_while)) && 'F&B'].filter(Boolean).join(' + ')
}

// Share `total` over n parts in paise so they add up exactly (₹200 over 3 → 66.67, 66.67, 66.66).
export function shareOut(total, n) {
  const p = Math.round(Number(total) * 100), base = Math.floor(p / n)
  return Array.from({ length: n }, (_, i) => (base + (i < p - base * n ? 1 : 0)) / 100)
}

// Start: how each new timer (one per PC / PS5 controller) is paid. items = [{ g, f }] (game, F&B before).
// pay: end | cash | online | split (cash part typed, rest online) | due | deposit | booked (online booking:
// `booked` = what was paid online, shared across the timers; F&B is collected at the end).
// Dues and the deposit fill the first timers first; the split's cash part and a booking's amount add up exactly.
export function startPayments(items, { pay, cashPart = 0, fromDep = 0, dueNow = 0, booked = 0 }) {
  const total = items.reduce((t, x) => t + x.g + x.f, 0)
  const cashTotal = pay === 'split' ? Math.min(Math.max(0, Number(cashPart) || 0), total) : 0
  let depLeft = fromDep, dueLeft = dueNow, cashLeft = cashTotal
  const bookedShare = shareOut(booked, items.length)
  return items.map(({ g, f }, i) => {
    const line = g + f
    const c = i === items.length - 1 ? cashLeft : Math.min(cashLeft, Math.round(total ? (line * cashTotal) / total : 0)); cashLeft -= c
    const d = Math.min(depLeft, line); depLeft -= d
    const o = Math.min(dueLeft, line); dueLeft -= o
    return {
      paid_cash: pay === 'cash' ? line : pay === 'split' ? c : 0,
      paid_online: pay === 'online' ? line : pay === 'split' ? line - c : pay === 'booked' ? bookedShare[i] : 0,
      paid_deposit: d, owed: o,
    }
  })
}

// End & collect: what's left after what's paid and what's already in their dues, the deposit used, and how
// the rest is taken (cash / online / split / owes = into their dues).
export function endBill(s, { discount = 0, deposit = 0, useDeposit = false, mode = 'cash', cashPart = 0 } = {}) {
  const total = sessionTotal(s) - discount
  const paid = sessionPaid(s)
  const owedBefore = Number(s.owed || 0)
  const before = Math.max(0, total - paid - owedBefore)
  const fromDep = useDeposit ? Math.min(deposit, before) : 0
  const due = before - fromDep
  const cash = mode === 'cash' ? due : mode === 'split' ? Math.min(due, Number(cashPart) || 0) : 0
  const online = mode === 'online' ? due : mode === 'split' ? due - cash : 0
  const owed = mode === 'owes' ? due : 0
  return { total, paid, owedBefore, before, fromDep, due, cash, online, owed }
}

// Owner, 22 Oct: F&B / Extend paid now partly in cash, the rest online. The cash part is capped at the amount.
export function cashOnline(value, cashPart) {
  const v = Math.max(0, Number(value) || 0), cash = Math.min(v, Math.max(0, Math.round(Number(cashPart) || 0)))
  return { cash, online: v - cash }
}

// Collect while playing: dues from this session first (lowering owed), then the rest of the bill.
export function collectSplit(s, amount) {
  const owed = Number(s.owed || 0), due = dueOf(s) + owed
  const value = Math.min(Math.max(0, Number(amount) || 0), due)
  return { due, value, fromDues: Math.min(owed, value) }
}
