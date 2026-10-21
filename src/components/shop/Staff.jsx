import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { generatePin, manageMembers } from '../../lib/members'
import { useDialog } from '../../lib/dialog'
import { dayLabel, durLabel, hoursLabel, timeLabel, rs } from '../../lib/shop'
import { ActionGrid, ActionSheet, Chips, Sheet, SheetActions } from './ui'
import { CashIcon, ClockIcon, MailIcon, PencilIcon, XIcon } from '../../lib/icons'
import { useSwipe } from '../../lib/useSwipe'
import Vacancies from './Vacancies'

// Admin: staff logins with their designation, hourly pay (owner, 12 Oct: ₹33 an hour; staff never see pay),
// days and hours worked this month (from shift Log in / Log out) and pay = hours × rate,
// and fixing shifts (a missed log-out, a wrong time).
const DESIGNATIONS = ['Super Senior Manager', 'Sr Manager', 'Manager', 'Temporary Manager', 'Trainee'] // owner, 12 Oct
const DEFAULT_RATE = 33
export default function Staff({ householdId, toast }) {
  const dialog = useDialog()
  const [month, setMonth] = useState(0) // 0 = this month, -1 = last month
  const [staff, setStaff] = useState(null)
  const [shifts, setShifts] = useState([])
  const [adjust, setAdjust] = useState([]) // deductions (−) and bonuses (+) this month
  const [salary, setSalary] = useState([]) // salary paid this month (owner, 16 Oct)
  const [google, setGoogle] = useState({}) // staff user_id → linked Gmail
  const [error, setError] = useState(null)
  const [sheet, setSheet] = useState(null) // { kind: 'add' } | { kind: 'shift', shift } | { kind: 'login', ... }
  const [open, setOpen] = useState(null) // staff user_id whose shifts are listed

  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0); start.setMonth(start.getMonth() + month)
  const end = new Date(start); end.setMonth(end.getMonth() + 1)
  const startIso = start.toISOString(), endIso = end.toISOString()

  const load = useCallback(async () => {
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`
    const [m, s, a, sp] = await Promise.all([
      supabase.from('household_members').select('*').eq('household_id', householdId).eq('role', 'staff').order('created_at'),
      supabase.from('shop_shifts').select('*').eq('household_id', householdId).gte('clock_in', startIso).lt('clock_in', endIso).order('clock_in', { ascending: false }),
      supabase.from('shop_pay_adjustments').select('*').eq('household_id', householdId).eq('month', monthKey).order('created_at'),
      supabase.from('shop_salary_payments').select('*').eq('household_id', householdId).gte('paid_at', startIso).lt('paid_at', endIso).order('paid_at', { ascending: false }),
    ])
    if (m.error || s.error) { setError((m.error || s.error).message); return }
    setStaff(m.data); setShifts(s.data); setAdjust(a.data || []); setSalary(sp.data || [])
    supabase.rpc('staff_google', { p_household: householdId }).then(({ data }) => setGoogle(data || {}))
  }, [householdId, startIso, endIso]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const mins = (s) => ((s.clock_out ? new Date(s.clock_out) : new Date()) - new Date(s.clock_in)) / 60_000
  const rows = (staff || []).map((m) => {
    const own = shifts.filter((s) => s.user_id === m.user_id)
    const minutes = own.reduce((a, s) => a + mins(s), 0)
    const days = new Set(own.map((s) => new Date(s.clock_in).toDateString())).size
    const earned = Math.round((minutes / 60) * (Number(m.hourly_rate) || 0))
    const adj = adjust.filter((x) => x.user_id === m.user_id)
    const adjTotal = adj.reduce((t, x) => t + Number(x.amount), 0)
    const payments = salary.filter((x) => x.user_id === m.user_id)
    const paid = payments.reduce((t, x) => t + Number(x.amount), 0)
    const pay = Math.max(0, earned + adjTotal)
    return { ...m, own, minutes, days, earned, adj, adjTotal, pay, payments, paid, left: Math.max(0, pay - paid), on: own.find((s) => !s.clock_out) }
  })
  const removed = shifts.filter((s) => !s.user_id)
  const monthSwipe = useSwipe({ onLeft: () => setMonth((m) => Math.min(0, m + 1)), onRight: () => setMonth((m) => m - 1) })
  const totalPay = rows.reduce((a, r) => a + r.pay, 0) // after deductions and bonuses

  async function remove(m) {
    if (!await dialog.confirm({ title: `Remove ${m.display_name || m.username}?`, message: 'Their login stops working. Their shifts stay in the records with their name.', confirmLabel: 'Remove', danger: true })) return
    try { await manageMembers('remove', { householdId, userId: m.user_id }); toast('Login removed'); load() } catch (e) { toast(e.message) }
  }
  // Owner: a staff member signed in with Google before linking it (it made a customer account) — attach it here.
  async function linkGoogle(m) {
    const email = await dialog.prompt({ title: `Link Google · ${m.display_name || m.username}`, label: 'Their Gmail — first they open grandxgamer.vercel.app on their phone and tap Sign in with Google once (it lands on the customer page; that’s fine)', placeholder: 'name@gmail.com', confirmLabel: 'Link' })
    if (!email?.trim()) return
    const { error } = await supabase.rpc('link_staff_google', { p_staff: m.user_id, p_email: email.trim() })
    if (error) toast(error.message); else { toast(`Google linked — ${m.display_name || m.username} can now use Continue with Google`); load() }
  }
  async function unlinkGoogle(m) {
    if (!await dialog.confirm({ title: `Remove Google from ${m.display_name || m.username}?`, message: `${google[m.user_id]} won't open this staff login any more. Then use Link Google to add the right Gmail (it must tap Sign in with Google once first).`, confirmLabel: 'Remove Google', danger: true })) return
    const { error } = await supabase.rpc('unlink_staff_google', { p_staff: m.user_id })
    if (error) toast(error.message); else { toast('Google removed — link the new Gmail'); load() }
  }
  async function removePayment(x) {
    if (!await dialog.confirm({ title: `Remove this salary payment?`, message: `${rs(x.amount)} paid to ${x.staff_name} on ${new Date(x.paid_at).toLocaleDateString('en-IN')}.`, confirmLabel: 'Remove', danger: true })) return
    const { error } = await supabase.from('shop_salary_payments').delete().eq('id', x.id)
    if (error) toast(error.message); else { toast('Payment removed'); setOpen(null); load() }
  }
  async function removeAdjust(x) {
    if (!await dialog.confirm({ title: `Remove “${x.reason}”?`, message: `${Number(x.amount) < 0 ? 'Deduction' : 'Bonus'} of ${rs(Math.abs(x.amount))}.`, confirmLabel: 'Remove', danger: true })) return
    const { error } = await supabase.from('shop_pay_adjustments').delete().eq('id', x.id)
    if (error) toast(error.message); else { toast('Removed'); load() }
  }
  async function clockOutNow(s) {
    const { error } = await supabase.from('shop_shifts').update({ clock_out: new Date().toISOString(), edited_by: (await supabase.auth.getUser()).data.user?.id }).eq('id', s.id)
    if (error) toast(error.message); else { toast('Logged out'); load() }
  }

  return (
    <section className="gx-split side-first">
      <div className="gx-col">
      {error && <div className="alert error">{error}</div>}
      <div className="gx-dateswipe" style={{ order: 1 }} {...monthSwipe}>
      <Chips options={[[0, 'This month'], [-1, 'Last month']]} value={month < -1 ? null : month} onChange={setMonth} />
      <div className="card">
        <div className="muted small">Staff pay · {start.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</div>
        <div className="gx-big">{rs(totalPay)}</div>
        <div className="muted small">{hoursLabel(rows.reduce((a, r) => a + r.minutes, 0))} · {rows.length} staff · swipe for other months</div>
      </div>
      </div>
      {removed.length > 0 && (
        <div className="card" style={{ order: 4 }}><h3>Former staff</h3>{removed.map((s) => (
          <div key={s.id} className="line"><span>{s.staff_name} · {dayLabel(s.clock_in)}</span><b>{durLabel(mins(s))}</b></div>
        ))}</div>
      )}
      <button className="btn primary block" style={{ order: 5 }} onClick={() => setSheet({ kind: 'add' })}>+ Add staff login</button>
      <Vacancies householdId={householdId} toast={toast} />
      <Admins householdId={householdId} toast={toast} />
      </div>
      <div className="gx-col gx-staff-cards">
      {staff === null ? <div className="card muted small">Loading…</div> : rows.length === 0 && (
        <div className="card" style={{ order: 2 }}><p className="muted" style={{ margin: 0 }}>No staff logins yet. Add one for each employee: they sign in with a username and PIN, then Log in for their shift and run Slots.</p></div>
      )}
      {rows.map((m) => (
        <div key={m.user_id} className="card gx-run gx-staffrow" style={{ order: 3 }} role="button" tabIndex={0} onClick={() => setOpen(m.user_id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(m.user_id) }}>
          <span className="gx-badge round">{(m.display_name || m.username)[0].toUpperCase()}</span>
          <div className="gx-run-main">
            <div className="gx-name">{m.display_name || m.username}{m.designation && <span className="muted small"> · {m.designation}</span>}</div>
            <div className={`small ${m.on ? 'pos' : 'muted'}`}>{m.on ? `On duty since ${timeLabel(m.on.clock_in)}` : `Off duty · ${m.days} day${m.days === 1 ? '' : 's'} this month`}</div>
          </div>
          <div className="gx-left"><b>{rs(m.pay)}</b><span>{m.paid ? (m.left ? `${rs(m.left)} left` : 'paid') : hoursLabel(m.minutes)}</span></div>
        </div>
      ))}
      </div>
      {(() => {
        const m = rows.find((x) => x.user_id === open)
        if (!m) return null
        const go = (next) => { setOpen(null); next() }
        return (
          <ActionSheet title={m.display_name || m.username} sub={`@${m.username}${m.designation ? ` · ${m.designation}` : ''}${google[m.user_id] ? ` · Google ${google[m.user_id]}` : ''}`} onClose={() => setOpen(null)}>
            <div className="gx-skpis">
              <div><span>Hours</span><b>{hoursLabel(m.minutes)}</b></div>
              <div><span>Pay · {rs(m.hourly_rate)}/h</span><b>{rs(m.pay)}</b></div>
              <div><span>Paid · left</span><b className={m.left ? 'neg' : 'pos'}>{rs(m.paid)} · {rs(m.left)}</b></div>
            </div>
            {m.adj.length > 0 && (
              <div className="gx-details">
                <div><span>Earned · {m.days} day{m.days === 1 ? '' : 's'}</span><b>{rs(m.earned)}</b></div>
                {m.adj.map((x) => (
                  <div key={x.id}><span className={Number(x.amount) < 0 ? 'neg' : 'pos'}>{Number(x.amount) < 0 ? 'Deducted' : 'Bonus'} · {x.reason}</span>
                    <b><span className={Number(x.amount) < 0 ? 'neg' : 'pos'}>{Number(x.amount) < 0 ? '−' : '+'}{rs(Math.abs(x.amount))}</span>
                      <button className="btn link" style={{ padding: '0 0 0 8px' }} aria-label="Remove" onClick={() => removeAdjust(x)}>✕</button></b></div>
                ))}
              </div>
            )}
            {m.payments.length > 0 && (
              <div className="gx-details">{m.payments.map((x) => (
                <div key={x.id}><span>Paid {new Date(x.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {x.mode}{x.entered_by ? ` · by ${x.entered_by}` : ''}{x.note ? ` · ${x.note}` : ''}</span>
                  <b>{rs(x.amount)} <button className="btn link" style={{ padding: '0 0 0 8px' }} aria-label="Remove payment" onClick={() => removePayment(x)}>✕</button></b></div>
              ))}</div>
            )}
            <ActionGrid items={[
              { label: 'Pay salary', icon: <CashIcon />, onClick: () => go(() => setSheet({ kind: 'salary', member: m })) },
              m.on && { label: 'Log out now', icon: <ClockIcon />, onClick: () => go(() => clockOutNow(m.on)) },
              { label: 'Edit', icon: <PencilIcon />, onClick: () => go(() => setSheet({ kind: 'edit', member: m })) },
              { label: 'Deduct / bonus', icon: <CashIcon />, onClick: () => go(() => setSheet({ kind: 'adjust', member: m })) },
              { label: google[m.user_id] ? 'Change Google' : 'Link Google', icon: <MailIcon />, onClick: () => go(() => (google[m.user_id] ? unlinkGoogle(m) : linkGoogle(m))) },
              { label: 'Remove', icon: <XIcon />, onClick: () => go(() => remove(m)), danger: true },
            ]} />
            <div className="caps muted">Shifts this month</div>
            {m.own.length === 0 ? <div className="muted small">No shifts this month.</div> : (
              <div className="gx-details">{m.own.map((x) => (
                <button key={x.id} type="button" className="line gx-linebtn" onClick={() => go(() => setSheet({ kind: 'shift', shift: x, name: m.display_name || m.username }))}>
                  <span>{dayLabel(x.clock_in)} · {timeLabel(x.clock_in)} – {x.clock_out ? timeLabel(x.clock_out) : 'now'}{x.auto_out ? ' · auto log-out' : ''}{x.edits?.length ? ' · edited' : ''}</span>
                  <b>{durLabel(mins(x))} · {rs((mins(x) / 60) * (Number(m.hourly_rate) || 0))} ›</b>
                </button>
              ))}</div>
            )}
          </ActionSheet>
        )
      })()}
      {sheet?.kind === 'add' && <AddStaff householdId={householdId} onClose={() => setSheet(null)} onCreated={(username, pin) => { load(); setSheet({ kind: 'login', username, pin }) }} />}
      {sheet?.kind === 'edit' && <EditStaff householdId={householdId} member={sheet.member} gmail={google[sheet.member.user_id]} onLinkGoogle={() => { setSheet(null); linkGoogle(sheet.member) }} onUnlinkGoogle={() => { setSheet(null); unlinkGoogle(sheet.member) }} onClose={() => setSheet(null)}
        onDone={(msg, login) => { load(); if (login) setSheet({ kind: 'login', ...login, reset: true }); else { setSheet(null); toast(msg) } }} />}
      {sheet?.kind === 'salary' && <SalarySheet member={sheet.member} householdId={householdId} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); load() }} />}
      {sheet?.kind === 'adjust' && <AdjustSheet member={sheet.member} householdId={householdId} month={start} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); load() }} />}
      {sheet?.kind === 'login' && <LoginDetails {...sheet} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'shift' && <ShiftEditor shift={sheet.shift} name={sheet.name} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); load() }} />}
    </section>
  )
}

