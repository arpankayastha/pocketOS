import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeWebAuthnError } from '../lib/webauthn'
import { BrandMark, FingerprintIcon } from '../lib/icons'
import { memberName, signInMember } from '../lib/members'

// Full-screen privacy lock. Fallback is the vault master password (if a vault exists), so a
// lost fingerprint credential never locks the user out; signing out is always available.
export default function AppLockScreen({ appLock, vault }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [usePassword, setUsePassword] = useState(false)
  const [pw, setPw] = useState('')
  const tried = useRef(false)
  const hasPassword = vault.unlockers.some((u) => u.kind === 'password')

  async function fingerprint() {
    setBusy(true)
    setError(null)
    try { await appLock.unlock() } catch (err) { setError(describeWebAuthnError(err)) }
    setBusy(false)
  }

  useEffect(() => {
    if (tried.current) return
    tried.current = true
    fingerprint()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function submitPassword(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    if (await vault.checkPassword(pw)) appLock.unlockWithoutFingerprint()
    else { setError('Wrong master password.'); setBusy(false) }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-glow" />
      <div className="card auth">
        <div className="brand big"><BrandMark size={28} />PocketOS</div>
        <p className="auth-tagline">Locked. Use your fingerprint to continue.</p>
        <button className="btn primary" disabled={busy} onClick={fingerprint}><FingerprintIcon /> Unlock with fingerprint</button>
        {usePassword ? (
          <form className="stack" onSubmit={submitPassword}>
            <input type="password" autoComplete="current-password" autoFocus placeholder="Vault master password" required value={pw} onChange={(e) => setPw(e.target.value)} />
            <button className="btn" disabled={busy}>{busy ? 'Checking…' : 'Unlock with master password'}</button>
          </form>
        ) : hasPassword && (
          <button className="btn link" onClick={() => setUsePassword(true)}>Use master password instead</button>
        )}
        {error && <div className="alert error">{error}</div>}
        {/* Without a vault there's no password fallback, so signing out also turns app lock off — otherwise a lost fingerprint would lock you out for good. */}
        <button className="btn ghost small" onClick={() => { if (!hasPassword) appLock.disable(); supabase.auth.signOut() }}>Sign out</button>
      </div>
    </div>
  )
}

// A household member's lock screen: fingerprint, with their PIN as the fallback.
export function MemberLockScreen({ appLock, session }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [usePin, setUsePin] = useState(false)
  const [pin, setPin] = useState('')
  const tried = useRef(false)
  const name = memberName(session)

  async function fingerprint() {
    setBusy(true); setError(null)
    try { await appLock.unlock() } catch (err) { setError(describeWebAuthnError(err)) }
    setBusy(false)
  }
  useEffect(() => {
    if (tried.current) return
    tried.current = true
    fingerprint()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function submitPin(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await signInMember(name, pin); appLock.unlockWithoutFingerprint() } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-glow" />
      <div className="card auth">
        <div className="brand big"><BrandMark size={28} />PocketOS</div>
        <p className="auth-tagline">Hi {name}. Use your fingerprint to continue.</p>
        <button className="btn primary" disabled={busy} onClick={fingerprint}><FingerprintIcon /> Unlock with fingerprint</button>
        {usePin ? (
          <form className="stack" onSubmit={submitPin}>
            <input className="mono pin-input" type="password" inputMode="numeric" autoComplete="current-password" autoFocus placeholder="6-digit PIN" maxLength={6} required
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            <button className="btn" disabled={busy || pin.length !== 6}>{busy ? 'Checking…' : 'Unlock with PIN'}</button>
          </form>
        ) : <button className="btn link" onClick={() => setUsePin(true)}>Use PIN instead</button>}
        {error && <div className="alert error">{error}</div>}
        <button className="btn ghost small" onClick={() => { appLock.disable(); supabase.auth.signOut() }}>Sign out</button>
      </div>
    </div>
  )
}

// Shown once after a member's first PIN sign-in: turn on fingerprint unlock for this phone.
export function FingerprintSetup({ appLock, session, onDone, onSkip }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function enable() {
    setBusy(true); setError(null)
    try { await appLock.enable(); onDone() } catch (err) { setError(describeWebAuthnError(err)); setBusy(false) }
  }
  return (
    <div className="auth-wrap">
      <div className="auth-glow" />
      <div className="card auth">
        <div className="brand big"><BrandMark size={28} />PocketOS</div>
        <p className="auth-tagline">Welcome, {memberName(session)}! Turn on fingerprint so PocketOS opens with just your finger from now on.</p>
        <button className="btn primary" disabled={busy} onClick={enable}><FingerprintIcon /> {busy ? 'Waiting for fingerprint…' : 'Use my fingerprint'}</button>
        {error && <div className="alert error">{error}</div>}
        <button className="btn link" onClick={onSkip}>Not now</button>
        <p className="auth-hint">Your PIN keeps working as a backup.</p>
      </div>
    </div>
  )
}
