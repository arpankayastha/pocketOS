import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

const ACTIVE_HOUSEHOLD_KEY = 'pocketos.activeHouseholdId'

// Loads the user's households + reference data (accounts, categories) for the
// active household, and exposes CRUD helpers.
export function useFinanceData() {
  const [households, setHouseholds] = useState([])
  const [activeHouseholdId, setActiveHouseholdIdState] = useState(() => localStorage.getItem(ACTIVE_HOUSEHOLD_KEY))
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const setActiveHouseholdId = useCallback((id) => {
    localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, id)
    setActiveHouseholdIdState(id)
  }, [])

  const loadHouseholds = useCallback(async () => {
    const { data, error: err } = await supabase.from('households').select('*').order('created_at')
    if (err) { setError(err.message); return [] }
    setHouseholds(data || [])
    return data || []
  }, [])

  const createHousehold = useCallback(async (name) => {
    const { data, error: err } = await supabase.from('households').insert({ name }).select().single()
    if (err) throw err
    setHouseholds((hs) => [...hs, data])
    setActiveHouseholdId(data.id)
    return data
  }, [setActiveHouseholdId])

  const refresh = useCallback(async () => {
    setError(null)
    const hs = await loadHouseholds()
    let hid = activeHouseholdId
    if (!hid || !hs.some((h) => h.id === hid)) {
      hid = hs[0]?.id || null
      if (hid) setActiveHouseholdId(hid)
    }
    if (!hid) { setAccounts([]); setCategories([]); setLoading(false); return }

    const [a, c] = await Promise.all([
      supabase.from('accounts').select('*').eq('household_id', hid).order('created_at'),
      supabase.from('categories').select('*').eq('household_id', hid).order('name'),
    ])
    if (a.error || c.error) setError((a.error || c.error).message)
    setAccounts(a.data || [])
    setCategories(c.data || [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHouseholdId, loadHouseholds, setActiveHouseholdId])

  useEffect(() => { refresh() }, [refresh])

  return {
    households, activeHouseholdId, setActiveHouseholdId, createHousehold,
    accounts, categories, loading, error, refresh,
  }
}

export async function fetchTransactions({ householdId, from, to, kind, categoryId, accountId, search } = {}) {
  let q = supabase
    .from('transactions')
    .select('*, category:categories(id,name,color), account:accounts(id,name)')
    .eq('household_id', householdId)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
  if (from) q = q.gte('occurred_on', from)
  if (to) q = q.lte('occurred_on', to)
  if (kind) q = q.eq('kind', kind)
  if (categoryId) q = q.eq('category_id', categoryId)
  if (accountId) q = q.eq('account_id', accountId)
  if (search) q = q.ilike('note', `%${search}%`)
  const { data, error } = await q
  if (error) throw error
  return data
}