// Multiple admins (owner, 12 Oct): anyone added here gets the owner's rights — Shop, Money, Staff, settings.
// Add by the Gmail they signed in with on the home page (rpc add_shop_admin); the owner can't be removed.
function Admins({ householdId, toast }) {
  const dialog = useDialog()
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('shop_admin_list', { p_household: householdId })
    if (error) setError(error.message); else setList(data)
  }, [householdId])
  useEffect(() => { load() }, [load])
  async function add() {
    const email = await dialog.prompt({ title: 'Add an admin', label: 'Their Gmail', placeholder: 'name@gmail.com', confirmLabel: 'Add admin',
      message: 'They get full admin access: Shop, Money, Staff and settings. They must have signed in once with Google on the home page.' })
    if (!email) return
    const { error } = await supabase.rpc('add_shop_admin', { p_household: householdId, p_email: email })
    if (error) { dialog.alert({ title: 'Couldn’t add the admin', message: error.message }); return }
    toast(`${email} is now an admin. They sign out and back in to see it.`); load()
  }
  async function remove(a) {
    if (!await dialog.confirm({ title: `Remove ${a.name} as admin?`, message: 'They go back to a normal customer account.', confirmLabel: 'Remove', danger: true })) return
    const { error } = await supabase.rpc('remove_shop_admin', { p_household: householdId, p_user: a.user_id })
    if (error) { dialog.alert({ title: 'Couldn’t remove', message: error.message }); return }
    toast(`${a.name} is no longer an admin`); load()
  }
  return (
    <div className="card" style={{ order: 7 }}>
      <div className="card-head"><h3>Admins</h3><button className="btn small" onClick={add}>+ Add</button></div>
      {error && <div className="alert error">{error}</div>}
      {list === null ? <div className="muted small">Loading…</div> : list.map((a) => (
        <div key={a.user_id} className="line">
          <div className="grow" style={{ minWidth: 0 }}><div>{a.name}{a.owner && <span className="pill gx-pill" style={{ marginLeft: 6 }}>Owner</span>}</div>
            <div className="muted small ellipsis">{a.email?.endsWith('@staff.grandxgamer.app') ? `@${a.email.split('@')[0]}` : a.email}{a.added_by ? ` · added by ${a.added_by}` : ''}</div></div>
          {!a.owner && <button className="btn small icon" aria-label={`Remove ${a.name}`} onClick={() => remove(a)}>✕</button>}
        </div>
      ))}
    </div>
  )
}

