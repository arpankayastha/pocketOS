import { useEffect, useId, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { householdColor } from '../lib/colors'
import { copySecret, generatePassword, parseTotp, pwnedCount, totpCode } from '../lib/vaultTools'
import { VAULT_TYPES, typeOf, itemTitle, itemSubtitle, searchText, formatMonth } from '../lib/vaultTypes'
import { CopyIcon, EyeIcon, DiceIcon, PencilIcon, TrashIcon } from '../lib/icons'
import { StrengthMeter } from './VaultGate'
import { useDialog } from '../lib/dialog'

// Row/sharing info added by useVault, never encrypted into the item.
const META = ['id', 'created_at', 'updated_at', 'corrupt', 'owner_id', 'household_ids', 'mine']
const quickCopyField = (item) => typeOf(item).fields.find((f) => f.copy && f.kind === 'secret' && item[f.key])

// `open` (item being viewed) and `editing` (item being edited; {} = pick a type first) live in
// VaultModule so the add button and the Security tab can open them; it clears them on lock.
// Owner: households (+ which have a login) for the "Shared with" chips and "by …" labels.
function useHouseholds(enabled) {
  const [data, setData] = useState({ households: [], members: [] })
  useEffect(() => {
    if (!enabled) return
    Promise.all([
      supabase.from('households').select('id, name, color, created_at').order('created_at'),
      supabase.from('household_members').select('household_id, user_id, username'),
    ]).then(([h, m]) => setData({ households: h.data || [], members: m.data || [] }))
  }, [enabled])
  return data
}

export default function VaultItems({ vault, member, open: openRaw, setOpen, editing, setEditing }) {
  const { households, members } = useHouseholds(!member)
  const [sharedBy, setSharedBy] = useState(null) // member: the owner's household name, e.g. "Arpan"
  useEffect(() => { if (member) supabase.rpc('family_owner_name').then(({ data }) => setSharedBy(data)) }, [member])
  // Keep the open item in step with the list (e.g. after changing who it's shared with).
  const open = openRaw && (vault.items.find((i) => i.id === openRaw.id) || openRaw)
  const byHousehold = (item) => {
    if (item.mine) return null
    const m = members.find((x) => x.user_id === item.owner_id)
    return m ? households.find((h) => h.id === m.household_id) : null
  }
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [toast, setToast] = useState(null)
  const dialog = useDialog()

  const counts = useMemo(() => {
    const c = {}
    for (const i of vault.items) c[typeOf(i).id] = (c[typeOf(i).id] || 0) + 1
    return c
  }, [vault.items])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vault.items
      .filter((i) => typeFilter === 'all' || typeOf(i).id === typeFilter)
      .filter((i) => !q || searchText(i).includes(q))
      .sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), undefined, { sensitivity: 'base' }))
  }, [vault.items, query, typeFilter])

  async function copy(text, what) {
    try {
      await copySecret(text)
      setToast(`${what} copied — clipboard clears in 30s`)
    } catch { setToast("Couldn't copy — your browser blocked clipboard access.") }
    setTimeout(() => setToast(null), 2500)
  }

  const usedTypes = VAULT_TYPES.filter((t) => counts[t.id])

  return (
    <section>
      <div className="toolbar">
        <input type="search" placeholder={`Search ${vault.items.length} item${vault.items.length === 1 ? '' : 's'}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {usedTypes.length > 1 && (
        <div className="type-chips no-swipe">
          <button className={typeFilter === 'all' ? 'on' : ''} onClick={() => setTypeFilter('all')}>All <span>{vault.items.length}</span></button>
          {usedTypes.map((t) => (
            <button key={t.id} className={typeFilter === t.id ? 'on' : ''} onClick={() => setTypeFilter(t.id)}><t.icon /> {t.label} <span>{counts[t.id]}</span></button>
          ))}
        </div>
      )}
      <div className="card list">
        {shown.map((i) => {
          const t = typeOf(i)
          const qc = quickCopyField(i)
          return (
            <div className="txn vault-row" key={i.id} role="button" tabIndex={0} onClick={() => setOpen(i)} onKeyDown={(e) => e.key === 'Enter' && setOpen(i)}>
              <TypeBadge item={i} />
              <span className="grow">
                <div className="ellipsis">{itemTitle(i)}</div>
                <div className="muted small ellipsis">{itemSubtitle(i) || t.label}{i.folder && <> · {i.folder}</>}</div>
              </span>
              <ShareTags item={i} member={member} households={households} by={byHousehold(i)} />
              {qc && (
                <button className="btn icon" title={`Copy ${qc.label.toLowerCase()}`} aria-label={`Copy ${qc.label.toLowerCase()}`} onClick={(e) => { e.stopPropagation(); copy(i[qc.key], qc.label) }}><CopyIcon /></button>
              )}
            </div>
          )
        })}
        {shown.length === 0 && (
          <p className="muted pad">{vault.items.length ? 'No items match.' : 'Your vault is empty. Tap + to add a password, card, bank account, ID and more — or import from LastPass in Security.'}</p>
        )}
      </div>

      {open && !editing && (
        <ItemView item={open} copy={copy} onClose={() => setOpen(null)} onEdit={() => setEditing(open)}
          readOnly={member && !open.mine} sharedBy={sharedBy} by={byHousehold(open)}
          share={member ? null : { households, members, onChange: (ids) => vault.shareItem(open.id, ids) }}
          onDelete={async () => {
            if (!await dialog.confirm({ title: `Delete "${itemTitle(open)}"?`, message: `This ${typeOf(open).label.toLowerCase()} is removed from your vault for good.` })) return
            await vault.deleteItem(open.id)
            setOpen(null)
          }} />
      )}
      {editing && !editing.id && !editing.type && (
        <TypePicker onClose={() => setEditing(null)} onPick={(type) => setEditing({ type })} />
      )}
      {editing && (editing.id || editing.type) && (
        <ItemForm initial={editing} onClose={() => setEditing(null)} onBack={editing.id ? null : () => setEditing({})}
          onSave={async (data) => {
            await vault.saveItem(data, editing.id)
            setEditing(null)
            setOpen(editing.id ? { id: editing.id, ...data } : null)
          }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  )
}

function TypeBadge({ item }) {
  const t = typeOf(item)
  if (t.id === 'password') return <span className="site-badge" aria-hidden="true">{itemTitle(item).slice(0, 1).toUpperCase()}</span>
  return <span className="site-badge type" aria-hidden="true"><t.icon /></span>
}

function TypePicker({ onClose, onPick }) {
  const groups = [...new Set(VAULT_TYPES.map((t) => t.group))]
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="view-head">
          <button type="button" className="btn icon" aria-label="Back" onClick={onClose}>←</button>
          <h3>Add item</h3>
        </div>
        <div className="type-list">
          {groups.map((g) => (
            <div className="type-group" key={g}>
              {VAULT_TYPES.filter((t) => t.group === g).map((t) => (
                <button key={t.id} className="type-option" onClick={() => onPick(t.id)}>
                  <t.icon /><span>{t.label}{t.pickerHint && <span className="muted small"> · {t.pickerHint}</span>}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  )
}

function Field({ label, value, secret, multiline, onCopy, children }) {
  const [shown, setShown] = useState(!secret)
  if (!value && !children) return null
  const text = shown ? value : '•'.repeat(12)
  return (
    <div className="field">
      <div className="muted small">{label}</div>
      <div className="field-row">
        <span className={`grow field-value ${secret ? 'mono' : ''} ${multiline && shown ? 'notes' : ''}`}>{children || text}</span>
        {secret && <button type="button" className="btn icon" aria-label={shown ? `Hide ${label}` : `Show ${label}`} onClick={() => setShown(!shown)}><EyeIcon off={shown} /></button>}
        {onCopy && <button type="button" className="btn icon" aria-label={`Copy ${label.toLowerCase()}`} onClick={onCopy}><CopyIcon /></button>}
      </div>
    </div>
  )
}

// Small coloured household dots (owner) / "Shared" tag (member) on a list row.
function ShareTags({ item, member, households, by }) {
  if (member) return item.mine ? null : <span className="vault-tag">Shared</span>
  const dots = households.filter((h) => item.household_ids.includes(h.id))
  if (!dots.length && !by) return null
  return (
    <span className="vault-dots" title={by ? `Added by ${by.name}` : `Shared with ${dots.map((h) => h.name).join(', ')}`}>
      {(by ? [by, ...dots.filter((h) => h.id !== by.id)] : dots).map((h) => (
        <span key={h.id} className="vault-dot" style={{ '--c': householdColor(h, households) }}>{h.name.slice(0, 1).toUpperCase()}</span>
      ))}
    </span>
  )
}

// Owner: tap households to share an item with them (they see it read-only in their vault).
function ShareWith({ item, share, by }) {
  const withLogin = share.households.filter((h) => share.members.some((m) => m.household_id === h.id))
  const [busy, setBusy] = useState(false)
  if (!withLogin.length) return null
  async function toggle(h) {
    const ids = item.household_ids.includes(h.id) ? item.household_ids.filter((x) => x !== h.id) : [...item.household_ids, h.id]
    setBusy(true)
    try { await share.onChange(ids) } finally { setBusy(false) }
  }
  return (
    <div className="share-with">
      <div className="hh-sec-title">{by ? `Added by ${by.name} · also share with` : 'Share with'}</div>
      <div className="chips">
        {withLogin.filter((h) => !by || h.id !== by.id).map((h) => {
          const on = item.household_ids.includes(h.id)
          return (
            <button type="button" key={h.id} disabled={busy} className={`chip chip-btn share-chip ${on ? 'on' : ''}`} style={{ '--c': householdColor(h, share.households) }}
              aria-pressed={on} onClick={() => toggle(h)}>
              <span className="vault-dot">{h.name.slice(0, 1).toUpperCase()}</span>{h.name}{on && ' ✓'}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ItemView({ item, copy, onClose, onEdit, onDelete, readOnly, sharedBy, by, share }) {
  const t = typeOf(item)
  const [breach, setBreach] = useState(null) // null | 'checking' | number | error text

  async function check() {
    setBreach('checking')
    try { setBreach(await pwnedCount(item.password)) } catch (err) { setBreach(err.message) }
  }

  const notes = item.notes && <Field label={t.notesLabel || 'Notes'} value={item.notes}><span className="notes">{item.notes}</span></Field>

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="view-head">
          <TypeBadge item={item} />
          <div className="grow"><h3>{itemTitle(item)}</h3><div className="muted small">{t.label}</div></div>
        </div>
        {item.corrupt ? <div className="alert error">This item couldn't be decrypted. It may have been damaged.</div> : (
          <>
            {t.notesFirst && notes}
            {t.fields.map((fl) => {
              const v = item[fl.key]
              if (!v) return null
              const onCopy = fl.copy ? () => copy(v, fl.label) : null
              if (fl.kind === 'totp') return <TotpField key={fl.key} totp={v} copy={copy} />
              if (fl.kind === 'url') {
                const href = /^[a-z]+:\/\//i.test(v) ? v : `https://${v}`
                return <Field key={fl.key} label={fl.label} value={v}><a href={href} target="_blank" rel="noopener noreferrer">{v}</a></Field>
              }
              return (
                <Field key={fl.key} label={fl.label} onCopy={onCopy} secret={fl.kind === 'secret' || fl.kind === 'secretarea'}
                  multiline={fl.kind === 'textarea' || fl.kind === 'secretarea'} value={fl.kind === 'month' ? formatMonth(v) : v} />
              )
            })}
            {!t.notesFirst && notes}
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
        {share && !item.corrupt && <ShareWith item={item} share={share} by={by} />}
        {readOnly && <div className="muted small">Shared by {sharedBy || 'the family admin'}</div>}
        <div className="actions">
          {!readOnly && <button type="button" className="btn icon" aria-label="Delete" onClick={onDelete}><TrashIcon /></button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          {!item.corrupt && !readOnly && <button type="button" className="btn primary" onClick={onEdit}><PencilIcon /> Edit</button>}
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

const DATE_RE = { date: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/ }

function ItemForm({ initial, onClose, onBack, onSave }) {
  const t = typeOf(initial)
  // Keep every key the item already has (e.g. extra fields from an import); META is dropped on save.
  const [form, setForm] = useState(() => ({ title: '', folder: '', notes: '', ...initial, type: t.id }))
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
    const keepAsTyped = new Set(['notes', ...t.fields.filter((fl) => ['secret', 'secretarea', 'textarea'].includes(fl.kind)).map((fl) => fl.key)])
    const data = {}
    for (const [k, v] of Object.entries(form)) {
      if (META.includes(k) || v === '' || v == null) continue
      data[k] = typeof v === 'string' && !keepAsTyped.has(k) ? v.trim() : v
    }
    for (const fl of t.fields) {
      if (fl.kind === 'url' && data[fl.key] && !/^[a-z][a-z0-9+.-]*:\/\//i.test(data[fl.key])) data[fl.key] = `https://${data[fl.key]}`
    }
    if (!data.title) data.title = itemTitle(data)
    try { await onSave(data) } catch (err) { setError(err.message); setBusy(false) }
  }

  const notes = (
    <label key="notes">{t.notesLabel || 'Notes'}
      <textarea rows={t.notesFirst ? 8 : 3} autoFocus={t.notesFirst && !initial.id} value={form.notes || ''} onChange={set('notes')} />
    </label>
  )

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="view-head">
          <span className="site-badge type" aria-hidden="true"><t.icon /></span>
          <h3 className="grow">{initial.id ? `Edit ${t.label.toLowerCase()}` : `Add ${t.label.toLowerCase()}`}</h3>
          {onBack && <button type="button" className="btn small ghost" onClick={onBack}>Change type</button>}
        </div>
        {t.hint && <p className="muted small" style={{ margin: 0 }}>{t.hint}</p>}
        <label>Name
          <input autoFocus={!initial.id && !t.notesFirst} placeholder={t.titleFrom ? 'Leave blank to name it automatically' : `e.g. ${t.label}`} value={form.title || ''} onChange={set('title')} />
        </label>
        {t.notesFirst && notes}
        {t.fields.map((fl) => <FieldInput key={fl.key} field={fl} value={form[fl.key] || ''} onChange={set(fl.key)}
          onGenerate={fl.key === 'password' ? () => setForm((f) => ({ ...f, password: generatePassword() })) : null} />)}
        {!t.notesFirst && notes}
        <label>Folder
          <input placeholder="e.g. Banking" value={form.folder || ''} onChange={set('folder')} />
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

function FieldInput({ field, value, onChange, onGenerate }) {
  const [shown, setShown] = useState(!value) // new secrets visible while typing; existing ones hidden
  const id = useId()
  const common = { id, value, onChange, autoComplete: 'off', spellCheck: false }
  let input
  if (field.kind === 'select') {
    const options = value && !field.options.includes(value) ? [...field.options, value] : field.options
    input = <select {...common}><option value="">—</option>{options.map((o) => <option key={o}>{o}</option>)}</select>
  } else if (field.kind === 'textarea' || field.kind === 'secretarea') {
    input = <textarea rows={4} className={`mono ${field.kind === 'secretarea' && !shown ? 'masked' : ''}`} {...common} />
  } else {
    // Imported dates in other formats (e.g. "March,2027") fall back to plain text so nothing is lost.
    const dateKind = DATE_RE[field.kind] && (!value || DATE_RE[field.kind].test(value)) ? field.kind : null
    const type = field.kind === 'secret' ? (shown ? 'text' : 'password')
      : dateKind || ({ email: 'email', tel: 'tel', number: 'number' })[field.kind] || 'text'
    // URLs use a text input so "bank.com" (no https://) doesn't block the form; https:// is added on save.
    input = <input className={field.kind === 'secret' || field.kind === 'totp' ? 'mono grow' : 'grow'} type={type}
      inputMode={field.inputMode || (field.kind === 'url' ? 'url' : undefined)} placeholder={field.kind === 'url' ? 'e.g. bank.com' : undefined}
      autoCapitalize="none" {...(field.kind === 'totp' ? { placeholder: 'base32 key or otpauth:// link (optional)' } : {})} {...common}
      autoComplete={field.key === 'password' ? 'new-password' : 'off'} />
  }
  const hideable = field.kind === 'secret' || field.kind === 'secretarea'
  return (
    <>
      {/* Buttons sit outside the <label> so they don't become part of the field's accessible name. */}
      <div className="form-field">
        <label htmlFor={id}>{field.label}</label>
        <div className="field-row">
          {input}
          {hideable && <button type="button" className="btn icon" aria-label={shown ? `Hide ${field.label}` : `Show ${field.label}`} onClick={() => setShown(!shown)}><EyeIcon off={shown} /></button>}
          {onGenerate && <button type="button" className="btn icon" aria-label="Generate password" title="Generate password" onClick={() => { onGenerate(); setShown(true) }}><DiceIcon /></button>}
        </div>
      </div>
      {field.key === 'password' && <StrengthMeter password={value} />}
    </>
  )
}
