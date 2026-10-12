import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Admin and staff: link a Google account to this login, then "Continue with Google" on the sign-in page opens
// it (owner: "staff + customer can also do Google login"). Without a link, Google sign-in makes a customer
// account instead. Needs "Allow manual linking" on in Supabase (Auth → Sign In / Providers).
export default function GoogleLink() {
  const [google, setGoogle] = useState(undefined)
  const [error, setError] = useState(null)
  useEffect(() => {
    supabase.auth.getUserIdentities().then(({ data }) => setGoogle((data?.identities || []).find((i) => i.provider === 'google') || null))
  }, [])
  async function link() {
    setError(null)
    const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: `${location.origin}/` } })
    if (error) setError(/manual linking/i.test(error.message) ? 'Google linking is being set up. Try again later.' : error.message)
  }
  if (google === undefined) return null
  return (
    <div className="gx-google-link">
      <div className="caps muted">Google</div>
      {google ? <div className="small pos">Linked to {google.identity_data?.email || 'your Google account'} · “Continue with Google” opens this login.</div>
        : <button className="btn block" onClick={link}>Link my Google account</button>}
      {error && <div className="alert error" style={{ margin: '8px 0 0' }}>{error}</div>}
    </div>
  )
}