function AddStaff({ householdId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [rate, setRate] = useState(String(DEFAULT_RATE))
  const [designation, setDesignation] = useState('Trainee')
  const [pin, setPin] = useState(() => generatePin())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    if (!/^\d{6}$/.test(pin)) { setError('The PIN must be 6 digits.'); return }
    setBusy(true); setError(null)
    try {
      const { userId } = await manageMembers('create', { householdId, username: username.trim().toLowerCase(), pin, name: name.trim(), rate: Number(rate) || 0 })
      await supabase.from('household_members').update({ designation, hourly_rate: Number(rate) || 0 }).eq('household_id', householdId).eq('user_id', userId)
      onCreated(username.trim().toLowerCase(), pin)
    } catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <Sheet title="Add staff login" sub="They sign in with the username and a 6-digit PIN, then turn on fingerprint." onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <label>Name<input autoFocus value={name} onChange={(e) => { setName(e.target.value); if (!username || username === slug(name)) setUsername(slug(e.target.value)) }} placeholder="Full name" /></label>
      <label>Username<input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} autoCapitalize="none" spellCheck={false} /></label>
      <div className="grid2">
        <label>6-digit PIN<input className="mono" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        <label>Hourly pay (₹)<input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} placeholder="33" /></label>
      </div>
      <div className="caps muted">Designation</div>
      <Chips options={DESIGNATIONS.map((d) => [d, d])} value={designation} onChange={setDesignation} />
      <SheetActions onClose={onClose} busy={busy} disabled={username.length < 3 || pin.length !== 6} label="Create login" />
    </Sheet>
  )
}
// Admin: change a staff member's name, designation, hourly pay, or set a new PIN (left empty = keep the PIN).
function EditStaff({ householdId, member, gmail, onLinkGoogle, onUnlinkGoogle, onClose, onDone }) {
  const [name, setName] = useState(member.display_name || '')
  const [rate, setRate] = useState(String(Number(member.hourly_rate) || ''))
  const [designation, setDesignation] = useState(member.designation || null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    if (pin && !/^\d{6}$/.test(pin)) { setError('A new PIN must be 6 digits, or leave it empty.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('household_members').update({ display_name: name.trim() || null, hourly_rate: Number(rate) || 0, designation })
      .eq('household_id', householdId).eq('user_id', member.user_id)
    if (error) { setError(error.message); setBusy(false); return }
    if (pin) {
      try { await manageMembers('reset_pin', { householdId, userId: member.user_id, pin }) } catch (e) { setError(e.message); setBusy(false); return }
      onDone('Saved', { username: member.username, pin })
    } else onDone('Saved')
  }
  return (
    <Sheet title={`Edit · ${member.display_name || member.username}`} sub={`Username @${member.username}. Pay is never shown to staff.`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></label>
      <div className="grid2">
        <label>Hourly pay (₹)<input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} placeholder="33" /></label>
        <label>New PIN<input className="mono" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Keep current" /></label>
      </div>
      <div className="caps muted">Designation</div>
      <Chips options={DESIGNATIONS.map((d) => [d, d])} value={designation} onChange={setDesignation} />
      <div className="caps muted">Google sign-in</div>
      <div className="gx-btns" style={{ alignItems: 'center' }}>
        <span className="small grow">{gmail || 'Not linked'}</span>
        {gmail ? <button type="button" className="btn small danger-ghost" onClick={onUnlinkGoogle}>Remove / change</button>
          : <button type="button" className="btn small" onClick={onLinkGoogle}>Link Google</button>}
      </div>
      <SheetActions onClose={onClose} busy={busy} disabled={pin.length > 0 && pin.length !== 6} label="Save" />
    </Sheet>
  )
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 32)

function LoginDetails({ username, pin, reset, onClose }) {
  const text = `GRANDXGAMER${reset ? ' — new PIN' : ''}\nOpen: ${location.origin}\nUsername: ${username}\nPIN: ${pin}`
  const [copied, setCopied] = useState(false)
  return (
    <Sheet title={reset ? 'New PIN' : 'Login created'} sub="Send these to them. The PIN isn’t shown again." onClose={onClose} onSubmit={onClose}>
      <div className="gx-box mono" style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="btn primary">Done</button>
      </div>
    </Sheet>
  )
}

const toLocal = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
function ShiftEditor({ shift, name, onClose, onDone }) {
  const [inAt, setInAt] = useState(toLocal(shift.clock_in))
  const [outAt, setOutAt] = useState(shift.clock_out ? toLocal(shift.clock_out) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    if (outAt && new Date(outAt) < new Date(inAt)) { setError('Log out is before log in.'); return }
    if (outAt && new Date(outAt) - new Date(inAt) > 6 * 3_600_000) { setError('A shift can be at most 6 hours.'); return }
    setBusy(true)
    const uid = (await supabase.auth.getUser()).data.user?.id
    const { error } = await supabase.from('shop_shifts').update({ clock_in: new Date(inAt).toISOString(), clock_out: outAt ? new Date(outAt).toISOString() : null, edited_by: uid }).eq('id', shift.id)
    setBusy(false)
    if (error) setError(error.message); else onDone('Shift updated')
  }
  async function del() {
    setBusy(true)
    const { error } = await supabase.from('shop_shifts').delete().eq('id', shift.id)
    setBusy(false)
    if (error) setError(error.message); else onDone('Shift deleted')
  }
  return (
    <Sheet title={`Shift · ${name}`} sub={shift.edited_by ? 'Edited by the admin before' : shift.auto_out ? 'They didn’t log out — logged out automatically after 6 hours' : 'From their Log in / Log out'} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <label>Logged in<input type="datetime-local" value={inAt} onChange={(e) => setInAt(e.target.value)} required /></label>
      <label>Logged out<input type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} /></label>
      {shift.edits?.length > 0 && <ShiftHistory edits={shift.edits} />}
      <SheetActions onClose={onClose} busy={busy} label="Save" />
      <button type="button" className="btn link" style={{ justifySelf: 'start', color: 'var(--neg)' }} onClick={del}>Delete this shift</button>
    </Sheet>
  )
}

// Owner (21 Oct): every change to a shift's times shows when, by whom and what it was before
// (shop_shifts.edits, written by the trigger shop_shifts_edit_log).
const shiftAt = (iso) => (iso ? `${dayLabel(iso)} ${timeLabel(iso)}` : 'not logged out')
function ShiftHistory({ edits }) {
  return (
    <>
      <div className="caps muted">Edit history</div>
      <div className="gx-details">{[...edits].reverse().map((e, i) => (
        <div key={i} style={{ display: 'grid', gap: 2 }}>
          <span className="small muted">{shiftAt(e.at)} · by {e.by || 'admin'}</span>
          {e.from_in !== e.to_in && <span className="small">Logged in: <s className="muted">{shiftAt(e.from_in)}</s> → <b>{shiftAt(e.to_in)}</b></span>}
          {e.from_out !== e.to_out && <span className="small">Logged out: <s className="muted">{shiftAt(e.from_out)}</s> → <b>{shiftAt(e.to_out)}</b></span>}
        </div>
      ))}</div>
    </>
  )
}

// Owner: cut pay for a mistake (or add a bonus) — kept per month with the reason, never shown to staff.
function AdjustSheet({ member, householdId, month, onClose, onDone }) {
  const [kind, setKind] = useState('deduct')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const name = member.display_name || member.username
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`
  async function save() {
    setBusy(true)
    const value = (kind === 'deduct' ? -1 : 1) * Number(amount)
    const { error } = await supabase.from('shop_pay_adjustments').insert({ household_id: householdId, user_id: member.user_id, staff_name: name, month: monthKey, amount: value, reason: reason.trim() })
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${kind === 'deduct' ? 'Deducted' : 'Bonus'} ${rs(amount)} · ${name}`)
  }
  return (
    <Sheet title={`Pay · ${name}`} sub={`${month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} · only you see this`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <Chips options={[['deduct', 'Deduct'], ['bonus', 'Bonus']]} value={kind} onChange={setKind} />
      <label>Amount (₹)<input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'deduct' ? 'e.g. drawer short ₹200, late 2 days' : 'e.g. extra hours for the event'} /></label>
      <SheetActions onClose={onClose} busy={busy} disabled={!Number(amount) || reason.trim().length < 2} label={kind === 'deduct' ? `Deduct ${rs(amount || 0)}` : `Add ${rs(amount || 0)}`} danger={kind === 'deduct'} />
    </Sheet>
  )
}

