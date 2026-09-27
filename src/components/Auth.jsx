import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { BrandMark, PasskeyIcon, HomeIcon } from '../lib/icons'
import { signInMember } from '../lib/members'

export default function Auth() {
  const [busy, setBusy] = useState(null) // null | 'google' | 'passkey' | 'member'
  const [msg, setMsg] = useState(null)
  const [member, setMember] = useState(false) // household login form
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')

  async function signInWithPin(e) {
    e.preventDefault()
    setBusy('member')
    setMsg(null)
    try { await signInMember(username, pin) } catch (err) { setMsg({ type: 'error', text: err.message }); setBusy(null) }
  }

  async function signInWithGoogle() {
    setBusy('google')
    setMsg(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setBusy(null)
      setMsg({ type: 'error', text: error.message })
    }
  }

  async function signInWithPasskey() {
    setBusy('passkey')
    setMsg(null)
    const { error } = await supabase.auth.signInWithPasskey()
    setBusy(null)
    if (error) setMsg({ type: 'error', text: 'No passkey found for this site on this device — use Google to sign in, then add a passkey from Settings.' })
  }

  return (
    <div className="auth-wrap">
      <div className="auth-glow" aria-hidden="true" />
      <div className="card auth">
        <div className="brand big"><BrandMark size={28} />PocketOS</div>
        <p className="auth-tagline">Everything you run your life with, in one pocket. Starting with your money.</p>
        {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
        {member ? (
          <form className="stack" onSubmit={signInWithPin}>
            <label>Username
              <input autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label>6-digit PIN
              <input className="mono pin-input" type="password" inputMode="numeric" autoComplete="current-password" pattern="\d{6}" maxLength={6} required
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </label>
            <button className="btn primary" disabled={!!busy || pin.length !== 6}>{busy === 'member' ? 'Signing in…' : 'Sign in'}</button>
            <button type="button" className="btn link" onClick={() => { setMember(false); setMsg(null) }}>Back</button>
          </form>
        ) : (<>
        <button type="button" className="btn google" disabled={!!busy} onClick={signInWithGoogle}>
          <GoogleIcon />
          {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </button>
        <div className="auth-divider"><span>or</span></div>
        <button type="button" className="btn passkey" disabled={!!busy} onClick={signInWithPasskey}>
          <PasskeyIcon />
          {busy === 'passkey' ? 'Checking for a passkey…' : 'Sign in with a passkey'}
        </button>
        <button type="button" className="btn passkey" disabled={!!busy} onClick={() => { setMember(true); setMsg(null) }}>
          <HomeIcon />
          Household login
        </button>
        <p className="auth-hint">Family member? Use the username and PIN you were given, then turn on fingerprint.</p>
        </>)}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  )
}
