import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Sign-up approval. Anyone can sign in with Google, but until the owner approves them (Settings →
// Sign-up requests) the database gives them nothing (RESTRICTIVE policy "approved only"), and the
// app shows a waiting screen. The last "approved" answer is cached per user so the app opens at
// once; it is re-checked on every start.
const APPROVED_KEY = 'pocketos.approved:'

export function useApproval(session, skip) {
  const uid = session.user.id
  const [state, setState] = useState(() => {
    if (skip) return { status: 'approved' }
    try { if (localStorage.getItem(APPROVED_KEY + uid) === '1') return { status: 'approved' } } catch { /* ignore */ }
    return { status: 'loading' }
  })
  const check = useCallback(async () => {
    const { data, error } = await supabase.from('signup_requests').select('status').eq('user_id', uid).maybeSingle()
    if (error) { setState((s) => (s.status === 'approved' ? s : { status: 'error', error: error.message })); return }
    const status = data?.status || 'pending'
    try {
      if (status === 'approved') localStorage.setItem(APPROVED_KEY + uid, '1')
      else localStorage.removeItem(APPROVED_KEY + uid)
    } catch { /* ignore */ }
    setState({ status })
  }, [uid])
  useEffect(() => { if (!skip) check() }, [skip, check])
  return { ...state, check }
}

// Owner side. A non-owner only ever sees their own row, so isAdmin is false for them.
export async function loadSignupRequests() {
  const { data: { session } } = await supabase.auth.getSession()
  const { data, error } = await supabase.from('signup_requests').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  const me = (data || []).find((r) => r.user_id === session?.user?.id)
  return { isAdmin: !!me?.is_admin, rows: (data || []).filter((r) => !r.is_admin) }
}

export async function decideSignup(userId, approve) {
  const { error } = await supabase.rpc('decide_signup', { p_user: userId, p_approve: approve })
  if (error) throw new Error(error.message)
}
