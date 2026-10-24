import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BrandMark } from '../lib/icons'

// Shown to a signed-in Google user the owner hasn't approved yet (or has turned away).
// Checks again every 15 s, so the app opens by itself soon after the owner taps Approve.
export default function PendingApproval({ session, approval }) {
  const { status, error, check } = approval
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (status === 'rejected') return
    const t = setInterval(check, 15000)
    return () => clearInterval(t)
  }, [status, check])

  async function again() { setBusy(true); await check(); setBusy(false) }

  return (
    <div className="auth-wrap">
      <div className="auth-glow" aria-hidden="true" />
      <div className="card auth">
        <div className="brand big"><BrandMark size={28} />eChopdo</div>
        {status === 'rejected' ? (
          <p className="auth-tagline">This account wasn’t approved for eChopdo. If you think that’s a mistake, ask the person who runs it.</p>
        ) : status === 'error' ? (
          <div className="alert error">Couldn’t check your approval: {error}</div>
        ) : (<>
          <p className="auth-tagline">Thanks for signing up. Your request is waiting for approval — eChopdo opens by itself once it’s approved.</p>
        </>)}
        <p className="auth-hint">Signed in as {session.user.email}</p>
        {status !== 'rejected' && <button className="btn primary" disabled={busy} onClick={again}>{busy ? 'Checking…' : 'Check again'}</button>}
        <button className="btn link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  )
}
