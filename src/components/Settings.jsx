import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TrashIcon, PencilIcon, PasskeyIcon, FingerprintIcon, ChevronDownIcon } from '../lib/icons'
import { generatePin, manageMembers } from '../lib/members'
import { describeWebAuthnError, platformAuthenticatorAvailable, deviceName } from '../lib/webauthn'
import { fingerprintHere, MIN_MASTER_PASSWORD } from '../lib/useVault'
import { loadCategories as loadHisabCategories } from '../lib/hisab'
import { StrengthMeter } from './VaultGate'
import PhoneWidget from './PhoneWidget'
import { useDialog } from '../lib/dialog'
import { PALETTE, nextColor, householdColor } from '../lib/colors'
import { attachDigits, isCard, loadUnlinked, parseDigits, setHidden } from '../lib/instruments'
import { money } from '../lib/format'
import { setThemePref, themePref } from '../lib/theme'

export default function Settings({ accounts, categories, refresh, households, activeHouseholdId, setActiveHouseholdId, createHousehold, email, member, appLock, vault }) {
  const dialog = useDialog()
  return (
    <section className="grid2">
      <div style={{ gridColumn: '1 / -1' }}>
        {member ? (appLock ? <FingerprintCard appLock={appLock} /> : null)
          : <Households households={households} activeHouseholdId={activeHouseholdId} setActiveHouseholdId={setActiveHouseholdId} createHousehold={createHousehold} refresh={refresh} vault={vault} />}
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <Appearance />
      </div>
      {vault?.status === 'unlocked' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <SecurityCard vault={vault} member={member} />
        </div>
      )}
      <div style={{ gridColumn: '1 / -1' }}>
        <PhoneWidget Collapsible={Collapsible} households={households} activeHouseholdId={activeHouseholdId} member={member} />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <Passkeys />
      </div>
      <Accounts accounts={accounts} activeHouseholdId={activeHouseholdId} refresh={refresh} />
      {!member && activeHouseholdId && (
        <div style={{ gridColumn: '1 / -1' }}>
          <HisabCategories key={activeHouseholdId} householdId={activeHouseholdId} householdName={households.find((h) => h.id === activeHouseholdId)?.name} />
        </div>
      )}
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

// Dark (default) / Light / System — per device, applied at once (src/lib/theme.js).
const THEMES = [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']]
function Appearance() {
  const [pref, setPref] = useState(themePref)
  const pick = (v) => { setPref(v); setThemePref(v) }
  return (
    <Collapsible id="appearance" title="Appearance" summary={THEMES.find(([v]) => v === pref)[1] + (pref === 'system' ? ' (follows this phone)' : '')}>
      <div className="seg seg3" role="radiogroup" aria-label="Theme">
        {THEMES.map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={pref === v} className={pref === v ? 'on' : ''} onClick={() => pick(v)}>{label}</button>
        ))}
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>Just for this phone. System follows your phone's dark / light setting.</p>
    </Collapsible>
  )
}

// A Settings card that folds to its title + a one-line summary, so the page stays short.
// Open/closed is remembered per card on this device.
const OPEN_KEY = 'pocketos.settingsOpen'
function Collapsible({ id, title, summary, action, defaultOpen = false, children }) {
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}')[id] ?? defaultOpen } catch { return defaultOpen }
  })
  function toggle() {
    setOpen(!open)
    try { const all = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); all[id] = !open; localStorage.setItem(OPEN_KEY, JSON.stringify(all)) } catch { /* ignore */ }
  }
  return (
    <div className={`card coll ${open ? 'open' : ''}`}>
      <div className="coll-head">
        <button type="button" className="coll-toggle" aria-expanded={open} onClick={toggle}>
          <span className="grow">
            <span className="coll-title">{title}</span>
            {!open && summary && <span className="coll-sum">{summary}</span>}
          </span>
          <ChevronDownIcon />
        </button>
        {open && action}
      </div>
      {open && <div className="coll-body">{children}</div>}
    </div>
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
    <Collapsible id="passkeys" title="Passkeys" summary={`${passkeys.length} passkey${passkeys.length === 1 ? '' : 's'}`}>
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
    </Collapsible>
  )
}

