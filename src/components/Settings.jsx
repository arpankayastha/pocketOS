import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TrashIcon, PencilIcon, PasskeyIcon, FingerprintIcon } from '../lib/icons'
import { generatePin, manageMembers } from '../lib/members'
import { describeWebAuthnError, platformAuthenticatorAvailable, deviceName } from '../lib/webauthn'
import { fingerprintHere, MIN_MASTER_PASSWORD } from '../lib/useVault'
import { StrengthMeter } from './VaultGate'
import { useDialog } from '../lib/dialog'
import { PALETTE, nextColor } from '../lib/colors'

export default function Settings({ accounts, categories, refresh, households, activeHouseholdId, setActiveHouseholdId, createHousehold, email, member, appLock, vault }) {
  const dialog = useDialog()
  return (
    <section className="grid2">
      <div style={{ gridColumn: '1 / -1' }}>
        {member ? <FingerprintCard appLock={appLock} />
          : <Households households={households} activeHouseholdId={activeHouseholdId} setActiveHouseholdId={setActiveHouseholdId} createHousehold={createHousehold} refresh={refresh} />}
      </div>
      {!member && vault?.status === 'unlocked' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <SecurityCard vault={vault} />
        </div>
      )}
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
      <p className="muted small" style={{ marginTop: -6 }}>Sign in to eChopdo with your fingerprint or face instead of Google.</p>
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

// Owner: fingerprint unlock for this phone + change master password (same as Vault → Security,
// surfaced here because the fingerprint opens the whole app, not just the Vault).
function SecurityCard({ vault }) {
  const [available, setAvailable] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [changing, setChanging] = useState(false)
  const [done, setDone] = useState(null)
  useEffect(() => { platformAuthenticatorAvailable().then(setAvailable) }, [])
  const here = fingerprintHere(vault.unlockers)

  async function enable() {
    setBusy(true); setError(null)
    try { await vault.addFingerprint(deviceName()); setDone('Fingerprint unlock is on for this phone.') } catch (err) { setError(describeWebAuthnError(err)) }
    setBusy(false)
  }

  return (
    <div className="card">
      <h3>Security</h3>
      <div className="sec-row">
        <span className="sec-ico"><FingerprintIcon /></span>
        <div className="grow">
          <div className="sec-title">Fingerprint unlock</div>
          <div className="muted small">{here ? 'On for this phone — eChopdo opens with your fingerprint.' : available === false ? 'This browser has no fingerprint unlock.' : 'Off on this phone — you type the master password to open eChopdo.'}</div>
        </div>
        {here ? <span className="hh-badge ok">On</span> : available !== false && (
          <button className="btn small primary" disabled={busy} onClick={enable}>{busy ? 'Waiting…' : 'Turn on'}</button>
        )}
      </div>
      <div className="sec-row">
        <span className="sec-ico"><PasskeyIcon /></span>
        <div className="grow">
          <div className="sec-title">Master password</div>
          <div className="muted small">Opens eChopdo when fingerprint isn't available, on any device.</div>
        </div>
        <button className="btn small" onClick={() => { setChanging(true); setDone(null) }}>Change</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {done && <div className="alert ok">{done}</div>}
      {changing && <ChangeMasterPassword vault={vault} onClose={() => setChanging(false)} onDone={() => { setChanging(false); setDone('Master password changed. Use the new one from now on.') }} />}
    </div>
  )
}

function ChangeMasterPassword({ vault, onClose, onDone }) {
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(e) {
    e.preventDefault()
    setError(null)
    if (pw.length < MIN_MASTER_PASSWORD) return setError(`Use at least ${MIN_MASTER_PASSWORD} characters.`)
    if (pw !== confirm) return setError("The two new passwords don't match.")
    setBusy(true)
    if (!await vault.checkPassword(current)) { setBusy(false); return setError('Current master password is wrong.') }
    try { await vault.changePassword(pw); onDone() } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3>Change master password</h3>
        <p className="muted small">Your data isn't re-encrypted — only the key that unlocks it — so this is instant. Fingerprint unlock and your recovery code keep working.</p>
        <label>Current master password<input type="password" autoComplete="current-password" required autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label>New master password<input type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <StrengthMeter password={pw} />
        <label>Confirm new master password<input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Change password'}</button>
        </div>
      </form>
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
        ? 'eChopdo asks for your fingerprint when it opens and after a minute in the background. Your PIN still works as a backup.'
        : 'Turn it on so eChopdo opens with your fingerprint instead of your PIN.'}</p>
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
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null) // household whose sheet is open
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

  // Which tab the member's app opens on; takes effect the next time they open the app.
  async function setStartTab(m, startTab) {
    setMembers((ms) => ms.map((x) => (x.user_id === m.user_id ? { ...x, start_tab: startTab } : x)))
    const { error } = await supabase.from('household_members').update({ start_tab: startTab }).eq('user_id', m.user_id).eq('household_id', m.household_id)
    if (error) { setError(error.message); loadMembers() }
  }

  async function removeLogin(h, m) {
    if (!await dialog.confirm({ title: `Remove ${m.username}'s login?`, message: `They can no longer open "${h.name}". Everything they added stays in the household.`, confirmLabel: 'Remove login' })) return
    try { await manageMembers('remove', { householdId: h.id, userId: m.user_id }); loadMembers() } catch (err) { setError(err.message) }
  }

  async function add() {
    const name = await dialog.prompt({ title: 'New household', label: 'Name', placeholder: "e.g. Parents' Home", confirmLabel: 'Create' })
    if (!name?.trim()) return
    try { await createHousehold(name.trim()); setError(null) } catch (err) { setError(err.message) }
  }

  async function rename(h, next) {
    const { error } = await supabase.from('households').update({ name: next }).eq('id', h.id)
    if (error) return setError(error.message)
    refresh()
  }

  async function remove(h) {
    if (households.length < 2) return dialog.alert({ title: "Can't delete your only household", message: 'Create another household first.' })
    if (!await dialog.confirm({ title: `Delete "${h.name}"?`, message: 'All its accounts, categories, entries, plan items, dues and Hisab books are deleted too — and its login, if it has one. This can\'t be undone.', confirmLabel: 'Delete household' })) return
    const m = members?.find((x) => x.household_id === h.id)
    try { if (m) await manageMembers('remove', { householdId: h.id, userId: m.user_id }) } catch (err) { return setError(err.message) }
    const { error } = await supabase.from('households').delete().eq('id', h.id)
    if (error) return setError(error.message)
    setOpenId(null)
    if (h.id === activeHouseholdId) setActiveHouseholdId(households.find((x) => x.id !== h.id)?.id)
    refresh(); loadMembers()
  }

  const open = households.find((h) => h.id === openId)
  return (
    <div className="card">
      <div className="card-head">
        <h3>Households</h3>
        <button className="btn small primary" onClick={add}>+ Add</button>
      </div>
      <p className="muted small">Tap a household to rename it or give it its own login. Members see only their household; you see everything.</p>
      <div className="hh-list">
        {households.map((h, i) => {
          const m = members?.find((x) => x.household_id === h.id)
          const active = h.id === activeHouseholdId
          return (
            <button key={h.id} className={`hh-item ${active ? 'on' : ''}`} onClick={() => setOpenId(h.id)}>
              <span className="hh-avatar" style={{ '--c': PALETTE[i % PALETTE.length] }}>{h.name.slice(0, 1).toUpperCase()}</span>
              <span className="grow">
                <span className="hh-item-name">{h.name}{active && <span className="pill">Active</span>}</span>
                <span className="hh-item-sub">{members === null ? 'Checking login…' : m ? `@${m.username} · ${ago(m.last_sign_in_at)}` : 'Only you'}</span>
              </span>
              <LoginBadge member={m} loading={members === null} />
              <span className="hh-chev" aria-hidden="true">›</span>
            </button>
          )
        })}
      </div>
      {error && <div className="alert error">{error}</div>}

      {open && <HouseholdSheet household={open} color={PALETTE[households.indexOf(open) % PALETTE.length]} member={members?.find((x) => x.household_id === open.id)} membersLoaded={members !== null}
        active={open.id === activeHouseholdId} onClose={() => setOpenId(null)}
        onSwitch={() => { setActiveHouseholdId(open.id); setOpenId(null) }}
        onRename={(next) => rename(open, next)} onDelete={() => remove(open)}
        onCreateLogin={() => setLoginFor(open)} onResetPin={(m) => resetPin(open, m)} onRemoveLogin={(m) => removeLogin(open, m)}
        onStartTab={setStartTab} />}
      {loginFor && <LoginForm household={loginFor} taken={(members || []).map((x) => x.username)} onClose={() => setLoginFor(null)}
        onCreated={(username, pin) => { setShare({ household: loginFor, username, pin }); setLoginFor(null); loadMembers() }} />}
      {share && <ShareLogin {...share} onClose={() => setShare(null)} />}
    </div>
  )
}

