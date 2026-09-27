import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TrashIcon, PencilIcon, PasskeyIcon, FingerprintIcon } from '../lib/icons'
import { generatePin, manageMembers } from '../lib/members'
import { describeWebAuthnError } from '../lib/webauthn'
import { useDialog } from '../lib/dialog'
import { PALETTE, nextColor } from '../lib/colors'

export default function Settings({ accounts, categories, refresh, households, activeHouseholdId, setActiveHouseholdId, createHousehold, email, member, appLock }) {
  const dialog = useDialog()
  return (
    <section className="grid2">
      <div style={{ gridColumn: '1 / -1' }}>
        {member ? <FingerprintCard appLock={appLock} />
          : <Households households={households} activeHouseholdId={activeHouseholdId} setActiveHouseholdId={setActiveHouseholdId} createHousehold={createHousehold} refresh={refresh} />}
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
          <button className="btn small ghost" onClick={async () => {
            if (!await dialog.confirm({ title: 'Sign out?', message: member ? 'You can sign back in with your username and PIN.' : 'You can sign back in with Google or a passkey.', confirmLabel: 'Sign out', danger: false })) return
            if (member) appLock?.disable()
            supabase.auth.signOut()
          }}>Sign out</button>
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

// A household member's own lock setting (Settings replaces the Households card for them).
function FingerprintCard({ appLock }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  async function enable() {
    setBusy(true); setError(null)
    try { await appLock.enable() } catch (err) { setError(describeWebAuthnError(err)) }
    setBusy(false)
  }
  return (
    <div className="card">
      <h3>Fingerprint unlock</h3>
      <p className="muted small">{appLock.enabled
        ? 'PocketOS asks for your fingerprint when it opens and after a minute in the background. Your PIN still works as a backup.'
        : 'Turn it on so PocketOS opens with your fingerprint instead of your PIN.'}</p>
      {appLock.enabled
        ? <button className="btn" onClick={appLock.disable}>Turn off</button>
        : <button className="btn primary" disabled={busy} onClick={enable}><FingerprintIcon /> {busy ? 'Waiting for fingerprint…' : 'Use my fingerprint'}</button>}
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}

const slug = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 32) || 'family'
const ago = (iso) => {
  if (!iso) return 'never signed in'
  const d = Math.floor((Date.now() - new Date(iso)) / 86_400_000)
  return `last seen ${d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`}`
}

function Households({ households, activeHouseholdId, setActiveHouseholdId, createHousehold, refresh }) {
  const dialog = useDialog()
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [members, setMembers] = useState(null)
  const [loginFor, setLoginFor] = useState(null) // household getting a new login
  const [share, setShare] = useState(null) // { household, username, pin, reset } shown once

  const loadMembers = useCallback(async () => {
    try { setMembers((await manageMembers('list')).members) } catch (err) { setError(err.message) }
  }, [])
  useEffect(() => { loadMembers() }, [loadMembers])

  async function resetPin(h, m) {
    const pin = generatePin()
    if (!await dialog.confirm({ title: `New PIN for ${m.username}?`, message: 'The old PIN stops working. Their fingerprint unlock keeps working.', confirmLabel: 'Reset PIN', danger: false })) return
    try { await manageMembers('reset_pin', { householdId: h.id, userId: m.user_id, pin }); setShare({ household: h, username: m.username, pin, reset: true }) } catch (err) { setError(err.message) }
  }

  async function removeLogin(h, m) {
    if (!await dialog.confirm({ title: `Remove ${m.username}'s login?`, message: `They can no longer open "${h.name}". Everything they added stays in the household.`, confirmLabel: 'Remove login' })) return
    try { await manageMembers('remove', { householdId: h.id, userId: m.user_id }); loadMembers() } catch (err) { setError(err.message) }
  }

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
      <p className="muted small">Give a household its own login: they sign in with a username and 6-digit PIN, then use their fingerprint. They see only their household; you see everything.</p>
      {households.map((h) => {
        const m = members?.find((x) => x.household_id === h.id)
        return (
          <div className="hh-row" key={h.id}>
            <div className="line">
              <span>
                <button type="button" className="btn link" style={{ fontWeight: h.id === activeHouseholdId ? 700 : 400 }} onClick={() => setActiveHouseholdId(h.id)}>
                  {h.id === activeHouseholdId ? '● ' : '○ '}{h.name}
                </button>
              </span>
              <span>
                <button className="btn small ghost" onClick={() => rename(h)}>Rename</button>{' '}
                <button className="btn icon" aria-label={`Delete ${h.name}`} onClick={() => remove(h)}><TrashIcon /></button>
              </span>
            </div>
            <div className="hh-login">
              {members === null ? <span className="muted small">Checking logins…</span> : m ? (
                <>
                  <span className="grow">
                    <span className="hh-login-name">👤 {m.username}</span>
                    <span className="muted small"> · {m.fingerprint_at ? 'fingerprint on' : 'PIN only'} · {ago(m.last_sign_in_at)}</span>
                  </span>
                  <button className="btn small ghost" onClick={() => resetPin(h, m)}>Reset PIN</button>
                  <button className="btn icon" aria-label={`Remove ${m.username}'s login`} onClick={() => removeLogin(h, m)}><TrashIcon /></button>
                </>
              ) : <button className="btn small ghost" onClick={() => setLoginFor(h)}>+ Create login</button>}
            </div>
          </div>
        )
      })}
      {loginFor && <LoginForm household={loginFor} taken={(members || []).map((x) => x.username)} onClose={() => setLoginFor(null)}
        onCreated={(username, pin) => { setShare({ household: loginFor, username, pin }); setLoginFor(null); loadMembers() }} />}
      {share && <ShareLogin {...share} onClose={() => setShare(null)} />}
      <form className="inline-form" onSubmit={add}>
        <input required placeholder="New household name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary">Add</button>
      </form>
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}

