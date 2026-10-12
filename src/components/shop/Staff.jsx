import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { generatePin, manageMembers } from '../../lib/members'
import { useDialog } from '../../lib/dialog'
import { dayLabel, durLabel, hoursLabel, timeLabel, rs } from '../../lib/shop'
import { Chips, Sheet, SheetActions } from './ui'
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
  const [error, setError] = useState(null)
  const [sheet, setSheet] = useState(null) // { kind: 'add' } | { kind: 'shift', shift } | { kind: 'login', ... }
  const [open, setOpen] = useState(null) // staff user_id whose shifts are listed

  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0); start.setMonth(start.getMonth() + month)
  const end = new Date(start); end.setMonth(end.getMonth() + 1)
  const startIso = start.toISOString(), endIso = end.toISOString()

  const load = useCallback(async () => {
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`
    const [m, s, a] = await Promise.all([
      supabase.from('household_members').select('*').eq('household_id', householdId).eq('role', 'staff').order('created_at'),
      supabase.from('shop_shifts').select('*').eq('household_id', householdId).gte('clock_in', startIso).lt('clock_in', endIso).order('clock_in', { ascending: false }),
      supabase.from('shop_pay_adjustments').select('*').eq('household_id', householdId).eq('month', monthKey).order('created_at'),
    ])
    if (m.error || s.error) { setError((m.error || s.error).message); return }
    setStaff(m.data); setShifts(s.data); setAdjust(a.data || [])
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
    return { ...m, own, minutes, days, earned, adj, adjTotal, pay: Math.max(0, earned + adjTotal), on: own.find((s) => !s.clock_out) }
  })
  const removed = shifts.filter((s) => !s.user_id)
  const monthSwipe = useSwipe({ onLeft: () => setMonth((m) => Math.min(0, m + 1)), onRight: () => setMonth((m) => m - 1) })
  const totalPay = rows.reduce((a, r) => a + r.pay, 0) // after deductions and bonuses

  async function remove(m) {
    if (!await dialog.confirm({ title: `Remove ${m.display_name || m.username}?`, message: 'Their login stops working. Their shifts stay in the records with their name.', confirmLabel: 'Remove', danger: true })) return
    try { await manageMembers('remove', { householdId, userId: m.user_id }); toast('Login removed'); load() } catch (e) { toast(e.message) }
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
        <div className="muted small">Staff pay · {start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} · hours × hourly rate − deductions + bonuses</div>
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
      </div>
      <div className="gx-col gx-staff-cards">
      {staff === null ? <div className="card muted small">Loading…</div> : rows.length === 0 && (
        <div className="card" style={{ order: 2 }}><p className="muted" style={{ margin: 0 }}>No staff logins yet. Add one for each employee: they sign in with a username and PIN, then Log in for their shift and run Slots.</p></div>
      )}
      {rows.map((m) => (
        <div key={m.user_id} className="card" style={{ order: 3 }}>
          <div className="gx-sys-top">
            <span className="gx-badge round">{(m.display_name || m.username)[0].toUpperCase()}</span>
            <div className="grow">
              <div className="gx-name">{m.display_name || m.username} <span className="muted small">@{m.username}</span></div>
              {m.designation && <span className="pill gx-pill">{m.designation}</span>}
              <div className={`small ${m.on ? 'pos' : 'muted'}`}>{m.on ? `Logged in since ${timeLabel(m.on.clock_in)}` : 'Not logged in'}</div>
            </div>
          </div>
          <div className="gx-sum" style={{ marginTop: 8 }}>
            <span className="muted">{m.days} day{m.days === 1 ? '' : 's'} · {hoursLabel(m.minutes)} × {rs(m.hourly_rate)}/hr</span>
            <b className="amt">{rs(m.earned)}</b>
          </div>
          {m.adj.map((x) => (
            <div key={x.id} className="gx-sum">
              <span className={Number(x.amount) < 0 ? 'neg' : 'pos'}>{Number(x.amount) < 0 ? 'Deducted' : 'Bonus'} · {x.reason}</span>
              <span className="amt"><span className={Number(x.amount) < 0 ? 'neg' : 'pos'}>{Number(x.amount) < 0 ? '−' : '+'}{rs(Math.abs(x.amount))}</span>
                <button className="btn link" style={{ padding: '0 0 0 6px' }} aria-label="Remove" onClick={() => removeAdjust(x)}>✕</button></span>
            </div>
          ))}
          {m.adj.length > 0 && <div className="gx-sum strong"><span>Pay this month</span><span className="amt">{rs(m.pay)}</span></div>}
          <div className="gx-btns" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => setOpen(open === m.user_id ? null : m.user_id)}>{open === m.user_id ? 'Hide shifts' : `Shifts (${m.own.length})`}</button>
            {m.on && <button className="btn small" onClick={() => clockOutNow(m.on)}>Log out now</button>}
            <button className="btn small ghost" onClick={() => setSheet({ kind: 'edit', member: m })}>Edit</button>
            <button className="btn small ghost" onClick={() => setSheet({ kind: 'adjust', member: m })}>Deduct / bonus</button>
            <button className="btn small danger-ghost" onClick={() => remove(m)}>Remove</button>
          </div>
          {open === m.user_id && (
            <div style={{ marginTop: 8 }}>
              {m.own.length === 0 ? <div className="muted small">No shifts this month.</div> : m.own.map((s) => (
                <button key={s.id} type="button" className="line gx-linebtn" onClick={() => setSheet({ kind: 'shift', shift: s, name: m.display_name || m.username })}>
                  <span>{dayLabel(s.clock_in)} · {timeLabel(s.clock_in)} – {s.clock_out ? timeLabel(s.clock_out) : 'now'}</span>
                  <b>{durLabel(mins(s))} ›</b>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      </div>
      {sheet?.kind === 'add' && <AddStaff householdId={householdId} onClose={() => setSheet(null)} onCreated={(username, pin) => { load(); setSheet({ kind: 'login', username, pin }) }} />}
      {sheet?.kind === 'edit' && <EditStaff householdId={householdId} member={sheet.member} onClose={() => setSheet(null)}
        onDone={(msg, login) => { load(); if (login) setSheet({ kind: 'login', ...login, reset: true }); else { setSheet(null); toast(msg) } }} />}
      {sheet?.kind === 'adjust' && <AdjustSheet member={sheet.member} householdId={householdId} month={start} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); load() }} />}
      {sheet?.kind === 'login' && <LoginDetails {...sheet} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'shift' && <ShiftEditor shift={sheet.shift} name={sheet.name} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); load() }} />}
    </section>
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
function EditStaff({ householdId, member, onClose, onDone }) {
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
    <Sheet title={`Shift · ${name}`} sub={shift.edited_by ? 'Edited by the admin before' : 'From their Log in / Log out'} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <label>Logged in<input type="datetime-local" value={inAt} onChange={(e) => setInAt(e.target.value)} required /></label>
      <label>Logged out<input type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} /></label>
      <SheetActions onClose={onClose} busy={busy} label="Save" />
      <button type="button" className="btn link" style={{ justifySelf: 'start', color: 'var(--neg)' }} onClick={del}>Delete this shift</button>
    </Sheet>
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
