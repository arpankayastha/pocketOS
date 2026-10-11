import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Shop module data: systems, rate card, today's sessions, counter cash, open shifts — with a
// realtime subscription so every phone's Floor stays in step. See supabase/shop.sql.

export const DURATIONS = [30, 60, 90, 120, 180]
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
// 1 hr ₹80 → 90 min = ₹130, 2 hr = ₹160). Covering, not exact: PS5 with only a 1-hr rate charges
// 30 min as 1 hr. No rates for the kind → 0.
export function priceFor(rates, kind, minutes) {
  const items = rates.filter((r) => r.kind === kind && r.minutes > 0)
  if (!items.length || minutes <= 0) return 0
  const cost = new Array(minutes + 1).fill(Infinity)
  cost[0] = 0
  for (let m = 1; m <= minutes; m++) {
    for (const it of items) cost[m] = Math.min(cost[m], cost[Math.max(0, m - it.minutes)] + Number(it.price))
  }
  return cost[minutes]
}

export const sessionEnd = (s) => new Date(new Date(s.started_at).getTime() + s.minutes * MIN)
export const sessionTotal = (s) => Number(s.gaming_amount) + Number(s.extend_amount) + Number(s.fnb_before) + Number(s.fnb_while) - Number(s.discount)
export const sessionPaid = (s) => Number(s.paid_cash) + Number(s.paid_online)
export const minutesLeft = (s, now = Date.now()) => (sessionEnd(s).getTime() - now) / MIN

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
  const [state, setState] = useState({ loading: true, error: null, systems: [], rates: [], sessions: [], cash: [], advances: [], shifts: [] })

  const reload = useCallback(async () => {
    if (!householdId) return
    const from = dayStart().toISOString()
    const [sys, rates, todays, running, cash, adv, shifts] = await Promise.all([
      supabase.from('shop_systems').select('*').eq('household_id', householdId).eq('active', true).order('sort').order('name'),
      supabase.from('shop_rates').select('*').eq('household_id', householdId).order('kind').order('minutes'),
      supabase.from('shop_sessions').select('*').eq('household_id', householdId).gte('started_at', from).neq('status', 'cancelled').order('started_at', { ascending: false }),
      supabase.from('shop_sessions').select('*').eq('household_id', householdId).eq('status', 'running').lt('started_at', from),
      supabase.from('shop_cash').select('*').eq('household_id', householdId).gte('at', from).order('at', { ascending: false }),
      supabase.from('shop_event_bookings').select('id, customer_name, advance_paid, advance_mode, created_at, status').eq('household_id', householdId).gte('created_at', from).gt('advance_paid', 0),
      supabase.from('shop_shifts').select('*').eq('household_id', householdId).is('clock_out', null),
    ])
    const err = [sys, rates, todays, running, cash, adv, shifts].find((r) => r.error)?.error
    if (err) { setState((s) => ({ ...s, loading: false, error: err.message })); return }
    setState({
      loading: false, error: null, systems: sys.data, rates: rates.data,
      sessions: [...todays.data, ...running.data], cash: cash.data,
      advances: adv.data.filter((b) => b.status !== 'cancelled'), shifts: shifts.data,
    })
  }, [householdId])

  useEffect(() => {
    if (!householdId) return
    reload()
    const ch = supabase.channel(`shop:${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_sessions', filter: `household_id=eq.${householdId}` }, reload)
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    const t = setInterval(reload, 60_000)
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onVisible); clearInterval(t) }
  }, [householdId, reload])

  return { ...state, reload }
}

// Today's money from sessions, event advances and the cash drawer.
export function dayTotals({ sessions, cash, advances }) {
  const t = { cash: 0, online: 0, owed: 0, sessions: 0, fnb: 0, minutes: 0, out: 0, in: 0, open: null, count: null }
  for (const s of sessions) {
    if (new Date(s.started_at) < dayStart()) continue
    t.cash += Number(s.paid_cash); t.online += Number(s.paid_online); t.owed += Number(s.owed)
    t.fnb += Number(s.fnb_before) + Number(s.fnb_while)
    if (s.status === 'closed') { t.sessions++; t.minutes += s.minutes }
  }
  for (const b of advances) { if (b.advance_mode === 'online') t.online += Number(b.advance_paid); else t.cash += Number(b.advance_paid) }
  for (const c of cash) {
    if (c.kind === 'out') t.out += Number(c.amount)
    else if (c.kind === 'in') t.in += Number(c.amount)
    else if (c.kind === 'open' && t.open === null) t.open = c // newest first
    else if (c.kind === 'count' && t.count === null) t.count = c
  }
  t.drawer = Number(t.open?.amount || 0) + t.cash + t.in - t.out
  return t
}