// Owner: fingerprint unlock for this phone + change master password (same as Vault → Security,
// surfaced here because the fingerprint opens the whole app, not just the Vault).
function SecurityCard({ vault, member }) {
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
    <Collapsible id="security" title="Security" summary={`Fingerprint ${here ? 'on' : 'off'} on this phone`}>
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
      {!member && <div className="sec-row">
        <span className="sec-ico"><PasskeyIcon /></span>
        <div className="grow">
          <div className="sec-title">Master password</div>
          <div className="muted small">Opens eChopdo when fingerprint isn't available, on any device.</div>
        </div>
        <button className="btn small" onClick={() => { setChanging(true); setDone(null) }}>Change</button>
      </div>}
      {error && <div className="alert error">{error}</div>}
      {done && <div className="alert ok">{done}</div>}
      {changing && <ChangeMasterPassword vault={vault} onClose={() => setChanging(false)} onDone={() => { setChanging(false); setDone('Master password changed. Use the new one from now on.') }} />}
    </Collapsible>
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
    <Collapsible id="fingerprint" title="Fingerprint unlock" summary={appLock.enabled ? 'On' : 'Off'}>
      <p className="muted small">{appLock.enabled
        ? 'eChopdo asks for your fingerprint when it opens and after a minute in the background. Your PIN still works as a backup.'
        : 'Turn it on so eChopdo opens with your fingerprint instead of your PIN.'}</p>
      {appLock.enabled
        ? <button className="btn" onClick={appLock.disable}>Turn off</button>
        : <button className="btn primary" disabled={busy} onClick={enable}><FingerprintIcon /> {busy ? 'Waiting for fingerprint…' : 'Use my fingerprint'}</button>}
      {error && <div className="alert error">{error}</div>}
    </Collapsible>
  )
}

