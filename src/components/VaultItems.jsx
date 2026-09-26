import { useEffect, useMemo, useState } from 'react'
import { copySecret, generatePassword, hostOf, parseTotp, pwnedCount, totpCode } from '../lib/vaultTools'
import { CopyIcon, EyeIcon, DiceIcon, PencilIcon, TrashIcon } from '../lib/icons'
import { StrengthMeter } from './VaultGate'

const FIELDS = ['title', 'url', 'username', 'password', 'totp', 'notes', 'folder']

// `open` (item being viewed) and `editing` (item being edited, {} for a new one) live in
// VaultModule so the add button and the Security tab can open them; it clears them on lock.
export default function VaultItems({ vault, open, setOpen, editing, setEditing }) {
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return vault.items
    return vault.items.filter((i) => [i.title, i.url, i.username, i.folder].some((f) => (f || '').toLowerCase().includes(q)))
  }, [vault.items, query])

  async function copy(text, what) {
    try {
      await copySecret(text)
      setToast(`${what} copied — clipboard clears in 30s`)
    } catch { setToast("Couldn't copy — your browser blocked clipboard access.") }
    setTimeout(() => setToast(null), 2500)
  }

  return (
    <section>
      <div className="toolbar">
        <input type="search" placeholder={`Search ${vault.items.length} item${vault.items.length === 1 ? '' : 's'}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="card list">
        {shown.map((i) => (
          <div className="txn vault-row" key={i.id} role="button" tabIndex={0} onClick={() => setOpen(i)} onKeyDown={(e) => e.key === 'Enter' && setOpen(i)}>
            <span className="site-badge" aria-hidden="true">{(i.title || hostOf(i.url) || '?').slice(0, 1).toUpperCase()}</span>
            <span className="grow">
              <div className="ellipsis">{i.title || hostOf(i.url) || 'Untitled'}</div>
              <div className="muted small ellipsis">{i.username || hostOf(i.url)}{i.folder && <> · {i.folder}</>}</div>
            </span>
            {i.password && (
              <button className="btn icon" title="Copy password" aria-label="Copy password" onClick={(e) => { e.stopPropagation(); copy(i.password, 'Password') }}><CopyIcon /></button>
            )}
          </div>
        ))}
        {shown.length === 0 && (
          <p className="muted pad">{vault.items.length ? 'No items match your search.' : 'Your vault is empty. Tap + to add your first password, or import from LastPass in Security.'}</p>
        )}
      </div>

      {open && !editing && (
        <ItemView item={open} copy={copy} onClose={() => setOpen(null)} onEdit={() => setEditing(open)}
          onDelete={async () => {
            if (!confirm(`Delete "${open.title || 'this item'}"? This can't be undone.`)) return
            await vault.deleteItem(open.id)
            setOpen(null)
          }} />
      )}
      {editing && (
        <ItemForm initial={editing} onClose={() => setEditing(null)}
          onSave={async (data) => {
            await vault.saveItem(data, editing.id)
            setEditing(null)
            setOpen(editing.id ? { ...editing, ...data } : null)
          }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  )
}

function Field({ label, value, secret, onCopy, mono, children }) {
  const [shown, setShown] = useState(!secret)
  if (!value && !children) return null
  return (
    <div className="field">
      <div className="muted small">{label}</div>
      <div className="field-row">
        <span className={`grow field-value ${mono || secret ? 'mono' : ''}`}>{children || (shown ? value : '•'.repeat(12))}</span>
        {secret && <button type="button" className="btn icon" aria-label={shown ? 'Hide' : 'Show'} onClick={() => setShown(!shown)}><EyeIcon off={shown} /></button>}
        {onCopy && <button type="button" className="btn icon" aria-label={`Copy ${label.toLowerCase()}`} onClick={onCopy}><CopyIcon /></button>}
      </div>
    </div>
  )
}

function ItemView({ item, copy, onClose, onEdit, onDelete }) {
  const [breach, setBreach] = useState(null) // null | 'checking' | number | Error text
  const href = item.url && (/^[a-z]+:\/\//i.test(item.url) ? item.url : `https://${item.url}`)

  async function check() {
    setBreach('checking')
    try { setBreach(await pwnedCount(item.password)) } catch (err) { setBreach(err.message) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{item.title || 'Untitled'}</h3>
        {item.corrupt ? <div className="alert error">This item couldn't be decrypted. It may have been damaged.</div> : (
          <>
            {item.url && <Field label="Website" value={item.url}><a href={href} target="_blank" rel="noopener noreferrer">{item.url}</a></Field>}
            <Field label="Username" value={item.username} onCopy={() => copy(item.username, 'Username')} />
            <Field label="Password" value={item.password} secret onCopy={() => copy(item.password, 'Password')} />
            {item.totp && <TotpField totp={item.totp} copy={copy} />}
            {item.notes && <Field label="Notes" value={item.notes}><span className="notes">{item.notes}</span></Field>}
            {item.folder && <Field label="Folder" value={item.folder} />}
            {item.password && (
              <div className="small">
                {breach === null && <button type="button" className="btn link small" onClick={check}>Check if this password was in a data breach</button>}
                {breach === 'checking' && <span className="muted">Checking…</span>}
                {typeof breach === 'number' && (breach > 0
                  ? <div className="alert error">Seen in {breach.toLocaleString()} data breaches. Change this password.</div>
                  : <div className="alert ok">Not found in known data breaches.</div>)}
                {typeof breach === 'string' && breach !== 'checking' && <div className="alert error">{breach}</div>}
              </div>
            )}
          </>
        )}
        <div className="actions">
          <button type="button" className="btn icon" aria-label="Delete" onClick={onDelete}><TrashIcon /></button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          {!item.corrupt && <button type="button" className="btn primary" onClick={onEdit}><PencilIcon /> Edit</button>}
        </div>
      </div>
    </div>
  )
}

function TotpField({ totp, copy }) {
  const cfg = useMemo(() => { try { return parseTotp(totp) } catch (err) { return { error: err.message } } }, [totp])
  const [state, setState] = useState({ code: '', left: 0 })

  useEffect(() => {
    if (cfg.error) return
    let alive = true
    const tick = async () => {
      const code = await totpCode(cfg)
      if (alive) setState({ code, left: cfg.period - (Math.floor(Date.now() / 1000) % cfg.period) })
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => { alive = false; clearInterval(t) }
  }, [cfg])

  if (cfg.error) return <Field label="2FA code" value={cfg.error}><span className="neg small">{cfg.error}</span></Field>
  return (
    <Field label={`2FA code · ${state.left}s`} value={state.code} onCopy={() => copy(state.code, '2FA code')}>
      <span className="totp">{state.code.replace(/(\d{3})(?=\d)/g, '$1 ')}</span>
    </Field>
  )
}

function ItemForm({ initial, onClose, onSave }) {
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, initial[k] || ''])))
  const [showPw, setShowPw] = useState(!initial.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (form.totp) {
      try { parseTotp(form.totp) } catch (err) { return setError(err.message) }
    }
    setBusy(true)
    setError(null)
    // Password and notes are kept exactly as typed; everything else is trimmed.
    const data = { ...form, title: form.title.trim(), url: form.url.trim(), username: form.username.trim(), totp: form.totp.trim(), folder: form.folder.trim() }
    if (!data.title) data.title = hostOf(data.url) || 'Untitled'
    try { await onSave(data) } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{initial.id ? 'Edit item' : 'Add item'}</h3>
        <label>Name
          <input autoFocus={!initial.id} placeholder="e.g. HDFC NetBanking" value={form.title} onChange={set('title')} />
        </label>
        <label>Website
          <input type="url" inputMode="url" placeholder="https://…" value={form.url} onChange={set('url')} onBlur={() => form.url && !/^[a-z]+:\/\//i.test(form.url) && setForm((f) => ({ ...f, url: `https://${f.url}` }))} />
        </label>
        <label>Username or email
          <input autoComplete="off" autoCapitalize="none" spellCheck={false} value={form.username} onChange={set('username')} />
        </label>
        <label>Password
          <div className="field-row">
            <input className="mono grow" type={showPw ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={form.password} onChange={set('password')} />
            <button type="button" className="btn icon" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw(!showPw)}><EyeIcon off={showPw} /></button>
            <button type="button" className="btn icon" aria-label="Generate password" title="Generate password" onClick={() => { setForm((f) => ({ ...f, password: generatePassword() })); setShowPw(true) }}><DiceIcon /></button>
          </div>
        </label>
        <StrengthMeter password={form.password} />
        <label>2FA secret <span className="muted small">(optional — base32 key or otpauth:// link)</span>
          <input className="mono" autoComplete="off" autoCapitalize="none" spellCheck={false} value={form.totp} onChange={set('totp')} />
        </label>
        <label>Folder
          <input placeholder="e.g. Banking" value={form.folder} onChange={set('folder')} />
        </label>
        <label>Notes
          <textarea rows={3} value={form.notes} onChange={set('notes')} />
        </label>
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Encrypting…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
