import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useDialog } from '../../lib/dialog'
import { DAY_NAMES, durLabel, rs } from '../../lib/shop'
import { Appearance, Collapsible, FingerprintCard, SecurityCard, SignOutCard } from '../Settings'
import { Chips, Sheet, SheetActions } from './ui'
import { uploadShopImage } from '../../lib/media'
import Passkeys from '../Passkeys'

// Shop ⚙: systems and the rate card (admin), then the per-login cards everyone has.
export default function ShopSettings({ shop, householdId, admin, email, member, appLock, vault, toast }) {
  return (
    <section className="gx-split even">
      {admin && <div className="gx-col">
        <Systems shop={shop} householdId={householdId} toast={toast} />
        <Rates shop={shop} householdId={householdId} toast={toast} />
      </div>}
      <div className="gx-col">
      {admin && <HomePage shop={shop} householdId={householdId} toast={toast} />}
      {admin && <OnlineBooking shop={shop} householdId={householdId} toast={toast} />}
      <PaymentAlerts toast={toast} />
      {admin && <Payments shop={shop} householdId={householdId} toast={toast} />}
      {admin && <LoginPassword toast={toast} />}
      <Passkeys Wrap={Collapsible} withGoogle />
      <Appearance />
      {vault?.status === 'unlocked' && <SecurityCard vault={vault} member={member} />}
      {member && appLock && <FingerprintCard appLock={appLock} />}
      <SignOutCard email={email} member={member} appLock={appLock} />
      </div>
    </section>
  )
}

function Systems({ shop, householdId, toast }) {
  const dialog = useDialog()
  const [all, setAll] = useState(null)
  const load = useCallback(async () => {
    const { data } = await supabase.from('shop_systems').select('*').eq('household_id', householdId).order('sort').order('name')
    setAll(data || [])
  }, [householdId])
  useEffect(() => { load() }, [load])
  if (all === null) return null

  async function add() {
    const name = await dialog.prompt({ title: 'New system', label: 'Name (e.g. PC6, PS5-2)', confirmLabel: 'Next' })
    if (!name?.trim()) return
    const ps = await dialog.confirm({ title: `${name.trim()}: what is it?`, message: 'PlayStation systems use the PS rates, PCs the PC rates.', confirmLabel: 'PlayStation', cancelLabel: 'PC', danger: false })
    const { error } = await supabase.from('shop_systems').insert({ household_id: householdId, name: name.trim(), kind: ps ? 'PS' : 'PC', sort: all.length + 1 })
    if (error) toast(error.message); else { load(); shop.reload() }
  }
  async function toggle(s) {
    const { error } = await supabase.from('shop_systems').update({ active: !s.active }).eq('id', s.id)
    if (error) toast(error.message); else { load(); shop.reload() }
  }
  async function rename(s) {
    const name = await dialog.prompt({ title: 'Rename', label: 'Name', defaultValue: s.name, confirmLabel: 'Save' })
    if (!name?.trim() || name.trim() === s.name) return
    const { error } = await supabase.from('shop_systems').update({ name: name.trim() }).eq('id', s.id)
    if (error) toast(error.message); else { load(); shop.reload() }
  }
  return (
    <Collapsible id="gx-systems" title="Systems" summary={`${all.filter((s) => s.active).length} on the floor`} defaultOpen>
      {all.map((s) => (
        <div key={s.id} className="line">
          <button type="button" className="btn link" style={{ padding: 0 }} onClick={() => rename(s)}>{s.name}</button>
          <span className="muted small grow">{s.kind === 'PS' ? 'PlayStation' : 'PC'}</span>
          <button className="btn small ghost" onClick={() => toggle(s)}>{s.active ? 'On floor' : 'Off'}</button>
        </div>
      ))}
      <button className="btn small" onClick={add}>+ Add system</button>
    </Collapsible>
  )
}

