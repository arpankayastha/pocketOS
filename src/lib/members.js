import { supabase } from './supabase'

// Household member logins. The owner (the Google login) gives a household its own login:
// a username + 6-digit PIN (a Supabase email/password user with a made-up address under
// MEMBER_DOMAIN), then the member turns on fingerprint unlock on their phone. Members see only
// their household (RLS via household_members); logins are managed by the `members` Edge Function.
export const MEMBER_DOMAIN = 'members.echopdo.vercel.app'

export const isMember = (session) => session?.user?.app_metadata?.role === 'member'
export const memberEmail = (username) => `${username.trim().toLowerCase()}@${MEMBER_DOMAIN}`
export const memberName = (session) => session?.user?.user_metadata?.username || session?.user?.email?.split('@')[0]

export function generatePin() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
  return String(n).padStart(6, '0')
}

export async function signInMember(username, pin) {
  const { error } = await supabase.auth.signInWithPassword({ email: memberEmail(username), password: pin })
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong username or PIN.' : error.message)
}

// Owner-side calls to the Edge Function: list | create | reset_pin | remove.
export async function manageMembers(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('members', { body: { action, ...payload } })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).error || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return data
}

export async function markFingerprint(userId) {
  await supabase.from('household_members').update({ fingerprint_at: new Date().toISOString() }).eq('user_id', userId)
}