const slug = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 32) || 'family'
const ago = (iso) => {
  if (!iso) return 'never signed in'
  const d = Math.floor((Date.now() - new Date(iso)) / 86_400_000)
  return `last seen ${d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`}`
}

function Households({ households, activeHouseholdId, setActiveHouseholdId, createHousehold, refresh, vault }) {
  const dialog = useDialog()
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null) // household whose sheet is open
  const [members, setMembers] = useState(null)
  const [loginFor, setLoginFor] = useState(null) // household getting a new login
  const [share, setShare] = useState(null) // { household, username, pin, reset } shown once

  const [vaultOn, setVaultOn] = useState({}) // member user_id → has vault access
  const loadMembers = useCallback(async () => {
    try {
      const list = (await manageMembers('list')).members
      setMembers(list)
      if (list.length) {
        const { data } = await supabase.from('vault_unlockers').select('user_id').eq('kind', 'password').in('user_id', list.map((m) => m.user_id))
        setVaultOn(Object.fromEntries((data || []).map((r) => [r.user_id, true])))
      }
    } catch (err) { setError(err.message) }
  }, [])

  // Vault access for a household login: same master password as yours, same family vault key.
  async function enableVault(m) {
    const pw = await dialog.prompt({ title: `Give ${m.username} the Vault?`, message: 'They will unlock it with YOUR master password (then their fingerprint), and see only items you share with them plus what they add. Everything they add shows in your vault too.', label: 'Your master password', inputType: 'password', confirmLabel: 'Enable Vault' })
    if (!pw) return
    try { await vault.enableHouseholdVault(m.user_id, pw); loadMembers() } catch (err) { dialog.alert({ title: "Couldn't enable the Vault", message: err.message }) }
  }
  async function disableVault(m) {
    if (!await dialog.confirm({ title: `Turn off ${m.username}'s Vault?`, message: 'They lose access on every phone. Items they added stay in your vault.', confirmLabel: 'Turn off' })) return
    try { await vault.disableHouseholdVault(m.user_id); loadMembers() } catch (err) { setError(err.message) }
  }
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

  async function setOwnStartTab(h, startTab) {
    const { error } = await supabase.from('households').update({ start_tab: startTab }).eq('id', h.id)
    if (error) return setError(error.message)
    refresh()
  }

  async function recolor(h, color) {
    const { error } = await supabase.from('households').update({ color }).eq('id', h.id)
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
    <Collapsible id="households" title="Households" defaultOpen
      summary={`${households.length} household${households.length === 1 ? '' : 's'}${members?.length ? ` · ${members.length} login${members.length === 1 ? '' : 's'}` : ''}`}
      action={<button className="btn small primary" onClick={add}>+ Add</button>}>
      <p className="muted small">Tap a household to rename it or give it its own login. Members see only their household; you see everything.</p>
      <div className="hh-list">
        {households.map((h) => {
          const m = members?.find((x) => x.household_id === h.id)
          const active = h.id === activeHouseholdId
          return (
            <button key={h.id} className={`hh-item ${active ? 'on' : ''}`} onClick={() => setOpenId(h.id)}>
              <span className="hh-avatar" style={{ '--c': householdColor(h, households) }}>{h.name.slice(0, 1).toUpperCase()}</span>
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

      {open && <HouseholdSheet household={open} color={householdColor(open, households)} onColor={(c) => recolor(open, c)} member={members?.find((x) => x.household_id === open.id)} membersLoaded={members !== null}
        active={open.id === activeHouseholdId} onClose={() => setOpenId(null)}
        onSwitch={() => { setActiveHouseholdId(open.id); setOpenId(null) }}
        onRename={(next) => rename(open, next)} onDelete={() => remove(open)}
        onCreateLogin={() => setLoginFor(open)} onResetPin={(m) => resetPin(open, m)} onRemoveLogin={(m) => removeLogin(open, m)}
        onStartTab={setStartTab} onOwnStartTab={(t) => setOwnStartTab(open, t)} vaultOn={vaultOn} canVault={vault?.status === 'unlocked'} onEnableVault={enableVault} onDisableVault={disableVault} />}
      {loginFor && <LoginForm household={loginFor} taken={(members || []).map((x) => x.username)} onClose={() => setLoginFor(null)}
        onCreated={(username, pin) => { setShare({ household: loginFor, username, pin }); setLoginFor(null); loadMembers() }} />}
      {share && <ShareLogin {...share} onClose={() => setShare(null)} />}
    </Collapsible>
  )
}

const START_TABS = [['dashboard', 'Home'], ['transactions', 'Entries'], ['plan', 'Plan'], ['dues', 'Dues'], ['hisab', 'Hisab']]

function LoginBadge({ member, loading }) {
  if (loading) return null
  if (!member) return <span className="hh-badge none">No login</span>
  return member.fingerprint_at ? <span className="hh-badge ok">Fingerprint</span> : <span className="hh-badge pin">PIN only</span>
}

// Everything about one household in one bottom sheet: switch, rename, login, delete.
function HouseholdSheet({ household, color, onColor, member, membersLoaded, active, onClose, onSwitch, onRename, onDelete, onCreateLogin, onResetPin, onRemoveLogin, onStartTab, onOwnStartTab, vaultOn, canVault, onEnableVault, onDisableVault }) {
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
          <ColorPicker color={color} onChange={onColor} />
        </section>

        <section className="hh-sec">
          <label className="hh-start">Your app opens on
            <select value={household.start_tab || 'dashboard'} onChange={(e) => onOwnStartTab(e.target.value)}>
              {START_TABS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <div className="muted small">Where eChopdo opens for you when this household is open{member ? ` (their login has its own “Opens on” below)` : ''}.</div>
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
              {canVault && (
                <div className="hh-start">
                  <span>Vault {vaultOn[member.user_id] ? <span className="hh-badge ok">On</span> : <span className="hh-badge none">Off</span>}</span>
                  {vaultOn[member.user_id]
                    ? <button className="btn small" onClick={() => onDisableVault(member)}>Turn off</button>
                    : <button className="btn small primary" onClick={() => onEnableVault(member)}>Enable Vault</button>}
                </div>
              )}
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

const EMOJI_PICKS = ['🛍️', '👗', '🍽️', '🥦', '🍬', '🎁', '🪔', '🎉', '💐', '🚕', '⛽', '💄', '💊', '🏠', '📦', '👶', '📚', '🐄', '🧾', '📱', '🧹', '🙏', '🧧', '💵', '↩️', '☕']

// Owner: the icon grid shown when adding a Hisab entry, per household — add, rename, reorder, remove.
// Removing one doesn't touch old entries (they keep their category text).
function HisabCategories({ householdId, householdName }) {
  const dialog = useDialog()
  const [list, setList] = useState(null)
  const [dir, setDir] = useState('out')
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🏷️')
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    try { setList(await loadHisabCategories(householdId)); setError(null) } catch (err) { setError(err.message) }
  }, [householdId])
  useEffect(() => { load() }, [load])
  const shown = (list || []).filter((c) => c.direction === dir)

  async function add(e) {
    e.preventDefault()
    if (!name.trim()) return
    const position = shown.length ? Math.max(...shown.map((c) => c.position)) + 1 : 0
    const { error } = await supabase.from('hisab_categories').insert({ household_id: householdId, direction: dir, name: name.trim(), icon: icon || '🏷️', position })
    if (error) return setError(error.code === '23505' ? `"${name.trim()}" is already in the list.` : error.message)
    setName(''); setIcon('🏷️'); load()
  }
  async function move(c, delta) {
    const i = shown.indexOf(c), other = shown[i + delta]
    if (!other) return
    await Promise.all([
      supabase.from('hisab_categories').update({ position: other.position }).eq('id', c.id),
      supabase.from('hisab_categories').update({ position: c.position }).eq('id', other.id),
    ])
    // Positions can repeat after the seed; normalise once so swaps always move.
    if (c.position === other.position) await Promise.all(shown.map((x, j) => supabase.from('hisab_categories').update({ position: j === i ? i + delta : j === i + delta ? i : j }).eq('id', x.id)))
    load()
  }
  async function rename(c) {
    const next = await dialog.prompt({ title: 'Rename category', label: 'Name', defaultValue: c.name, confirmLabel: 'Save' })
    if (!next?.trim() || next.trim() === c.name) return
    const { error } = await supabase.from('hisab_categories').update({ name: next.trim() }).eq('id', c.id)
    if (error) return setError(error.message)
    load()
  }
  async function remove(c) {
    if (!await dialog.confirm({ title: `Remove "${c.name}"?`, message: 'It leaves the Hisab picker. Entries already saved with it keep it.', confirmLabel: 'Remove' })) return
    const { error } = await supabase.from('hisab_categories').delete().eq('id', c.id)
    if (error) return setError(error.message)
    load()
  }

  return (
    <Collapsible id="hisab-categories" title="Hisab categories"
      summary={list ? `${list.filter((c) => c.direction === 'out').length} spent · ${list.filter((c) => c.direction === 'in').length} received` : null}>
      <p className="muted small">The icons shown when adding a Hisab entry{householdName ? ` in ${householdName}` : ''}. Tap a name to rename; arrows change the order.</p>
      <div className="seg" style={{ marginBottom: 10 }}>
        <button type="button" className={dir === 'out' ? 'on expense' : ''} onClick={() => setDir('out')}>Spent</button>
        <button type="button" className={dir === 'in' ? 'on income' : ''} onClick={() => setDir('in')}>Received</button>
      </div>
      {!list ? <div className="muted small">Loading…</div> : (
        <div className="hc-list">
          {shown.map((c, i) => (
            <div className="hc-row" key={c.id}>
              <span className="hc-icon">{c.icon}</span>
              <button type="button" className="hc-name" onClick={() => rename(c)}>{c.name}</button>
              <button type="button" className="btn icon" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(c, -1)}>↑</button>
              <button type="button" className="btn icon" aria-label={`Move ${c.name} down`} disabled={i === shown.length - 1} onClick={() => move(c, 1)}>↓</button>
              <button type="button" className="btn icon" aria-label={`Remove ${c.name}`} onClick={() => remove(c)}><TrashIcon /></button>
            </div>
          ))}
          {shown.length === 0 && <div className="muted small pad">No categories — add one below.</div>}
        </div>
      )}
      <form className="hc-add" onSubmit={add}>
        <div className="hc-picks">
          {EMOJI_PICKS.map((e) => <button type="button" key={e} className={`hc-pick ${icon === e ? 'on' : ''}`} onClick={() => setIcon(e)}>{e}</button>)}
        </div>
        <div className="inline-form">
          <input className="hc-emoji" aria-label="Icon" value={icon} maxLength={4} onChange={(e) => setIcon(e.target.value)} />
          <input aria-label="Category name" placeholder={dir === 'out' ? 'e.g. Milk, Maid' : 'e.g. Rent received'} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" disabled={!name.trim()}>Add</button>
        </div>
      </form>
      {error && <div className="alert error">{error}</div>}
    </Collapsible>
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
    <Collapsible id="accounts" title="Accounts" summary={`${accounts.length} account${accounts.length === 1 ? '' : 's'}`}>
      <p className="muted small" style={{ marginTop: -6 }}>Give your bank accounts and cards their last digits (as bank SMS show them), and cards their bill and due days: card spends then build that card's bill in Plan, and bank spends count against this month.</p>
      <FromSms accounts={accounts} activeHouseholdId={activeHouseholdId} refresh={refresh} />
      {accounts.map((a) => (
        <div className="line" key={a.id}>
          <button type="button" className="line-btn" onClick={() => setEditing(a)}>
            <span className="dot" style={{ background: a.color || '#94a3b8' }} />{a.name}{' '}
            <span className="muted small">{a.type}{a.digits?.length ? ` · ••${a.digits.join(', ••')}` : ''}{isCard(a) && a.statement_day ? ` · bill ${a.statement_day}${a.due_day ? `, due ${a.due_day}` : ''}` : ''}</span>
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
    </Collapsible>
  )
}

// Bank + digits seen in this household's SMS that no account claims yet: link each to an
// account (or make one), choosing bank or card. Past payments with those digits follow.
function FromSms({ accounts, activeHouseholdId, refresh }) {
  const [rows, setRows] = useState(null)
  const [linking, setLinking] = useState(null)
  const [showHidden, setShowHidden] = useState(false)
  const [error, setError] = useState(null)
  const load = useCallback(() => {
    if (!activeHouseholdId) return
    loadUnlinked(activeHouseholdId).then(setRows).catch((err) => setError(err.message))
  }, [activeHouseholdId])
  useEffect(() => { load() }, [load, accounts])
  const hide = (r, hidden) => setHidden(activeHouseholdId, r, hidden).then(load).catch((err) => setError(err.message))
  if (error) return <div className="alert error">{error}</div>
  if (!rows?.length) return null
  const shown = rows.filter((r) => !r.hidden), hidden = rows.filter((r) => r.hidden)
  return (
    <div className="sms-found">
      <div className="muted small caps">Found in your SMS</div>
      {!shown.length && <div className="muted small">Nothing new to link.</div>}
      {shown.map((r) => (
        <div key={`${r.bank}:${r.digits}`} className="sms-found-row">
          <button type="button" className="grow sms-found-main" onClick={() => setLinking(r)}>
            <b>{r.bank || 'Bank'} ••{r.digits}</b> <span className="muted small">{r.card ? 'card' : 'account'}</span>
            <div className="muted small">{r.n} payment{r.n === 1 ? '' : 's'} · {money(r.total)} · last {new Date(`${r.last_seen}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
          </button>
          <button type="button" className="chip chip-btn" onClick={() => setLinking(r)}>Link</button>
          <button type="button" className="chip chip-btn" title="Closed account / not mine" onClick={() => hide(r, true)}>Hide</button>
        </div>
      ))}
      {hidden.length > 0 && (
        <button type="button" className="sms-hidden-toggle muted small" onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? 'Hide' : 'Show'} {hidden.length} hidden
        </button>
      )}
      {showHidden && hidden.map((r) => (
        <div key={`h-${r.bank}:${r.digits}`} className="sms-found-row hidden-row">
          <span className="grow muted small">{r.bank || 'Bank'} ••{r.digits} · {r.n} payment{r.n === 1 ? '' : 's'}</span>
          <button type="button" className="chip chip-btn" onClick={() => hide(r, false)}>Unhide</button>
        </div>
      ))}
      {linking && <LinkDigits row={linking} accounts={accounts} activeHouseholdId={activeHouseholdId}
        onClose={() => setLinking(null)} onDone={() => { setLinking(null); refresh(); load() }} />}
    </div>
  )
}

function LinkDigits({ row, accounts, activeHouseholdId, onClose, onDone }) {
  const [accountId, setAccountId] = useState('')
  const [name, setName] = useState(`${row.bank || 'Bank'} ${row.card ? 'card' : 'account'}`)
  const [type, setType] = useState(row.card ? 'card' : 'bank')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await attachDigits({ householdId: activeHouseholdId, accountId: accountId || null, name, type, bank: row.bank, digits: row.digits,
        color: nextColor(accounts.map((a) => a.color)) })
      onDone()
    } catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{row.bank} ••{row.digits}</h3>
        <p className="muted small">{row.n} payment{row.n === 1 ? '' : 's'} so far. Link these digits to one of your accounts, or add it as a new one.</p>
        <label>Account
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">+ New account</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name.trim()} ({a.type})</option>)}
          </select>
        </label>
        {!accountId && (
          <>
            <label>Name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
            <div className="seg">
              <button type="button" className={type === 'bank' ? 'on' : ''} onClick={() => setType('bank')}>Bank account</button>
              <button type="button" className={type === 'card' ? 'on' : ''} onClick={() => setType('card')}>Credit card</button>
            </div>
            {type === 'card' && <p className="muted small">After adding, tap the card to set its bill and due days.</p>}
          </>
        )}
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Linking…' : 'Link'}</button>
        </div>
      </form>
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
  const [form, setForm] = useState({ name: account.name, type: account.type, color: account.color || PALETTE[0],
    digits: (account.digits || []).join(', '), bank: account.bank || '', statement_day: account.statement_day || '', due_day: account.due_day || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const types = ACCOUNT_TYPES.includes(account.type) ? ACCOUNT_TYPES : [...ACCOUNT_TYPES, account.type]

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('accounts')
      .update({
        name: form.name.trim(), type: form.type, color: form.color, digits: parseDigits(form.digits), bank: form.bank.trim() || null,
        statement_day: form.type === 'card' ? Number(form.statement_day) || null : null,
        due_day: form.type === 'card' ? Number(form.due_day) || null : null,
      }).eq('id', account.id)
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
        <div className="grid2">
          <label>Last digits <span className="muted">(from SMS)</span>
            <input inputMode="numeric" placeholder="e.g. 1234" value={form.digits} onChange={set('digits')} />
          </label>
          <label>Bank
            <input placeholder="e.g. ICICI" value={form.bank} onChange={set('bank')} />
          </label>
        </div>
        {form.type === 'card' && (
          <>
            <div className="grid2">
              <label>Bill generated on <span className="muted">(day)</span>
                <input type="number" inputMode="numeric" min="1" max="31" placeholder="e.g. 15" value={form.statement_day} onChange={set('statement_day')} />
              </label>
              <label>Payment due on <span className="muted">(day)</span>
                <input type="number" inputMode="numeric" min="1" max="31" placeholder="e.g. 3" value={form.due_day} onChange={set('due_day')} />
              </label>
            </div>
            <p className="muted small">Spends up to the bill day go on that month's bill; later ones on the next. With a bill day set, the card gets a "{form.name.trim() || 'Card'} bill" line in Plan worked out from its spends.</p>
          </>
        )}
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
    <Collapsible id="categories" title="Categories" summary={`${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`}>
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
    </Collapsible>
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
