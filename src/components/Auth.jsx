import { useState } from 'react'
import { BrandMark } from '../lib/icons'
import { signInMember } from '../lib/members'
import { supabase } from '../lib/supabase'
import { signInWithFingerprint, passkeyError } from './Passkeys'
import { PasskeyIcon } from '../lib/icons'
import { signInWithGoogle } from '../lib/mine'

// GRANDXGAMER sign-in: every login (admin and staff) is a username + PIN or password, made by the admin
// (Shop → Staff). Opened from the home page's "Staff login" link (/#staff). Customers sign in with Google on the home page.
export default function Auth({ customer }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')

  async function signIn(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try { await signInMember(username, pin) } catch (err) { setMsg(err.message.replace('PIN', 'PIN or password')); setBusy(false) }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-glow" aria-hidden="true" />
      <div className="card auth">
        <div className="brand big"><BrandMark size={28} />GRANDXGAMER</div>
        <p className="auth-tagline">Slots, bookings, staff and money for the café, in one app.</p>
        {customer && (
          <div className="alert error">
            You’re signed in with Google as {customer.user.email}, which is a customer account — it isn’t linked to a staff or admin login.
            Sign in below with your username, then link Google in ⚙. <button type="button" className="btn link" style={{ padding: 0 }} onClick={() => supabase.auth.signOut()}>Sign out of Google</button>
          </div>
        )}
        {msg && <div className="alert error">{msg}</div>}
        <form className="stack" onSubmit={signIn}>
          <label>Username
            <input autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>PIN or password
            <input className="mono" type="password" autoComplete="current-password" required value={pin} onChange={(e) => setPin(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy || !username.trim() || pin.length < 6}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="auth-divider">or</div>
        <button type="button" className="btn passkey" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null)
          const { error } = await signInWithFingerprint().catch((e) => ({ error: e }))
          if (error) { setMsg(passkeyError(error)); setBusy(false) }
        }}><PasskeyIcon /> Sign in with fingerprint</button>
        <button type="button" className="btn google" disabled={busy} onClick={async () => {
          const { error } = await signInWithGoogle()
          if (error) setMsg(error.message)
        }}>Continue with Google</button>
        <p className="auth-hint">Staff: the first time, use the username and 6-digit PIN from the admin, then add fingerprint or link Google in ⚙.</p>
        <a className="auth-hint" href="#">‹ Back to the home page</a>
      </div>
    </div>
  )
}
