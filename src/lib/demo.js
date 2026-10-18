import { supabase } from './supabase'
import { clearVaultSession } from './vaultSession'

// Guest view: the owner opens a separate, empty full-access account (demo@echopdo.vercel.app) to show the app
// without real data. No password: the `guest` Edge Function (owner only) hands the app a one-time token for it.
// The owner's own session is kept on this phone (not signed out) and the demo shows the owner's email. Exiting, or
// closing and reopening the app, restores it — and the Vault asks for a fingerprint again.
export const DEMO_EMAIL = 'demo@echopdo.vercel.app'
const OWNER_KEY = 'pocketos.demoOwner' // { email, access_token, refresh_token } of the real login
const ACTIVE_KEY = 'pocketos.demoActive' // sessionStorage: set while guest view was entered in this app run

export const isDemo = (session) => session?.user?.email === DEMO_EMAIL

const read = (store, key) => { try { return store.getItem(key) || '' } catch { return '' } }
export const demoOwnerEmail = () => { try { return JSON.parse(read(localStorage, OWNER_KEY) || '{}').email || '' } catch { return '' } }

export async function switchToDemo() {
  const { data } = await supabase.auth.getSession()
  const s = data.session
  if (!s) throw new Error('Not signed in.')
  const { data: res, error: fnError } = await supabase.functions.invoke('guest', { body: {} })
  if (fnError || !res?.token_hash) {
    let msg = fnError?.message || 'Could not open guest view.'
    try { msg = (await fnError.context.json()).error || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  try { localStorage.setItem(OWNER_KEY, JSON.stringify({ email: s.user.email, access_token: s.access_token, refresh_token: s.refresh_token })) } catch { /* ignore */ }
  try { sessionStorage.setItem(ACTIVE_KEY, '1') } catch { /* ignore */ } // before signing in, so the app doesn't see it as left over
  const { error } = await supabase.auth.verifyOtp({ token_hash: res.token_hash, type: 'magiclink' })
  if (error) {
    try { localStorage.removeItem(OWNER_KEY); sessionStorage.removeItem(ACTIVE_KEY) } catch { /* ignore */ }
    throw new Error(error.message)
  }
}

// Back to the owner's own session; falls back to a normal sign-out (then Google) if it can't be restored.
export async function leaveDemo() {
  let owner = null
  try { owner = JSON.parse(read(localStorage, OWNER_KEY) || 'null') } catch { /* ignore */ }
  try { sessionStorage.removeItem(ACTIVE_KEY) } catch { /* ignore */ }
  await supabase.auth.signOut()
  clearVaultSession() // the owner's Vault must ask for the fingerprint again
  if (owner?.refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token: owner.access_token, refresh_token: owner.refresh_token })
    if (!error) { try { localStorage.removeItem(OWNER_KEY) } catch { /* ignore */ } }
  }
}

// True when guest view was left over from an earlier app run (the app was closed): the owner's login should come back.
export const demoIsStale = () => !read(sessionStorage, ACTIVE_KEY)
