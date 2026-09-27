import { useEffect, useRef, useState } from 'react'
import { MIN_MASTER_PASSWORD } from '../lib/useVault'
import { describeWebAuthnError, platformAuthenticatorAvailable } from '../lib/webauthn'
import { passwordBits } from '../lib/vaultTools'
import { VaultIcon, FingerprintIcon } from '../lib/icons'
import { GateSkeleton } from './Skeleton'

// Shown before the vault is unlocked: first-time setup, or the lock screen.
// `onRecoveryCode` receives the one-time recovery code after setup; the parent shows it,
// because setup() unlocks the vault and this gate unmounts immediately.
export default function VaultGate({ vault, onRecovered, onRecoveryCode, title }) {
  if (vault.status === 'setup') return <Setup vault={vault} onRecoveryCode={onRecoveryCode} />
  return <Unlock vault={vault} onRecovered={onRecovered} title={title} />
}

function Setup({ vault, onRecoveryCode }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (pw.length < MIN_MASTER_PASSWORD) return setError(`Use at least ${MIN_MASTER_PASSWORD} characters.`)
    if (pw !== confirm) return setError("The two passwords don't match.")
    setBusy(true)
    setError(null)
    try { onRecoveryCode(await vault.setup(pw)) } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <form className="card gate" onSubmit={submit}>
      <VaultIcon />
      <h2>Set up your Vault</h2>
      <p className="muted">Pick a master password. It encrypts everything on this device before it's saved, and it's never sent anywhere — so <b>nobody, including eChopdo, can reset it for you</b>.</p>
      <label>Master password
        <input type="password" autoComplete="new-password" required autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <StrengthMeter password={pw} />
      <label>Confirm master password
        <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error && <div className="alert error">{error}</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'Creating vault…' : 'Create vault'}</button>
    </form>
  )
}

export function StrengthMeter({ password }) {
  const bits = passwordBits(password)
  const level = bits >= 80 ? 'strong' : bits >= 55 ? 'okay' : 'weak'
  return (
    <div className="strength">
      <div className="bar"><div className={`fill ${level === 'strong' ? 'ok' : level === 'okay' ? 'warn' : 'over'}`} style={{ width: `${Math.min(100, (bits / 100) * 100)}%` }} /></div>
      {password && <span className="muted small">{level} · ~{bits} bits</span>}
    </div>
  )
}

export function RecoveryCode({ code, onDone, firstTime }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  function download() {
    const text = `eChopdo Vault recovery code\n\n${code}\n\nKeep this somewhere safe and offline. It unlocks your vault if you forget your master password.\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'pocketos-vault-recovery-code.txt' })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="card gate">
      <h2>{firstTime ? 'Save your recovery code' : 'Your new recovery code'}</h2>
      <p className="muted">If you forget your master password, this code is the <b>only</b> way back into your vault. It's shown once — write it down or save it offline.{!firstTime && ' Your old code no longer works.'}</p>
      <code className="recovery-code">{code}</code>
      <div className="actions" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn small" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true) }}>{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" className="btn small" onClick={download}>Download .txt</button>
      </div>
      <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved my recovery code somewhere safe</label>
      <button className="btn primary" disabled={!saved} onClick={onDone}>Continue</button>
    </div>
  )
}

function Unlock({ vault, onRecovered, title = 'Vault is locked' }) {
  const [mode, setMode] = useState('password') // password | recovery
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [canFingerprint, setCanFingerprint] = useState(false)
  const autoTried = useRef(false)
  const hasFingerprint = vault.fingerprintUnlockers.length > 0

  useEffect(() => { platformAuthenticatorAvailable().then(setCanFingerprint) }, [])

  async function fingerprint() {
    setBusy(true)
    setError(null)
    try { await vault.unlockWithFingerprint() } catch (err) { setError(describeWebAuthnError(err)) }
    setBusy(false)
  }

  // Offer the fingerprint prompt straight away when this device has one registered
  // (but not right after the user tapped "Lock" themselves).
  useEffect(() => {
    if (!autoTried.current && hasFingerprint && canFingerprint && !vault.lockedByUser) {
      autoTried.current = true
      fingerprint()
    }
  }, [hasFingerprint, canFingerprint]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'password') await vault.unlockWithPassword(value)
      else { await vault.unlockWithRecovery(value); onRecovered() }
    } catch (err) { setError(err.message); setBusy(false) }
  }

  if (vault.status === 'loading') return <GateSkeleton />

  return (
    <form className="card gate" onSubmit={submit}>
      <VaultIcon />
      <h2>{title}</h2>
      {hasFingerprint && canFingerprint && (
        <>
          <button type="button" className="btn primary" disabled={busy} onClick={fingerprint}><FingerprintIcon /> Unlock with fingerprint</button>
          <div className="auth-divider">or</div>
        </>
      )}
      {mode === 'password' ? (
        <label>Master password
          <input type="password" autoComplete="current-password" required autoFocus={!hasFingerprint} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      ) : (
        <label>Recovery code
          <input className="mono" autoComplete="off" autoCapitalize="characters" spellCheck={false} required autoFocus placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      )}
      {error && <div className="alert error">{error}</div>}
      <button className={`btn ${hasFingerprint && canFingerprint ? '' : 'primary'}`} disabled={busy}>{busy ? 'Unlocking…' : mode === 'password' ? 'Unlock' : 'Unlock with recovery code'}</button>
      {vault.hasRecovery && (
        <button type="button" className="btn link" onClick={() => { setMode(mode === 'password' ? 'recovery' : 'password'); setValue(''); setError(null) }}>
          {mode === 'password' ? 'Forgot master password? Use recovery code' : 'Use master password instead'}
        </button>
      )}
    </form>
  )
}