function Rates({ shop, householdId, toast }) {
  const [adding, setAdding] = useState(null) // null | { happy }
  async function remove(r) {
    const { error } = await supabase.from('shop_rates').delete().eq('id', r.id)
    if (error) toast(error.message); else shop.reload()
  }
  async function toggleDay(d) {
    const days = shop.settings?.happy_days || [3, 4, 5]
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort()
    const { error } = await supabase.from('shop_settings').upsert({ household_id: householdId, happy_days: next, updated_at: new Date().toISOString() })
    if (error) toast(error.message); else shop.reload()
  }
  const kinds = [...new Set(['PC', 'PS', ...shop.rates.map((r) => r.kind)])]
  const happyDays = shop.settings?.happy_days || [3, 4, 5]
  const table = (happy) => kinds.map((k) => {
    const rows = shop.rates.filter((r) => r.kind === k && !!r.happy === happy)
    if (!rows.length) return null
    return (
      <div key={k + happy}>
        <div className="caps muted">{k === 'PS' ? 'PS5' : k} · per head</div>
        {rows.map((r) => (
          <div key={r.id} className="line">
            <span>{durLabel(r.minutes)}</span><b className="grow" style={{ textAlign: 'right' }}>{rs(r.price)}</b>
            <button className="btn small ghost" aria-label="Remove rate" onClick={() => remove(r)}>✕</button>
          </div>
        ))}
      </div>
    )
  })
  return (
    <Collapsible id="gx-rates" title="Rates" summary={`Happy hours: ${happyDays.map((d) => DAY_NAMES[d]).join(', ') || 'none'}`} defaultOpen>
      <p className="muted small" style={{ marginTop: 0 }}>Per head: a PS5 game for 3 is 3 × the rate. Longer times use the cheapest mix (30 min ₹50 + 1 hr ₹80 → 1.5 hr ₹130). Old bills keep the price they had.</p>
      <h4 className="gx-sub">Normal days</h4>
      {table(false)}
      <button className="btn small" onClick={() => setAdding({ happy: false })}>+ Add rate</button>
      <h4 className="gx-sub">Happy hours · full day</h4>
      <div className="chips">
        {DAY_NAMES.map((n, d) => <button key={n} type="button" className={`chip chip-btn ${happyDays.includes(d) ? 'on' : ''}`} onClick={() => toggleDay(d)}>{n}</button>)}
      </div>
      {table(true)}
      <button className="btn small" onClick={() => setAdding({ happy: true })}>+ Add happy-hour rate</button>
      {adding && <RateSheet householdId={householdId} happy={adding.happy} onClose={() => setAdding(null)} onDone={() => { setAdding(null); shop.reload() }} />}
    </Collapsible>
  )
}

function RateSheet({ householdId, happy, onClose, onDone }) {
  const [kind, setKind] = useState('PC')
  const [minutes, setMinutes] = useState(60)
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_rates').upsert({ household_id: householdId, kind, minutes, price: Number(price), happy }, { onConflict: 'household_id,kind,minutes,happy' })
    setBusy(false)
    if (error) setError(error.message); else onDone()
  }
  return (
    <Sheet title={happy ? 'Happy-hour rate' : 'Rate'} sub="Per head. Adding a time that already has a rate replaces it." onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <Chips options={[['PC', 'PC'], ['PS', 'PS5']]} value={kind} onChange={setKind} />
      <Chips scroll options={[[30, '30 min'], [60, '1 hr'], [120, '2 hr'], [180, '3 hr'], [300, '5 hr']]} value={minutes} onChange={setMinutes} />
      <label>Price per head (₹)<input autoFocus inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} /></label>
      <SheetActions onClose={onClose} busy={busy} disabled={!price} label="Save rate" />
    </Sheet>
  )
}

