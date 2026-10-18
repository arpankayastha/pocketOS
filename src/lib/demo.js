import { supabase } from './supabase'

// The demo account: a separate full-access owner login with its own empty household, for showing the app
// without exposing the real data. Switching from Settings keeps the owner's own session on this phone
// (not signed out), signs in as demo and looks like the owner (their email is shown). Switching back, or
// closing and reopening the app, restores the owner's session — no Google step. The demo password is typed
// once and kept on this phone (the account holds nothing real).
export const DEMO_EMAIL = 'demo@echopdo.vercel.app'
const PW_KEY = 'pocketos.demoPassword'
const OWNER_KEY = 'pocketos.demoOwner' // { email, access_token, refresh_token } of the real login
const ACTIVE_KEY = 'pocketos.demoActive' // sessionStorage: set while demo was switched to in this app run

export const isDemo = (session) => session?.user?.email === DEMO_EMAIL

const read = (store, key) => { try { return store.getItem(key) || '' } catch { return '' } }
export const savedDemoPassword = () => read(localStorage, PW_KEY)
export const forgetDemoPassword = () => { try { localStorage.removeItem(PW_KEY) } catch { /* ignore */ } }
export const demoOwnerEmail = () => { try { return JSON.parse(read(localStorage, OWNER_KEY) || '{}').email || '' } catch { return '' } }

export async function switchToDemo(password) {
  const { data } = await supabase.auth.getSession()
  const s = data.session
  if (!s) throw new Error('Not signed in.')
  try { localStorage.setItem(OWNER_KEY, JSON.stringify({ email: s.user.email, access_token: s.access_token, refresh_token: s.refresh_token })) } catch { /* ignore */ }
  try { sessionStorage.setItem(ACTIVE_KEY, '1') } catch { /* ignore */ } // before signing in, so the app doesn't see it as left over
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password })
  if (error) {
    try { localStorage.removeItem(OWNER_KEY); sessionStorage.removeItem(ACTIVE_KEY) } catch { /* ignore */ }
    throw new Error(/invalid/i.test(error.message) ? 'Wrong demo password.' : error.message)
  }
  try { localStorage.setItem(PW_KEY, password) } catch { /* ignore */ }
}

// Back to the owner's own session; falls back to a normal sign-out (then Google) if it can't be restored.
export async function leaveDemo() {
  let owner = null
  try { owner = JSON.parse(read(localStorage, OWNER_KEY) || 'null') } catch { /* ignore */ }
  try { sessionStorage.removeItem(ACTIVE_KEY) } catch { /* ignore */ }
  await supabase.auth.signOut()
  if (owner?.refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token: owner.access_token, refresh_token: owner.refresh_token })
    if (!error) { try { localStorage.removeItem(OWNER_KEY) } catch { /* ignore */ } }
  }
}

// True when demo was left over from an earlier app run (the app was closed): the owner's login should come back.
export const demoIsStale = () => !read(sessionStorage, ACTIVE_KEY)
