import { useEffect, useState } from 'react'
import { DEVICE_CREDENTIAL_KEY, MIN_MASTER_PASSWORD } from '../lib/useVault'
import { describeWebAuthnError, platformAuthenticatorAvailable, deviceName } from '../lib/webauthn'
import { itemsFromLastPassCsv, pwnedCount } from '../lib/vaultTools'
import { itemTitle, typedFromLastPassNote } from '../lib/vaultTypes'
import { TrashIcon, FingerprintIcon } from '../lib/icons'
import { StrengthMeter } from './VaultGate'
import { useDialog } from '../lib/dialog'


export default function VaultSecurity({ vault, onRecoveryCode, onOpenItem }) {
  return (
    <section className="grid2">
      <Fingerprints vault={vault} />
      <AppLockCard />
      <ChangePassword vault={vault} />
      <Recovery vault={vault} onRecoveryCode={onRecoveryCode} />
      <Import vault={vault} />
      <BreachCheck vault={vault} onOpenItem={onOpenItem} />
    </section>
  )
}

function Fingerprints({ vault }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [available, setAvailable] = useState(null)
  const dialog = useDialog()
  let thisDevice = null
  try { thisDevice = localStorage.getItem(DEVICE_CREDENTIAL_KEY) } catch { /* ignore */ }

  useEffect(() => { platformAuthenticatorAvailable().then(setAvailable) }, [])

  async function add() {
    const label = await dialog.prompt({ title: 'Use fingerprint on this device', label: 'Device name', defaultValue: deviceName(), confirmLabel: 'Continue' })
    if (!label) return
    setBusy(true)
    setError(null)
    try { await vault.addFingerprint(label.trim()) } catch (err) { setError(describeWebAuthnError(err)) }
    setBusy(false)
  }

  async function remove(u) {
    if (!await dialog.confirm({ title: `Remove "${u.label}"?`, message: 'That device will need the master password to open the vault.', confirmLabel: 'Remove' })) return
    try { await vault.removeUnlocker(u) } catch (err) { setError(err.message) }
  }

  const registeredHere = vault.fingerprintUnlockers.some((u) => u.credential_id === thisDevice)
  return (
    <div className="card">
      <h3>Fingerprint unlock</h3>
      <p className="muted small">Your fingerprint releases a device secret that decrypts the vault — it's not just a screen lock. Set it up once on each phone or laptop.</p>
      {vault.fingerprintUnlockers.map((u) => (
        <div className="line" key={u.id}>
          <span>{u.label} {u.credential_id === thisDevice && <span className="pill">this device</span>} <span className="muted small">added {new Date(u.created_at).toLocaleDateString()}</span></span>
          <button className="btn icon" aria-label={`Remove ${u.label}`} onClick={() => remove(u)}><TrashIcon /></button>
        </div>
      ))}
      {vault.fingerprintUnlockers.length === 0 && <p className="muted small">No devices set up yet.</p>}
      {available === false ? (
        <p className="muted small">This browser has no fingerprint or face unlock available.</p>
      ) : !registeredHere && (
        <button className="btn primary" disabled={busy} onClick={add} style={{ marginTop: 10 }}><FingerprintIcon /> {busy ? 'Waiting for fingerprint…' : 'Use fingerprint on this device'}</button>
      )}
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}

// With the vault set up, the whole app is behind the vault unlock (see Shell in App.jsx), so
// there's nothing to toggle — this card just explains how locking works.
function AppLockCard() {
  return (
    <div className="card">
      <h3>App lock</h3>
      <p className="muted small">eChopdo always opens with your fingerprint (or master password). That one unlock opens Budget, Vault and everything else — you're never asked twice.</p>
      <p className="muted small" style={{ margin: 0 }}>It locks again after 5 minutes without use, after a minute in the background, or when you tap the lock button.</p>
    </div>
  )
}

export function ChangePassword({ vault, title = 'Master password', hint = "Changing it doesn't re-encrypt your items — only the key that unlocks them — so it's instant.", onDone }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (pw.length < MIN_MASTER_PASSWORD) return setMsg({ error: `Use at least ${MIN_MASTER_PASSWORD} characters.` })
    if (pw !== confirm) return setMsg({ error: "The two passwords don't match." })
    setBusy(true)
    try { await vault.changePassword(pw); setPw(''); setConfirm(''); setMsg({ ok: 'Master password changed.' }); onDone?.() }
    catch (err) { setMsg({ error: err.message }) }
    setBusy(false)
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>{title}</h3>
      <p className="muted small">{hint}</p>
      <input type="password" autoComplete="new-password" placeholder="New master password" required value={pw} onChange={(e) => setPw(e.target.value)} />
      <StrengthMeter password={pw} />
      <input type="password" autoComplete="new-password" placeholder="Confirm new master password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {msg && <div className={`alert ${msg.error ? 'error' : 'ok'}`}>{msg.error || msg.ok}</div>}
      <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Change master password'}</button>
    </form>
  )
}

