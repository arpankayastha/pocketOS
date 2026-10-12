import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Shop module data: systems, rate card, today's sessions, counter cash, open shifts — with a
// realtime subscription so every phone's Floor stays in step. See supabase/shop.sql.

export const DURATIONS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300] // every half hour up to 5 h (owner: 2 h 30 m, 4 h, 5 h)
const MIN = 60_000

export const durLabel = (m) => {
  m = Math.max(0, Math.round(m))
  const h = Math.floor(m / 60), r = m % 60
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r} min`
}
// Whole rupees: the counter never deals in paise.
export const rs = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
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

export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

// The shop the signed-in login works in: a staff login's household, else the admin's first.
export function useShopId(memberHouseholdId) {
  const [id, setId] = useState(memberHouseholdId || null)
  useEffect(() => {
    if (memberHouseholdId) { setId(memberHouseholdId); return }
    supabase.from('households').select('id').order('created_at').limit(1).then(({ data }) => setId(data?.[0]?.id || null))
  }, [memberHouseholdId])
  return id
}

export function useShop(householdId) {
  const [state, setState] = useState({ loading: true, error: null, systems: [], rates: [], sessions: [], cash: [], advances: [], shifts: [], deposits: [], settings: null, bookings: [], eventChecks: [], entryChecks: [], dues: [], duesPaid: [] })

  const reload = useCallback(async () => {
    if (!householdId) return
    const from = dayStart().toISOString()
    const [sys, rates, todays, running, cash, adv, shifts, deps, settings, bookings, evChecks, entChecks, dues, duesPaid] = await Promise.all([
      supabase.from('shop_systems').select('*').eq('household_id', householdId).eq('active', true).order('sort').order('name'),
      supabase.from('shop_rates').select('*').eq('household_id', householdId).order('kind').order('minutes'),
      supabase.from('shop_sessions').select('*').eq('household_id', householdId).gte('started_at', from).neq('status', 'cancelled').order('started_at', { ascending: false }),
      supabase.from('shop_sessions').select('*').eq('household_id', householdId).eq('status', 'running').lt('started_at', from),
      supabase.from('shop_cash').select('*').eq('household_id', householdId).gte('at', from).order('at', { ascending: false }),
      supabase.from('shop_event_bookings').select('id, customer_name, advance_paid, advance_mode, created_at, status, payment_ok, entered_by').eq('household_id', householdId).gte('created_at', from).gt('advance_paid', 0),
      supabase.from('shop_shifts').select('*').eq('household_id', householdId).is('clock_out', null),
      supabase.from('shop_deposits').select('*').eq('household_id', householdId).eq('month', monthStart()).order('created_at', { ascending: false }),
      supabase.from('shop_settings').select('*').eq('household_id', householdId).maybeSingle(),
      supabase.from('shop_bookings').select('*').eq('household_id', householdId).in('status', ['requested', 'confirmed'])
        .gte('starts_at', new Date(Date.now() - 3 * 3600_000).toISOString()).order('starts_at'),
      // Online payments still to check: event advances and tournament entry fees.
      supabase.from('shop_event_bookings').select('*, shop_events(name, slot_minutes)').eq('household_id', householdId).eq('payment_ok', false).eq('status', 'booked').order('created_at'),
      supabase.from('shop_entries').select('*, shop_events(name)').eq('household_id', householdId).eq('status', 'requested').order('created_at'),
      // Customer dues still open (any day) and dues paid back today.
      supabase.from('shop_sessions').select('id, customer_name, customer_phone, system_name, started_at, owed, entered_by, handled_by').eq('household_id', householdId).gt('owed', 0).neq('status', 'cancelled').order('started_at'),
      supabase.from('shop_dues_paid').select('*').eq('household_id', householdId).gte('created_at', from).order('created_at', { ascending: false }),
    ])
    const err = [sys, rates, todays, running, cash, adv, shifts, deps, settings, bookings, evChecks, entChecks, dues, duesPaid].find((r) => r.error)?.error
    if (err) { setState((s) => ({ ...s, loading: false, error: err.message })); return }
    setState({
      loading: false, error: null, systems: sys.data, rates: rates.data,
      sessions: [...todays.data, ...running.data], cash: cash.data,
      advances: adv.data.filter((b) => b.status !== 'cancelled' && b.payment_ok !== false), shifts: shifts.data,
      deposits: deps.data, settings: settings.data, bookings: bookings.data,
      eventChecks: evChecks.data, entryChecks: entChecks.data, dues: dues.data, duesPaid: duesPaid.data,
    })
  }, [householdId])

  useEffect(() => {
    if (!householdId) return
    reload()
    const ch = supabase.channel(`shop:${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_sessions', filter: `household_id=eq.${householdId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_deposits', filter: `household_id=eq.${householdId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_bookings', filter: `household_id=eq.${householdId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_event_bookings', filter: `household_id=eq.${householdId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_entries', filter: `household_id=eq.${householdId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_dues_paid', filter: `household_id=eq.${householdId}` }, reload)
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    const t = setInterval(reload, 60_000)
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onVisible); clearInterval(t) }
  }, [householdId, reload])

  return { ...state, reload }
}

// A past day's sessions, cash and event advances (Today's ‹ › day switch). Same shape as useShop's.
export function useDay(householdId, day) {
  const [data, setData] = useState(null)
  const key = day ? day.toISOString() : null
  useEffect(() => {
    if (!householdId || !key) { setData(null); return }
    let live = true
    const from = key, to = addDays(new Date(key), 1).toISOString()
    setData(null)
    Promise.all([
      supabase.from('shop_sessions').select('*').eq('household_id', householdId).gte('started_at', from).lt('started_at', to).neq('status', 'cancelled').order('started_at', { ascending: false }),
      supabase.from('shop_cash').select('*').eq('household_id', householdId).gte('at', from).lt('at', to).order('at', { ascending: false }),
      supabase.from('shop_event_bookings').select('id, customer_name, advance_paid, advance_mode, created_at, status, payment_ok, entered_by').eq('household_id', householdId).gte('created_at', from).lt('created_at', to).gt('advance_paid', 0),
      supabase.from('shop_deposits').select('*').eq('household_id', householdId).gte('created_at', from).lt('created_at', to),
      supabase.from('shop_dues_paid').select('*').eq('household_id', householdId).gte('created_at', from).lt('created_at', to),
    ]).then(([s, c, a, d, p]) => {
      if (live) setData({ sessions: s.data || [], cash: c.data || [], advances: (a.data || []).filter((b) => b.status !== 'cancelled' && b.payment_ok !== false), shifts: [], deposits: d.data || [], duesPaid: p.data || [] })
    })
    return () => { live = false }
  }, [householdId, key])
  return data
}

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
    if (d.kind !== 'add' || new Date(d.created_at) < from || new Date(d.created_at) >= to) continue
    if (d.mode === 'online') t.online += Number(d.amount); else t.cash += Number(d.amount)
    t.deposits = (t.deposits || 0) + Number(d.amount)
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

// Who made an entry (stamped by the database on insert): "by Mayank".
export const byLine = (row) => (row?.entered_by ? `by ${row.entered_by}` : '')

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

// Valorant ranks for tournament entries (lowest first).
export const RANKS = ['Unranked', 'Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant']

// An event's picture: the one uploaded in Events → Edit, else the bundled GTA VI art for the GTA event (owner's picture).
export const eventImage = (ev) => ev?.image_url || (/gta/i.test(ev?.name || '') ? '/brand/gta6.jpg' : null)
