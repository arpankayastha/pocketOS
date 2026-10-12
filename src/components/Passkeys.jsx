import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDialog } from '../lib/dialog'
import { PasskeyIcon, PencilIcon, TrashIcon } from '../lib/icons'
import { deviceName } from '../lib/webauthn'
import { authSettings } from '../lib/mine'

// Fingerprint / face sign-in for every role (owner: "passkey + fingerprint for all users if they enroll"):
// Supabase passkeys. Admin, staff and Google customers add one per phone; then "Sign in with fingerprint"
// works on the sign-in screen and the home page. Needs passkeys switched on in the Supabase project.
export async function signInWithFingerprint() {
  if (!(await authSettings()).passkeys) return { error: { message: 'Fingerprint sign-in is being set up. Sign in the usual way for now.' } }
  return supabase.auth.signInWithPasskey()
}
export const passkeyError = (error) => /not.*(enabled|found|configured)|disabled|404|unsupported/i.test(error?.message || '')
  ? 'Fingerprint sign-in isn’t switched on yet, or there’s no passkey for this site on this phone. Sign in the usual way, then add one in Settings.'
  : error?.message

export default function Passkeys({ Wrap, compact }) {
  const dialog = useDialog()
  const [passkeys, setPasskeys] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [on, setOn] = useState(null)
  useEffect(() => { authSettings().then((x) => setOn(x.passkeys)) }, [])
  const load = useCallback(async () => {
    if (!(await authSettings()).passkeys) { setPasskeys([]); return }
    const { data, error } = await supabase.auth.passkey.list()
    if (error) { setError(passkeyError(error)); setPasskeys([]); return }
    setPasskeys(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function add() {
    setBusy(true); setError(null)
    const { data, error } = await supabase.auth.registerPasskey().catch((e) => ({ error: e }))
    if (!error && data?.id) await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: deviceName() }).catch(() => {})
    setBusy(false)
    if (error) { setError(passkeyError(error)); return }
    load()
  }
  async function rename(p) {
    const next = await dialog.prompt({ title: 'Rename', label: 'Name', defaultValue: p.friendly_name || '' })
    if (!next) return
    const { error } = await supabase.auth.passkey.update({ passkeyId: p.id, friendlyName: next })
    if (error) setError(error.message); else load()
  }
  async function remove(p) {
    if (!await dialog.confirm({ title: `Remove “${p.friendly_name || 'Passkey'}”?`, message: 'That phone signs in the usual way again.', confirmLabel: 'Remove', danger: true })) return
    const { error } = await supabase.auth.passkey.delete({ passkeyId: p.id })
    if (error) setError(error.message); else load()
  }
  const body = (<>
    {!compact && <p className="muted small" style={{ marginTop: 0 }}>Sign in with your fingerprint or face instead of typing a PIN or password. Add one on each phone you use.</p>}
    <div className="pk-list">
      {(passkeys || []).map((p) => (
        <div className="pk-row" key={p.id}>
          <span className="site-badge type" aria-hidden="true"><PasskeyIcon /></span>
          <div className="grow pk-text">
            <div className="ellipsis">{p.friendly_name || 'Passkey'}</div>
            <div className="muted small">Added {new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          </div>
          <button className="btn icon" aria-label="Rename" onClick={() => rename(p)}><PencilIcon /></button>
          <button className="btn icon" aria-label="Remove" onClick={() => remove(p)}><TrashIcon /></button>
        </div>
      ))}
    </div>
    {on === false ? <p className="muted small" style={{ margin: 0 }}>Being set up: fingerprint sign-in needs switching on for the shop’s account first.</p> :
    <button className="btn primary block" disabled={busy || !on} onClick={add}>{busy ? 'Waiting for fingerprint…' : '+ Add fingerprint sign-in on this phone'}</button>}
    {error && <div className="alert error" style={{ margin: '8px 0 0' }}>{error}</div>}
  </>)
  const summary = passkeys === null ? '…' : passkeys.length ? `${passkeys.length} phone${passkeys.length === 1 ? '' : 's'}` : 'Not set up'
  return Wrap ? <Wrap id="gx-passkeys" title="Fingerprint sign-in" summary={summary}>{body}</Wrap> : body
}
