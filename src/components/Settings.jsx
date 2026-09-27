import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TrashIcon, PencilIcon, PasskeyIcon } from '../lib/icons'
import { useDialog } from '../lib/dialog'
import { PALETTE, nextColor } from '../lib/colors'

export default function Settings({ accounts, categories, refresh, households, activeHouseholdId, setActiveHouseholdId, createHousehold, email }) {
  const dialog = useDialog()
  return (
    <section className="grid2">
      <div style={{ gridColumn: '1 / -1' }}>
        <Households households={households} activeHouseholdId={activeHouseholdId} setActiveHouseholdId={setActiveHouseholdId} createHousehold={createHousehold} refresh={refresh} />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <Passkeys />
      </div>
      <Accounts accounts={accounts} activeHouseholdId={activeHouseholdId} refresh={refresh} />
      <Categories categories={categories} activeHouseholdId={activeHouseholdId} refresh={refresh} />
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h3>Account</h3>
        <div className="line">
          <span className="muted small">Signed in as {email}</span>
          <button className="btn small ghost" onClick={async () => (await dialog.confirm({ title: 'Sign out?', message: 'You can sign back in with Google or a passkey.', confirmLabel: 'Sign out', danger: false })) && supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    </section>
  )
}

function Passkeys() {
  const dialog = useDialog()
  const [passkeys, setPasskeys] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.auth.passkey.list()
    if (error) return setError(error.message)
    setPasskeys(data || [])
  }, [])

  useEffect(() => { load() }, [load])

  async function add() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.registerPasskey()
    setBusy(false)
    if (error) return setError(error.message)
    load()
  }

  async function rename(p) {
    const next = await dialog.prompt({ title: 'Rename passkey', label: 'Name', defaultValue: p.friendly_name || '' })
    if (!next) return
    const { error } = await supabase.auth.passkey.update({ passkeyId: p.id, friendlyName: next })
    if (error) return setError(error.message)
    load()
  }

  async function remove(p) {
    if (!await dialog.confirm({ title: `Remove passkey "${p.friendly_name || 'Passkey'}"?`, message: "You'll need Google or another passkey to sign in on that device.", confirmLabel: 'Remove' })) return
    const { error } = await supabase.auth.passkey.delete({ passkeyId: p.id })
    if (error) return setError(error.message)
    load()
  }

  return (
    <div className="card">
      <h3>Passkeys</h3>
      <p className="muted small" style={{ marginTop: -6 }}>Sign in to PocketOS with your fingerprint or face instead of Google.</p>
      <div className="pk-list">
        {passkeys.map((p) => (
          <div className="pk-row" key={p.id}>
            <span className="site-badge type" aria-hidden="true"><PasskeyIcon /></span>
            <div className="grow pk-text">
              <div className="ellipsis">{p.friendly_name || 'Passkey'}</div>
              <div className="muted small">Added {new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
            <button className="btn icon" aria-label={`Rename ${p.friendly_name || 'passkey'}`} onClick={() => rename(p)}><PencilIcon /></button>
            <button className="btn icon" aria-label={`Remove ${p.friendly_name || 'passkey'}`} onClick={() => remove(p)}><TrashIcon /></button>
          </div>
        ))}
        {passkeys.length === 0 && <p className="muted small" style={{ margin: 0 }}>No passkeys yet.</p>}
      </div>
      <button className="btn primary block" disabled={busy} onClick={add}>
        {busy ? 'Waiting for fingerprint…' : '+ Add a passkey for this device'}
      </button>
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}

function Households({ households, activeHouseholdId, setActiveHouseholdId, createHousehold, refresh }) {
  const dialog = useDialog()
  const [name, setName] = useState('')
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    try {
      await createHousehold(name.trim())
      setName('')
      setError(null)
    } catch (err) { setError(err.message) }
  }

  async function rename(h) {
    const next = await dialog.prompt({ title: 'Rename household', label: 'Name', defaultValue: h.name })
    if (!next || next === h.name) return
    const { error } = await supabase.from('households').update({ name: next }).eq('id', h.id)
    if (error) return setError(error.message)
    refresh()
  }

  async function remove(h) {
    if (households.length < 2) return dialog.alert({ title: "Can't delete your only household", message: 'Create another household first.' })
    if (!await dialog.confirm({ title: `Delete "${h.name}"?`, message: 'All its accounts, categories, transactions and plan items are deleted too. This can\'t be undone.' })) return
    const { error } = await supabase.from('households').delete().eq('id', h.id)
    if (error) return setError(error.message)
    if (h.id === activeHouseholdId) setActiveHouseholdId(households.find((x) => x.id !== h.id)?.id)
    refresh()
  }

  return (
    <div className="card">
      <h3>Households</h3>
      {households.map((h) => (
        <div className="line" key={h.id}>
          <span>
            <button type="button" className="btn link" style={{ fontWeight: h.id === activeHouseholdId ? 700 : 400 }} onClick={() => setActiveHouseholdId(h.id)}>
              {h.id === activeHouseholdId ? '● ' : '○ '}{h.name}
            </button>
          </span>
          <span>
            <button className="btn small ghost" onClick={() => rename(h)}>Rename</button>{' '}
            <button className="btn icon" onClick={() => remove(h)}><TrashIcon /></button>
          </span>
        </div>
      ))}
      <form className="inline-form" onSubmit={add}>
        <input required placeholder="New household name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary">Add</button>
      </form>
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}

const ACCOUNT_TYPES = ['bank', 'cash', 'card', 'wallet', 'investment']

function Accounts({ accounts, activeHouseholdId, refresh }) {
  const dialog = useDialog()
  const [form, setForm] = useState({ name: '', type: 'bank' })
  const [editing, setEditing] = useState(null) // account being edited
  const accountColors = accounts.map((a) => a.color)
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    const { error } = await supabase.from('accounts').insert({ ...form, name: form.name.trim(), color: nextColor(accountColors), household_id: activeHouseholdId })
    if (error) return setError(error.message)
    setForm({ name: '', type: 'bank' })
    setError(null)
    refresh()
  }

  return (
    <div className="card">
      <h3>Accounts</h3>
      {accounts.map((a) => (
        <div className="line" key={a.id}>
          <button type="button" className="line-btn" onClick={() => setEditing(a)}>
            <span className="dot" style={{ background: a.color || '#94a3b8' }} />{a.name} <span className="muted small">{a.type}</span>
          </button>
          <span>
            <button className="btn icon" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}><PencilIcon /></button>
            <button className="btn icon" aria-label={`Delete ${a.name}`} onClick={() => deleteAccount(a, dialog).then((ok) => ok && refresh()).catch((err) => setError(err.message))}><TrashIcon /></button>
          </span>
        </div>
      ))}
      <form className="inline-form" onSubmit={add}>
        <input required placeholder="Account name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <button className="btn primary">Add</button>
      </form>
      {error && <div className="alert error">{error}</div>}
      {editing && <AccountEditor account={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
    </div>
  )
}

// Asks (in-app) and deletes; resolves true if deleted. Says how much is linked to it first.
async function deleteAccount(account, dialog) {
  const [t, r] = await Promise.all([
    supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('account_id', account.id),
    supabase.from('recurring_items').select('id', { count: 'exact', head: true }).eq('account_id', account.id),
  ])
  const linked = [t.count && `${t.count} transaction${t.count === 1 ? '' : 's'}`, r.count && `${r.count} plan item${r.count === 1 ? '' : 's'}`].filter(Boolean)
  const message = linked.length
    ? `${linked.join(' and ')} ${linked.length === 1 && (t.count || r.count) === 1 ? 'uses' : 'use'} it. ${linked.length === 1 && (t.count || r.count) === 1 ? "It's" : "They're"} kept, just no longer linked to an account.`
    : 'Nothing is linked to it.'
  if (!await dialog.confirm({ title: `Delete account "${account.name}"?`, message })) return false
  const { error } = await supabase.from('accounts').delete().eq('id', account.id)
  if (error) throw error
  return true
}

function AccountEditor({ account, onClose, onSaved }) {
  const dialog = useDialog()
  const [form, setForm] = useState({ name: account.name, type: account.type, color: account.color || PALETTE[0]})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const types = ACCOUNT_TYPES.includes(account.type) ? ACCOUNT_TYPES : [...ACCOUNT_TYPES, account.type]

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('accounts')
      .update({ name: form.name.trim(), type: form.type, color: form.color }).eq('id', account.id)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved()
  }

  async function remove() {
    try { if (await deleteAccount(account, dialog)) onSaved() } catch (err) { setError(err.message) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3>Edit account</h3>
        <label>Name
          <input required autoFocus value={form.name} onChange={set('name')} />
        </label>
        <label>Type
          <select value={form.type} onChange={set('type')}>
            {types.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <ColorPicker color={form.color} onChange={(color) => setForm((f) => ({ ...f, color }))} />
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn icon" aria-label="Delete account" onClick={remove}><TrashIcon /></button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

function Categories({ categories, activeHouseholdId, refresh }) {
  const [form, setForm] = useState(() => ({ name: '', kind: 'expense', color: nextColor(categories.map((c) => c.color)) }))
  const [editing, setEditing] = useState(null) // category being edited
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    const { error } = await supabase.from('categories').insert({ ...form, name: form.name.trim(), household_id: activeHouseholdId })
    if (error) return setError(error.message)
    setForm({ ...form, name: '', color: nextColor([...categories.map((c) => c.color), form.color]) })
    setError(null)
    refresh()
  }

  return (
    <div className="card">
      <h3>Categories</h3>
      <p className="muted small" style={{ marginTop: -6 }}>Tap a category to rename it, change its colour or delete it.</p>
      {['expense', 'income'].map((k) => (
        <div key={k}>
          <div className="muted small caps">{k}</div>
          <div className="chips">
            {categories.filter((c) => c.kind === k).map((c) => (
              <button type="button" className="chip chip-btn" key={c.id} onClick={() => setEditing(c)}>
                <span className="dot" style={{ background: c.color }} />{c.name}
                <PencilIcon />
              </button>
            ))}
          </div>
        </div>
      ))}
      <form className="inline-form" onSubmit={add}>
        <input required placeholder="Category name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          <option value="expense">expense</option><option value="income">income</option>
        </select>
        <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        <button className="btn primary">Add</button>
      </form>
      {error && <div className="alert error">{error}</div>}
      {editing && <CategoryEditor category={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
    </div>
  )
}

function ColorPicker({ color, onChange }) {
  const current = (color || '').toLowerCase()
  return (
    <div className="form-field">
      <span className="muted small">Colour</span>
      <div className="swatches">
        {PALETTE.map((c) => (
          <button type="button" key={c} className={`swatch ${c === current ? 'on' : ''}`} style={{ background: c }}
            aria-label={`Colour ${c}`} aria-pressed={c === current} onClick={() => onChange(c)} />
        ))}
        <label className={`swatch custom ${PALETTE.includes(current) ? '' : 'on'}`} title="Custom colour" style={{ background: PALETTE.includes(current) ? undefined : color }}>
          <input type="color" value={color} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
        </label>
      </div>
    </div>
  )
}

function CategoryEditor({ category, onClose, onSaved }) {
  const dialog = useDialog()
  const [name, setName] = useState(category.name.trim())
  const [color, setColor] = useState(category.color)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('categories').update({ name: name.trim(), color }).eq('id', category.id)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved()
  }

  async function remove() {
    const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('category_id', category.id)
    const used = count ? `${count} transaction${count === 1 ? '' : 's'} will become uncategorised.` : 'No transactions use it.'
    if (!await dialog.confirm({ title: `Delete "${category.name.trim()}"?`, message: `${used} Plan items using it become uncategorised too.` })) return
    const { error } = await supabase.from('categories').delete().eq('id', category.id)
    if (error) return setError(error.message)
    onSaved()
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3>Edit category</h3>
        <span className={`kind-badge ${category.kind}`}>{category.kind === 'income' ? 'Income' : 'Expense'}</span>
        <label>Name
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <ColorPicker color={color} onChange={setColor} />
        <div className="chip preview"><span className="dot" style={{ background: color }} />{name || 'Category'}</div>
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn icon" aria-label="Delete category" onClick={remove}><TrashIcon /></button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
