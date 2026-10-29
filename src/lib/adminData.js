import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Admin portal loaders: whole ranges (a month, last month) and every customer. The API returns at most 1,000
// rows per request, so long lists are read page by page.
export async function fetchAll(build, page = 1000) {
  const out = []
  for (let i = 0; ; i += page) {
    const { data, error } = await build().range(i, i + page - 1)
    if (error) throw error
    out.push(...data)
    if (data.length < page) return out
  }
}

const SESSION_COLS = 'id, system_name, customer_name, customer_phone, started_at, minutes, status, gaming_amount, extend_amount, fnb_before, fnb_while, discount, paid_cash, paid_online, paid_deposit, owed, entered_by'

// Money and sessions for [from, to): the same shape dayTotals / dailyRows take.
export async function loadRange(householdId, from, to) {
  const a = from.toISOString(), b = to.toISOString()
  const [sessions, cash, advances, deposits, duesPaid, entries] = await Promise.all([
    fetchAll(() => supabase.from('shop_sessions').select(SESSION_COLS).eq('household_id', householdId).gte('started_at', a).lt('started_at', b).neq('status', 'cancelled').order('started_at')),
    fetchAll(() => supabase.from('shop_cash').select('*').eq('household_id', householdId).gte('at', a).lt('at', b).order('at', { ascending: false })),
    fetchAll(() => supabase.from('shop_event_bookings').select('id, customer_name, advance_paid, advance_mode, created_at, status, payment_ok').eq('household_id', householdId).gte('created_at', a).lt('created_at', b).gt('advance_paid', 0)),
    fetchAll(() => supabase.from('shop_deposits').select('*').eq('household_id', householdId).gte('created_at', a).lt('created_at', b)),
    fetchAll(() => supabase.from('shop_dues_paid').select('*').eq('household_id', householdId).gte('created_at', a).lt('created_at', b)),
    fetchAll(() => supabase.from('shop_entries').select('id, name, partner_name, fee, status, created_at, shop_events(name)').eq('household_id', householdId).eq('status', 'confirmed').gte('created_at', a).lt('created_at', b)),
  ])
  return { sessions, cash, advances: advances.filter((x) => x.status !== 'cancelled' && x.payment_ok !== false), deposits, duesPaid, entries }
}

export function useRange(householdId, from, to) {
  const [state, setState] = useState({ data: null, error: null })
  const key = `${from?.toISOString()}|${to?.toISOString()}`
  useEffect(() => {
    if (!householdId || !from || !to) return
    let live = true
    setState({ data: null, error: null })
    loadRange(householdId, from, to).then((data) => live && setState({ data, error: null }), (e) => live && setState({ data: null, error: e.message }))
    return () => { live = false }
  }, [householdId, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

// Every session, deposit and open due (for the Customers page).
export async function loadCustomers(householdId) {
  const [sessions, deposits, dues] = await Promise.all([
    fetchAll(() => supabase.from('shop_sessions').select(SESSION_COLS).eq('household_id', householdId).neq('status', 'cancelled').order('started_at')),
    fetchAll(() => supabase.from('shop_deposits').select('customer_name, customer_phone, kind, amount, mode, created_at').eq('household_id', householdId).order('created_at')),
    fetchAll(() => supabase.from('shop_sessions').select('customer_name, customer_phone, owed').eq('household_id', householdId).gt('owed', 0).neq('status', 'cancelled')),
  ])
  return { sessions, deposits, dues }
}
