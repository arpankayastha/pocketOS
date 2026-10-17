import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { MASK, moneyMasked } from './privacy'
import { addDays, dayStart } from './money'

export * from './money'

// Shop module data: systems, rate card, today's sessions, counter cash, open shifts — with a
// realtime subscription so every phone's Floor stays in step. See supabase/shop.sql.

// Whole rupees: the counter never deals in paise.
export const rs = (n) => (moneyMasked() ? MASK : `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`)

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
      // Deposits carry over from month to month until used (owner, 13 Oct: "many customers can't use it in time").
      supabase.from('shop_deposits').select('*').eq('household_id', householdId).order('created_at', { ascending: false }).limit(2000),
      supabase.from('shop_settings').select('*').eq('household_id', householdId).maybeSingle(),
      supabase.from('shop_bookings').select('*').eq('household_id', householdId).in('status', ['requested', 'confirmed'])
        .gte('starts_at', new Date(Date.now() - 3 * 3600_000).toISOString()).order('starts_at'),
      // Online payments still to check: event advances and tournament entry fees.
      supabase.from('shop_event_bookings').select('*, shop_events(name, slot_minutes)').eq('household_id', householdId).eq('payment_ok', false).eq('status', 'booked').order('created_at'),
      supabase.from('shop_entries').select('*, shop_events(name)').eq('household_id', householdId).eq('status', 'requested').order('created_at'),
      // Customer dues still open (any day) and dues paid back today.
      supabase.from('shop_sessions').select('id, customer_name, customer_phone, system_name, started_at, owed, entered_by, handled_by, note, gaming_amount, extend_amount, fnb_before, fnb_while').eq('household_id', householdId).gt('owed', 0).neq('status', 'cancelled').order('started_at'),
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
export function useDay(householdId, day, version = 0) {
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
  }, [householdId, key, version])
  return data
}


// Who made an entry (stamped by the database on insert): "by Mayank".
export const byLine = (row) => (row?.entered_by ? `by ${row.entered_by}` : '')


// Valorant ranks for tournament entries (lowest first).
export const RANKS = ['Unranked', 'Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant']

// An event's picture: the one uploaded in Events → Edit, else the bundled GTA VI art for the GTA event (owner's picture).
export const eventImage = (ev) => ev?.image_url || (/gta/i.test(ev?.name || '') ? '/brand/gta6.jpg' : /valorant/i.test(ev?.name || '') ? '/brand/valorant.jpg' : null)