function Recovery({ vault, onRecoveryCode }) {
  const [error, setError] = useState(null)
  const dialog = useDialog()

  async function regenerate() {
    if (!await dialog.confirm({ title: 'Create a new recovery code?', message: 'Your current recovery code will stop working.', confirmLabel: 'Create new code', danger: false })) return
    try { onRecoveryCode(await vault.regenerateRecovery()) } catch (err) { setError(err.message) }
  }

  return (
    <div className="card">
      <h3>Recovery code</h3>
      <p className="muted small">Unlocks the vault if you forget your master password. {vault.hasRecovery ? 'You have one set up.' : 'You have none — create one now.'}</p>
      <button className="btn" onClick={regenerate}>{vault.hasRecovery ? 'Create a new recovery code' : 'Create recovery code'}</button>
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}

function Import({ vault }) {
  const [status, setStatus] = useState(null)
  const dialog = useDialog()

  async function onFile(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    try {
      const list = itemsFromLastPassCsv(await file.text(), typedFromLastPassNote)
      if (!list.length) return setStatus({ error: 'No items found in that file.' })
      if (!await dialog.confirm({ title: `Import ${list.length} item${list.length === 1 ? '' : 's'}?`, message: 'They are encrypted on this device and added to your vault.', confirmLabel: 'Import', danger: false })) return
      setStatus({ busy: `Encrypting and saving 0 / ${list.length}…` })
      await vault.importItems(list, (n) => setStatus({ busy: `Encrypting and saving ${n} / ${list.length}…` }))
      setStatus({ ok: `Imported ${list.length} items. Now delete the CSV file — it holds your passwords unencrypted.` })
    } catch (err) { setStatus({ error: err.message }) }
  }

  return (
    <div className="card">
      <h3>Import from LastPass</h3>
      <p className="muted small">LastPass's phone app can't export. On a computer, sign in at lastpass.com (or open the browser extension), find Export under Advanced Options or Account, choose LastPass CSV, then open eChopdo on that computer and pick the file here. Passwords and secure notes (cards, bank accounts, IDs…) come in as their matching types. The file is read and encrypted here on your device; it's never uploaded as-is.</p>
      <label className="btn file-btn">
        Choose LastPass CSV…
        <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={!!status?.busy} />
      </label>
      {status?.busy && <p className="muted small">{status.busy}</p>}
      {status?.error && <div className="alert error">{status.error}</div>}
      {status?.ok && <div className="alert ok">{status.ok}</div>}
    </div>
  )
}

function BreachCheck({ vault, onOpenItem }) {
  const [state, setState] = useState(null) // { done, total, hits: [{item, count}], error }

  async function run() {
    const withPw = vault.items.filter((i) => i.password)
    const hits = []
    setState({ done: 0, total: withPw.length, hits })
    // One request per unique password; the same password reused across sites is checked once.
    const cache = new Map()
    try {
      for (let n = 0; n < withPw.length; n++) {
        const item = withPw[n]
        if (!cache.has(item.password)) cache.set(item.password, await pwnedCount(item.password))
        const count = cache.get(item.password)
        if (count > 0) hits.push({ item, count })
        setState({ done: n + 1, total: withPw.length, hits: [...hits] })
      }
    } catch (err) { setState((s) => ({ ...s, error: err.message })) }
  }

  const reused = (() => {
    const seen = new Map()
    for (const i of vault.items) if (i.password) seen.set(i.password, (seen.get(i.password) || 0) + 1)
    return vault.items.filter((i) => i.password && seen.get(i.password) > 1).length
  })()

  const running = state && state.done < state.total && !state.error
  return (
    <div className="card">
      <h3>Password health</h3>
      <p className="muted small">Checks every password against known data breaches (Have I Been Pwned). Only the first 5 characters of each password's hash leave your device — never the password.</p>
      {reused > 0 && <p className="small warn-text">{reused} items share a password with another item.</p>}
      <button className="btn" disabled={running || !vault.items.length} onClick={run}>{running ? `Checking ${state.done} / ${state.total}…` : 'Check all passwords'}</button>
      {state?.error && <div className="alert error">{state.error}</div>}
      {state && !running && !state.error && (state.hits.length === 0
        ? <div className="alert ok" style={{ marginTop: 10 }}>None of your {state.total} passwords appear in known breaches.</div>
        : (
          <div style={{ marginTop: 10 }}>
            <div className="alert error">{state.hits.length} password{state.hits.length === 1 ? '' : 's'} found in breaches — change them.</div>
            {state.hits.map(({ item, count }) => (
              <div className="line" key={item.id}>
                <button className="btn link" onClick={() => onOpenItem(item)}>{itemTitle(item)}</button>
                <span className="muted small">{count.toLocaleString()} breaches</span>
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}