function LoginForm({ household, taken, onClose, onCreated }) {
  const [username, setUsername] = useState(() => slug(household.name))
  const [pin, setPin] = useState(generatePin)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(e) {
    e.preventDefault()
    const u = username.trim().toLowerCase()
    if (taken.includes(u)) return setError(`"${u}" is already used.`)
    setBusy(true); setError(null)
    try { await manageMembers('create', { householdId: household.id, username: u, pin }); onCreated(u, pin) } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3>Login for {household.name}</h3>
        <p className="muted small">They'll see and edit only "{household.name}". No Vault, no other households.</p>
        <label>Username
          <input required autoCapitalize="none" spellCheck={false} pattern="[a-z0-9][a-z0-9._\-]{2,31}" value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))} />
        </label>
        <label className="form-field">6-digit PIN</label>
        <div className="inline-form">
          <input className="mono pin-input" inputMode="numeric" required pattern="\d{6}" maxLength={6} aria-label="6-digit PIN" value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <button type="button" className="btn small ghost" onClick={() => setPin(generatePin())}>New PIN</button>
        </div>
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || pin.length !== 6}>{busy ? 'Creating…' : 'Create login'}</button>
        </div>
      </form>
    </div>
  )
}

// Shown once after creating a login or resetting a PIN: the details to pass on.
function ShareLogin({ household, username, pin, reset, onClose }) {
  const [copied, setCopied] = useState(false)
  const text = `PocketOS${reset ? ' — new PIN' : ''} for ${household.name}\nOpen: ${location.origin}\nTap "Household login"\nUsername: ${username}\nPIN: ${pin}\nThen turn on your fingerprint.`
  async function copy() { try { await navigator.clipboard.writeText(text); setCopied(true) } catch { /* ignore */ } }
  async function send() { try { await navigator.share({ text }) } catch { /* cancelled */ } }
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{reset ? 'New PIN ready' : 'Login created'}</h3>
        <p className="muted small">Send these to them now — the PIN isn't shown again (you can always reset it).</p>
        <div className="share-login">
          <div><span className="muted small">Username</span><b className="mono">{username}</b></div>
          <div><span className="muted small">PIN</span><b className="mono">{pin}</b></div>
        </div>
        <div className="actions">
          <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          {navigator.share && <button className="btn" onClick={send}>Share…</button>}
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
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