const START_TABS = [['dashboard', 'Home'], ['transactions', 'Entries'], ['plan', 'Plan'], ['dues', 'Dues'], ['hisab', 'Hisab']]

function LoginBadge({ member, loading }) {
  if (loading) return null
  if (!member) return <span className="hh-badge none">No login</span>
  return member.fingerprint_at ? <span className="hh-badge ok">Fingerprint</span> : <span className="hh-badge pin">PIN only</span>
}

// Everything about one household in one bottom sheet: switch, rename, login, delete.
function HouseholdSheet({ household, color, member, membersLoaded, active, onClose, onSwitch, onRename, onDelete, onCreateLogin, onResetPin, onRemoveLogin, onStartTab }) {
  const [name, setName] = useState(household.name)
  const changed = name.trim() && name.trim() !== household.name
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal hh-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="hh-sheet-head">
          <span className="hh-avatar big" style={{ '--c': color }}>{household.name.slice(0, 1).toUpperCase()}</span>
          <div className="grow">
            <h3>{household.name}</h3>
            <span className="muted small">{active ? 'You are viewing this household' : 'Not currently open'}</span>
          </div>
          {!active && <button className="btn small" onClick={onSwitch}>Open</button>}
        </div>

        <section className="hh-sec">
          <div className="hh-sec-title">Name</div>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (changed) onRename(name.trim()) }}>
            <input aria-label="Household name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn small" disabled={!changed}>Save</button>
          </form>
        </section>

        <section className="hh-sec">
          <div className="hh-sec-title">Family login</div>
          {!membersLoaded ? <div className="muted small">Checking…</div> : member ? (
            <div className="hh-login-card">
              <div className="hh-login-top">
                <span className="hh-login-user">@{member.username}</span>
                <LoginBadge member={member} />
              </div>
              <div className="muted small">{member.fingerprint_at ? 'Opens with their fingerprint; PIN works as backup.' : 'Signs in with username + PIN. Fingerprint not set up yet.'} {ago(member.last_sign_in_at).replace(/^./, (c) => c.toUpperCase())}.</div>
              <label className="hh-start">Opens on
                <select value={member.start_tab || 'dashboard'} onChange={(e) => onStartTab(member, e.target.value)}>
                  {START_TABS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <div className="hh-login-actions">
                <button className="btn small" onClick={() => onResetPin(member)}>Reset PIN</button>
                <button className="btn small danger-ghost" onClick={() => onRemoveLogin(member)}>Remove login</button>
              </div>
            </div>
          ) : (
            <div className="hh-login-empty">
              <p className="muted small">Let someone in this household use eChopdo on their own phone. They sign in once with a username and 6-digit PIN, then use their fingerprint. They'll see only "{household.name}".</p>
              <button className="btn primary small" onClick={onCreateLogin}>+ Create login</button>
            </div>
          )}
        </section>

        <section className="hh-sec">
          <button className="btn small danger-ghost" onClick={onDelete}><TrashIcon /> Delete household</button>
        </section>

        <div className="actions"><button className="btn" onClick={onClose}>Done</button></div>
      </div>
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
  const text = `eChopdo${reset ? ' — new PIN' : ''} for ${household.name}\nOpen: ${location.origin}\nTap "Household login"\nUsername: ${username}\nPIN: ${pin}\nThen turn on your fingerprint.`
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
