import { supabase } from './supabase'

// The demo account: a separate full-access owner login with its own empty household, for showing the app
// without exposing the real data. Switched to from Settings → Demo account; the password is typed once
// and kept on this phone only (the account holds nothing real). Going back = sign out, then Google as usual.
export const DEMO_EMAIL = 'demo@echopdo.vercel.app'
const KEY = 'pocketos.demoPassword'

export const isDemo = (session) => session?.user?.email === DEMO_EMAIL

export const savedDemoPassword = () => { try { return localStorage.getItem(KEY) || '' } catch { return '' } }
export const forgetDemoPassword = () => { try { localStorage.removeItem(KEY) } catch { /* ignore */ } }

export async function switchToDemo(password) {
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password })
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong demo password.' : error.message)
  try { localStorage.setItem(KEY, password) } catch { /* ignore */ }
}

export function leaveDemo() {
  try { sessionStorage.clear() } catch { /* ignore */ }
  return supabase.auth.signOut()
}