// Online booking: the public page /#book (what the shop's "Scan to book" banner opens), its on/off switch
// and shop hours (booking times run from opening to closing), plus the printable banner /#poster.
// The public home page (the café's own link): owner's photo behind "Welcome to GRANDXGAMER", booking,
// events (pictures are set per event in Events) and jobs.
function HomePage({ shop, householdId, toast }) {
  const hero = shop.settings?.hero_url
  const [busy, setBusy] = useState(false)
  const link = `${location.origin}/`
  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const url = await uploadShopImage(householdId, file, 'home')
      const { error } = await supabase.from('shop_settings').upsert({ household_id: householdId, hero_url: url, updated_at: new Date().toISOString() })
      if (error) throw error
      toast('Home page picture saved'); shop.reload()
    } catch (err) { toast(err.message) }
    setBusy(false)
  }
  async function remove() {
    const { error } = await supabase.from('shop_settings').upsert({ household_id: householdId, hero_url: null, updated_at: new Date().toISOString() })
    if (error) toast(error.message); else { toast('Picture removed'); shop.reload() }
  }
  return (
    <Collapsible id="gx-home" title="Home page" summary={hero ? 'Your picture is on' : 'Standard photo'}>
      <p className="muted small" style={{ marginTop: 0 }}>What customers see at {link.replace(/^https?:\/\//, '')}: your picture behind “Welcome to GRANDXGAMER”, Book your slots, events and job openings. Event pictures are set in Events → Edit.</p>
      <img className="gx-hero-preview" src={hero || '/brand/hero.jpg'} alt="" />
      <div className="gx-btns">
        <label className={`btn small primary ${busy ? 'disabled' : ''}`}>{busy ? 'Uploading…' : hero ? 'Change picture' : 'Add picture'}<input type="file" accept="image/*" hidden onChange={pick} disabled={busy} /></label>
        {hero && <button className="btn small ghost" onClick={remove}>Remove</button>}
        <a className="btn small ghost" href={link} target="_blank" rel="noreferrer">Open home page</a>
      </div>
    </Collapsible>
  )
}

// Alerts for new online bookings / payments: on every phone with the app open (owner's request).
function PaymentAlerts({ toast }) {
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState(supported ? Notification.permission : 'unsupported')
  async function enable() {
    try { const p = await Notification.requestPermission(); setPerm(p); toast(p === 'granted' ? 'Payment alerts are on for this phone' : 'Notifications are blocked in the browser settings') } catch (e) { toast(e.message) }
  }
  return (
    <Collapsible id="gx-alerts" title="Payment alerts" summary={perm === 'granted' ? 'On for this phone' : 'Off for this phone'}>
      <p className="muted small" style={{ marginTop: 0 }}>When a customer books or enters online, every phone with GRANDXGAMER open beeps and shows it. Check the UPI app, then tap Received or Not received in Slots.</p>
      {perm === 'granted' ? <div className="small pos">Phone notifications are on.</div>
        : perm === 'unsupported' ? <div className="small muted">This browser can’t show notifications; the in-app alert still shows.</div>
        : <button className="btn small primary" onClick={enable}>Turn on phone notifications</button>}
    </Collapsible>
  )
}

function OnlineBooking({ shop, householdId, toast }) {
  const st = shop.settings || {}
  const [open, setOpen] = useState((st.open_time || '10:00').slice(0, 5))
  const [close, setClose] = useState((st.close_time || '23:00').slice(0, 5))
  const on = st.online_booking !== false
  const link = `${location.origin}/#book`
  async function save(patch, msg) {
    const { error } = await supabase.from('shop_settings').upsert({ household_id: householdId, ...patch, updated_at: new Date().toISOString() })
    if (error) toast(error.message); else { toast(msg); shop.reload() }
  }
  return (
    <Collapsible id="gx-booking" title="Online booking" summary={on ? `On · ${open}–${close}` : 'Off'} defaultOpen>
      <p className="muted small" style={{ marginTop: 0 }}>Customers scan the banner at the shop, pick a PC or PS5 for today or tomorrow, pay by UPI and send a request. It shows in Slots to confirm.</p>
      <div className="grid2">
        <label>Opens<input type="time" value={open} onChange={(e) => setOpen(e.target.value)} /></label>
        <label>Closes<input type="time" value={close} onChange={(e) => setClose(e.target.value)} /></label>
      </div>
      <div className="gx-btns" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => save({ open_time: open, close_time: close }, 'Shop hours saved')}>Save hours</button>
        <button className={`btn small ${on ? 'ghost' : 'primary'}`} onClick={() => save({ online_booking: !on }, on ? 'Online booking is off' : 'Online booking is on')}>{on ? 'Turn off' : 'Turn on'}</button>
      </div>
      <div className="line"><span className="grow small mono gx-ellipsis">{link.replace(/^https?:\/\//, '')}</span>
        <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Booking link copied'), () => toast(link))}>Copy</button>
        <a className="btn small ghost" href={link} target="_blank" rel="noreferrer">Open</a>
      </div>
      <a className="btn block" href={`${location.origin}/#poster`} target="_blank" rel="noreferrer">“Scan to book” banner · print / PDF</a>
    </Collapsible>
  )
}

// The shop's UPI ID: Floor, deposits and event advances show a QR with the amount filled in.
function Payments({ shop, householdId, toast }) {
  const [upi, setUpi] = useState(shop.settings?.upi_id || '')
  const [name, setName] = useState(shop.settings?.upi_name || 'GRANDXGAMER')
  const [busy, setBusy] = useState(false)
  const valid = /^[\w.\-]{2,}@[a-zA-Z][\w.\-]{1,}$/.test(upi.trim())
  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('shop_settings').upsert({ household_id: householdId, upi_id: upi.trim() || null, upi_name: name.trim() || null, updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) toast(error.message); else { toast('UPI ID saved'); shop.reload() }
  }
  return (
    <Collapsible id="gx-payments" title="Payments" summary={shop.settings?.upi_id ? `UPI QR · ${shop.settings.upi_id}` : 'Add the UPI ID for QR codes'} defaultOpen={!shop.settings?.upi_id}>
      <form className="stack" onSubmit={save}>
        <p className="muted small" style={{ margin: 0 }}>Online payments in Slots, deposits and event advances show a QR with the amount filled in. Customers scan it with any UPI app.</p>
        <label>UPI ID<input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="e.g. shopname@okicici" autoCapitalize="none" spellCheck={false} /></label>
        <label>Name shown to the customer<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        {upi.trim() && !valid && <div className="alert error" style={{ margin: 0 }}>That doesn’t look like a UPI ID (name@bank).</div>}
        <button className="btn primary" disabled={busy || (upi.trim() && !valid)}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Collapsible>
  )
}

// Admin's own sign-in password (staff use PINs the admin resets in Staff). Checks the current one first.
function LoginPassword({ toast }) {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save(e) {
    e.preventDefault()
    setError(null)
    if (next.length < 8) { setError('Use at least 8 characters.'); return }
    if (next !== again) { setError('The two new passwords don’t match.'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const check = await supabase.auth.signInWithPassword({ email: user.email, password: cur })
    if (check.error) { setBusy(false); setError('The current password is wrong.'); return }
    const { error } = await supabase.auth.updateUser({ password: next })
    setBusy(false)
    if (error) { setError(error.message); return }
    setCur(''); setNext(''); setAgain('')
    toast('Password changed')
  }
  return (
    <Collapsible id="gx-password" title="Sign-in password" summary="Change the admin password">
      <form className="stack" onSubmit={save}>
        {error && <div className="alert error">{error}</div>}
        <label>Current password<input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
        <label>New password<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        <label>New password again<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
        <button className="btn primary" disabled={busy || !cur || !next}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </Collapsible>
  )
}
