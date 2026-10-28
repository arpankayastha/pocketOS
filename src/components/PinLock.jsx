import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BrandMark } from '../lib/icons'
import { describeWebAuthnError } from '../lib/webauthn'

// Lock screen for the app PIN (lib/usePinLock.js): set it the first time, then enter it when the app opens.
export default function PinLock({ lock, session }) {
  const setup = lock.state === 'setup'
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState(null) // setup: first entry, waiting for the repeat
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const input = useRef(null)
  const raw = session.user.user_metadata?.full_name || session.user.user_metadata?.username || session.user.email?.split('@')[0] || ''
  const name = raw.charAt(0).toUpperCase() + raw.slice(1)

  useEffect(() => { if (!setup && lock.finger) finger() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function finger() {
    setError(null)
    try { await lock.unlockWithFinger() } catch (e) { setError(describeWebAuthnError(e)) }
  }
  async function submit(value) {
    setError(null)
    if (setup) {
      if (again === null) { setAgain(value); setPin(''); return }
      if (value !== again) { setError('The two PINs don’t match. Try again.'); setAgain(null); setPin(''); return }
      setBusy(true)
      try { await lock.setPin(value) } catch (e) { setError(e.message); setAgain(null); setPin('') }
      setBusy(false)
      return
    }
    setBusy(true)
    try {
      const r = await lock.unlock(value)
      if (!r.ok) { setError(r.left ? `Wrong PIN · ${r.left} ${r.left === 1 ? 'try' : 'tries'} left` : 'Too many wrong tries — signed out.'); setPin('') }
    } catch (e) { setError(e.message); setPin('') }
    setBusy(false)
    input.current?.focus()
  }
  const onChange = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(v)
    if (v.length === 4) submit(v)
  }
  return (
    <div className="auth-wrap">
      <div className="auth-glow" aria-hidden="true" />
      <div className="card auth pin-lock">
        <div className="brand big"><BrandMark size={28} />GRANDXGAMER</div>
        <h2 style={{ margin: 0 }}>{setup ? (again === null ? 'Set your app PIN' : 'Enter it again') : `Hi ${name}`}</h2>
        <p className="muted small" style={{ margin: 0 }}>{setup ? (lock.reset ? 'Too many wrong tries before — set a new 4-digit app PIN.' : '4 digits, asked whenever the app is opened — so nobody else can open it on this PC or phone.') : 'Enter your 4-digit app PIN.'}</p>
        {/* A text box drawn as dots, not type="password": Chrome's password manager filled the password box with
            the saved 6-digit staff login PIN, and its first 4 digits counted as a wrong app PIN (Mayank, 13 Oct). */}
        <input ref={input} className="mono pin-input pin-masked" type="text" inputMode="numeric" pattern="[0-9]*" name="gx-app-pin" autoComplete="one-time-code"
          data-lpignore="true" data-1p-ignore="true" autoCorrect="off" spellCheck={false} autoFocus value={pin} onChange={onChange} readOnly={busy} aria-label="PIN"
          onBlur={() => setTimeout(() => input.current?.focus(), 0)} />
        <div className="pin-dots" aria-hidden="true" onClick={() => input.current?.focus()}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
        {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
        {!setup && lock.finger && <button className="btn passkey" onClick={finger}>Use fingerprint</button>}
        <button className="btn link" onClick={() => supabase.auth.signOut()}>{setup ? 'Sign out' : 'Forgot PIN? Sign out and sign in again'}</button>
      </div>
    </div>
  )
}

// ⚙ card: change the PIN, fingerprint instead of the PIN on this phone, lock now.
export function PinSettings({ lock, Wrap, toast }) {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  async function change(e) {
    e.preventDefault()
    setBusy(true)
    try { await lock.setPin(next, cur); toast('App PIN changed'); setCur(''); setNext('') } catch (err) { toast(err.message) }
    setBusy(false)
  }
  return (
    <Wrap id="gx-pin" title="App PIN" summary={lock.finger ? 'PIN or fingerprint' : 'Asked when the app opens'}>
      <p className="muted small" style={{ marginTop: 0 }}>Asked when the app is opened and after 15 minutes without use. A refresh doesn’t ask.</p>
      <form className="grid2" onSubmit={change}>
        <label>Current PIN<input className="mono pin-masked" type="text" autoComplete="one-time-code" inputMode="numeric" value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
        <label>New PIN<input className="mono pin-masked" type="text" autoComplete="one-time-code" inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
        <button className="btn small" disabled={busy || cur.length !== 4 || next.length !== 4}>Change PIN</button>
      </form>
      <div className="gx-btns" style={{ marginTop: 8 }}>
        {lock.canFinger && (lock.finger
          ? <button className="btn small ghost" onClick={lock.disableFinger}>Stop using fingerprint here</button>
          : <button className="btn small" onClick={() => lock.enableFinger().then(() => toast('Fingerprint unlock is on for this device'), (err) => toast(describeWebAuthnError(err)))}>Use fingerprint on this device</button>)}
        <button className="btn small ghost" onClick={lock.lockNow}>Lock now</button>
      </div>
    </Wrap>
  )
}
