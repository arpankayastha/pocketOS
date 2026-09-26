import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Loads the user's reference data (accounts, categories) and exposes CRUD helpers.
export function useFinanceData() {
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setError(null)
    const [a, c] = await Promise.all([
      supabase.from('accounts').select('*').order('created_at'),
      supabase.from('categories').select('*').order('name'),
    ])
    if (a.error || c.error) setError((a.error || c.error).message)
    setAccounts(a.data || [])
    setCategories(c.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { accounts, categories, loading, error, refresh }
}

export async function fetchTransactions({ from, to, kind, categoryId, accountId, search } = {}) {
  let q = supabase
    .from('transactions')
    .select('*, category:categories(id,name,color), account:accounts(id,name)')
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
