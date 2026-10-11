import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TrashIcon, PencilIcon, PasskeyIcon, FingerprintIcon, ChevronDownIcon } from '../lib/icons'
import { describeWebAuthnError, platformAuthenticatorAvailable, deviceName } from '../lib/webauthn'
import { fingerprintHere, MIN_MASTER_PASSWORD } from '../lib/useVault'
import { loadCategories as loadHisabCategories } from '../lib/hisab'
import { StrengthMeter } from './VaultGate'
import { useDialog } from '../lib/dialog'
import { PALETTE, nextColor } from '../lib/colors'
import { isCard, parseDigits } from '../lib/instruments'
import { setThemePref, themePref } from '../lib/theme'

export default function Settings({ accounts, categories, refresh, households, activeHouseholdId, email, member, appLock, vault }) {
  return (
    <section className="grid2">
      <div style={{ gridColumn: '1 / -1' }}>
        <Appearance />
      </div>
      {vault?.status === 'unlocked' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <SecurityCard vault={vault} member={member} />
        </div>
      )}
      <Accounts accounts={accounts} activeHouseholdId={activeHouseholdId} refresh={refresh} />
      {!member && activeHouseholdId && (
        <div style={{ gridColumn: '1 / -1' }}>
          <HisabCategories key={activeHouseholdId} householdId={activeHouseholdId} householdName={households.find((h) => h.id === activeHouseholdId)?.name} />
        </div>
      )}
      <Categories categories={categories} activeHouseholdId={activeHouseholdId} refresh={refresh} />
      <div style={{ gridColumn: '1 / -1' }}>
        <SignOutCard email={email} member={member} appLock={appLock} />
      </div>
    </section>
  )
}

// Signed-in name + Sign out (also used by the Shop module's settings).
export function SignOutCard({ email, member, appLock }) {
  const dialog = useDialog()
  return (
    <div className="card">
      <h3>Account</h3>
      <div className="line">
        <span className="muted small">Signed in as {email}</span>
        <button className="btn small ghost" onClick={async () => {
          if (!await dialog.confirm({ title: 'Sign out?', message: 'You can sign back in with your username and PIN or password.', confirmLabel: 'Sign out', danger: false })) return
          if (member) appLock?.disable()
          supabase.auth.signOut()
        }}>Sign out</button>
      </div>
    </div>
  )
}

// Dark (default) / Light / System — per device, applied at once (src/lib/theme.js).
const THEMES = [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']]
export function Appearance() {
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
export function Collapsible({ id, title, summary, action, defaultOpen = false, children }) {
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

// Owner: fingerprint unlock for this phone + change master password (same as Vault → Security,
// surfaced here because the fingerprint opens the whole app, not just the Vault).
export function SecurityCard({ vault, member }) {
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
          <div className="muted small">{here ? 'On for this phone — GRANDXGAMER opens with your fingerprint.' : available === false ? 'This browser has no fingerprint unlock.' : 'Off on this phone — you type the master password to open GRANDXGAMER.'}</div>
        </div>
        {here ? <span className="hh-badge ok">On</span> : available !== false && (
          <button className="btn small primary" disabled={busy} onClick={enable}>{busy ? 'Waiting…' : 'Turn on'}</button>
        )}
      </div>
      {!member && <div className="sec-row">
        <span className="sec-ico"><PasskeyIcon /></span>
        <div className="grow">
          <div className="sec-title">Master password</div>
          <div className="muted small">Opens GRANDXGAMER when fingerprint isn't available, on any device.</div>
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
export function FingerprintCard({ appLock }) {
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
        ? 'GRANDXGAMER asks for your fingerprint when it opens and after a minute in the background. Your PIN still works as a backup.'
        : 'Turn it on so GRANDXGAMER opens with your fingerprint instead of your PIN.'}</p>
      {appLock.enabled
        ? <button className="btn" onClick={appLock.disable}>Turn off</button>
        : <button className="btn primary" disabled={busy} onClick={enable}><FingerprintIcon /> {busy ? 'Waiting for fingerprint…' : 'Use my fingerprint'}</button>}
      {error && <div className="alert error">{error}</div>}
    </Collapsible>
  )
}

const EMOJI_PICKS = ['🎮', '🕹️', '🖥️', '🎧', '🍟', '🥤', '☕', '🍫', '💡', '🌐', '🏠', '🧾', '🔧', '🧹', '💵', '📦', '🎁', '🏆', '📱', '↩️']

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
