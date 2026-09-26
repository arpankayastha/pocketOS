import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeWebAuthnError } from '../lib/webauthn'
import { BrandMark, FingerprintIcon } from '../lib/icons'

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
