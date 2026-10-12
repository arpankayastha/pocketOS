import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// What a customer's phone remembers without a login: the ids of bookings / entries made on it (only the
// public_my_status rpc reads them). A signed-in (Google) customer also gets everything linked to their account.
const KEY = 'gx.mine'
const empty = () => ({ bookings: [], event_bookings: [], entries: [] })
export function readMine() {
  try { return { ...empty(), ...JSON.parse(localStorage.getItem(KEY)) } } catch { return empty() }
}
export function rememberMine(kind, id) {
  const m = readMine()
  m[kind] = [id, ...m[kind].filter((x) => x !== id)].slice(0, 10)
  try { localStorage.setItem(KEY, JSON.stringify(m)) } catch { /* ignore */ }
}

// Status of my bookings, entries and any session I'm playing (time left), refreshed every 20 s.
export function useMyStatus(session) {
  const [status, setStatus] = useState(null)
  const uid = session?.user?.id
  const load = useCallback(async () => {
    const m = readMine()
    const { data } = await supabase.rpc('public_my_status', { p_bookings: m.bookings, p_event_bookings: m.event_bookings, p_entries: m.entries })
    if (data) setStatus(data)
  }, [uid]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load()
    const t = setInterval(load, 20_000)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])
  return { status, reload: load }
}

export const isCustomer = (session) => !!session && session.user.app_metadata?.provider === 'google' && !session.user.app_metadata?.role

// Google sign-in for customers. Off until the Google provider is switched on in Supabase (Auth → Providers).
export async function googleEnabled() {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } })
    const j = await r.json()
    return !!j.external?.google
  } catch { return false }
}
export const signInWithGoogle = () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/` } })
