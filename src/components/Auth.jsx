import { useState } from 'react'
import { BrandMark } from '../lib/icons'
import { signInMember } from '../lib/members'

// GRANDXGAMER sign-in: every login (admin and staff) is a username + PIN or password, made by the admin
// (Shop → Staff). Opened from the home page's "Staff login" link (/#staff). Customers sign in with Google on the home page.
export default function Auth() {
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
        <p className="auth-tagline">Floor, bookings, staff and money for the café, in one app.</p>
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
        <p className="auth-hint">Staff: use the username and 6-digit PIN from the admin, then turn on fingerprint.</p>
        <a className="auth-hint" href="#">‹ Back to the home page</a>
      </div>
    </div>
  )
}
