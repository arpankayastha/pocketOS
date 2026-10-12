import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { googleEnabled, signInWithGoogle, useMyStatus } from '../lib/mine'
import { PasskeyIcon } from '../lib/icons'
import Passkeys, { passkeyError, signInWithFingerprint } from './Passkeys'
import PublicNav, { useCustomerSession } from './PublicNav'

// The customer's own page (/#me), kept off the home screen (owner, 12 Oct): name + mobile, fingerprint
// sign-in for this phone, sign out. Signed out it is the sign-in page (Google or fingerprint).
export default function Me() {
  const customer = useCustomerSession()
  const { status, reload } = useMyStatus(customer || null)
  return (
    <div className="pub-page">
      <PublicNav active="me" />
      <main className="pub-main">
        <h1 className="pub-title">{customer ? 'My account' : 'Sign in'}</h1>
        {customer === undefined ? <div className="card muted">Loading…</div>
          : !customer ? <SignIn />
          : (<>
            <div className="card me-who">
              {customer.user.user_metadata?.avatar_url && <img src={customer.user.user_metadata.avatar_url} alt="" referrerPolicy="no-referrer" />}
              <div className="grow"><b>{status?.me?.name || customer.user.user_metadata?.full_name}</b>
                <div className="muted small">{customer.user.email}</div></div>
            </div>
            {status && <Profile me={status.me} session={customer} onSaved={reload} />}
            <div className="card"><h3 style={{ marginTop: 0 }}>Fingerprint sign-in</h3><Passkeys /></div>
            <button className="btn block" onClick={() => supabase.auth.signOut().then(() => { location.hash = '' })}>Sign out</button>
          </>)}
      </main>
    </div>
  )
}

function SignIn() {
  const [google, setGoogle] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { googleEnabled().then(setGoogle) }, [])
  return (
    <div className="card stack">
      <p className="muted small" style={{ margin: 0 }}>Sign in to see your bookings and the time left while you play. You can book without signing in too.</p>
      {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
      <button className="btn primary block" onClick={async () => {
        if (google === false) { setError('Google sign-in is being set up. You can still book without signing in.'); return }
        const { error } = await signInWithGoogle(); if (error) setError(error.message)
      }}>Sign in with Google</button>
      <button className="btn block" onClick={async () => {
        const { error } = await signInWithFingerprint().catch((e) => ({ error: e }))
        if (error) setError(passkeyError(error))
      }}><PasskeyIcon /> Sign in with fingerprint</button>
      <a className="muted small" href="#staff" style={{ textAlign: 'center' }}>Staff login</a>
    </div>
  )
}

// Name + mobile, so the counter can link the time they play to this account. Asked on the home page after the
// first Google sign-in; changed here later.
export function Profile({ me, session, onSaved }) {
  const first = !me?.phone
  const [name, setName] = useState(me?.name || session.user.user_metadata?.full_name || '')
  const [phone, setPhone] = useState(me?.phone || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  async function save(e) {
    e.preventDefault()
    setBusy(true); setError(null); setSaved(false)
    const { error } = await supabase.rpc('customer_profile', { p_name: name.trim(), p_phone: phone })
    setBusy(false)
    if (error) setError(error.message); else { setSaved(true); onSaved() }
  }
  const changed = name.trim() !== (me?.name || '') || phone.replace(/\D/g, '') !== (me?.phone || '')
  return (
    <form className="card stack" onSubmit={save}>
      <h3 style={{ margin: 0 }}>{first ? 'Welcome! Add your mobile' : 'Name and mobile'}</h3>
      <p className="muted small" style={{ margin: 0 }}>Give the same number at the counter and your time left shows here while you play.</p>
      {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
      <div className="grid2">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        <label>Mobile<input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))} inputMode="tel" autoComplete="tel" placeholder="10 digits" /></label>
      </div>
      <button className="btn primary" disabled={busy || !changed || name.trim().length < 2 || phone.replace(/\D/g, '').length < 10}>{busy ? 'Saving…' : saved && !changed ? 'Saved ✓' : 'Save'}</button>
    </form>
  )
}