// Owner, 16 Oct: record salary paid — the whole amount left this month, or any amount (temporary staff are paid
// mid-month for a day or two). Staff see what was paid on their Shift screen.
function SalarySheet({ member, householdId, onClose, onDone }) {
  const [how, setHow] = useState(member.left > 0 ? 'all' : 'other')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const value = how === 'all' ? member.left : Number(amount) || 0
  const name = member.display_name || member.username
  async function save() {
    if (!value) return
    setBusy(true)
    const { error } = await supabase.from('shop_salary_payments').insert({ household_id: householdId, user_id: member.user_id, staff_name: name, amount: value, mode, note: note.trim() || null })
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${rs(value)} salary paid to ${name}`)
  }
  return (
    <Sheet title={`Pay salary · ${name}`} sub={`This month: ${rs(member.pay)} earned · ${rs(member.paid)} paid · ${rs(member.left)} left`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <Chips options={[...(member.left > 0 ? [['all', `Pay all · ${rs(member.left)}`]] : []), ['other', 'Other amount']]} value={how} onChange={setHow} />
      {how === 'other' && <label>Amount (₹)<input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>}
      <Chips options={[['cash', 'Cash'], ['online', 'Online']]} value={mode} onChange={setMode} />
      <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. advance, 2 days" /></label>
      <SheetActions onClose={onClose} busy={busy} disabled={!value} label={`Pay ${rs(value)}`} />
    </Sheet>
  )
}
