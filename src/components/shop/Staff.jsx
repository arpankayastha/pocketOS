import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { generatePin, manageMembers } from '../../lib/members'
import { useDialog } from '../../lib/dialog'
import { dayLabel, durLabel, hoursLabel, timeLabel, rs } from '../../lib/shop'
import { Chips, Sheet, SheetActions } from './ui'

// Admin: staff logins, their hours this month (from clock in / out) × hourly rate = salary so far,
// and fixing shifts (a missed clock-out, a wrong time).
export default function Staff({ householdId, toast }) {
  const dialog = useDialog()
  const [month, setMonth] = useState(0) // 0 = this month, -1 = last month
  const [staff, setStaff] = useState(null)
  const [shifts, setShifts] = useState([])
  const [error, setError] = useState(null)
  const [sheet, setSheet] = useState(null) // { kind: 'add' } | { kind: 'shift', shift } | { kind: 'login', ... }
  const [open, setOpen] = useState(null) // staff user_id whose shifts are listed

  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0); start.setMonth(start.getMonth() + month)
  const end = new Date(start); end.setMonth(end.getMonth() + 1)
  const startIso = start.toISOString(), endIso = end.toISOString()

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([
      supabase.from('household_members').select('*').eq('household_id', householdId).eq('role', 'staff').order('created_at'),
      supabase.from('shop_shifts').select('*').eq('household_id', householdId).gte('clock_in', startIso).lt('clock_in', endIso).order('clock_in', { ascending: false }),
    ])
    if (m.error || s.error) { setError((m.error || s.error).message); return }
    setStaff(m.data); setShifts(s.data)
  }, [householdId, startIso, endIso])
  useEffect(() => { load() }, [load])

  const mins = (s) => ((s.clock_out ? new Date(s.clock_out) : new Date()) - new Date(s.clock_in)) / 60_000
  const rows = (staff || []).map((m) => {
    const own = shifts.filter((s) => s.user_id === m.user_id)
    const minutes = own.reduce((a, s) => a + mins(s), 0)
    return { ...m, own, minutes, pay: (minutes / 60) * Number(m.hourly_rate), on: own.find((s) => !s.clock_out) }
  })
  const removed = shifts.filter((s) => !s.user_id)
  const totalPay = rows.reduce((a, r) => a + r.pay, 0)

  async function setRate(m) {
    const v = await dialog.prompt({ title: `Hourly rate · ${m.display_name || m.username}`, label: '₹ per hour', defaultValue: String(Number(m.hourly_rate) || ''), confirmLabel: 'Save' })
    if (v === null) return
    const { error } = await supabase.from('household_members').update({ hourly_rate: Number(v) || 0 }).eq('household_id', householdId).eq('user_id', m.user_id)
    if (error) toast(error.message); else load()
  }
  async function resetPin(m) {
    if (!await dialog.confirm({ title: `New PIN for ${m.display_name || m.username}?`, message: 'The old PIN stops working. Their fingerprint unlock keeps working on their phone.', confirmLabel: 'New PIN', danger: false })) return
    const pin = generatePin()
    try { await manageMembers('reset_pin', { householdId, userId: m.user_id, pin }); setSheet({ kind: 'login', username: m.username, pin, reset: true }) }
    catch (e) { toast(e.message) }
  }
  async function remove(m) {
    if (!await dialog.confirm({ title: `Remove ${m.display_name || m.username}?`, message: 'Their login stops working. Their shifts stay in the records with their name.', confirmLabel: 'Remove', danger: true })) return
    try { await manageMembers('remove', { householdId, userId: m.user_id }); toast('Login removed'); load() } catch (e) { toast(e.message) }
  }
  async function clockOutNow(s) {
    const { error } = await supabase.from('shop_shifts').update({ clock_out: new Date().toISOString(), edited_by: (await supabase.auth.getUser()).data.user?.id }).eq('id', s.id)
    if (error) toast(error.message); else { toast('Clocked out'); load() }
  }

  return (
    <section>
      {error && <div className="alert error">{error}</div>}
      <Chips options={[[0, 'This month'], [-1, 'Last month']]} value={month} onChange={setMonth} />
      <div className="card" style={{ marginTop: 12 }}>
        <div className="muted small">Salary · {start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}{month === 0 ? ' so far' : ''}</div>
        <div className="gx-big">{rs(totalPay)}</div>
        <div className="muted small">{hoursLabel(rows.reduce((a, r) => a + r.minutes, 0))} · {rows.length} staff</div>
      </div>
      {staff === null ? <div className="card muted small">Loading…</div> : rows.length === 0 && (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No staff logins yet. Add one for each employee: they sign in with a username and PIN, then clock in and run the Floor.</p></div>
      )}
      {rows.map((m) => (
        <div key={m.user_id} className="card">
          <div className="gx-sys-top">
            <span className="gx-badge round">{(m.display_name || m.username)[0].toUpperCase()}</span>
            <div className="grow">
              <div className="gx-name">{m.display_name || m.username} <span className="muted small">@{m.username}</span></div>
              <div className={`small ${m.on ? 'pos' : 'muted'}`}>{m.on ? `On shift since ${timeLabel(m.on.clock_in)}` : 'Off shift'}</div>
            </div>
          </div>
          <div className="gx-sum" style={{ marginTop: 8 }}>
            <button type="button" className="btn link" style={{ padding: 0, minHeight: 0 }} onClick={() => setRate(m)}>{hoursLabel(m.minutes)} × {Number(m.hourly_rate) ? `${rs(m.hourly_rate)}/h` : 'set rate'}</button>
            <b className="amt">{rs(m.pay)}</b>
          </div>
          <div className="gx-btns" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => setOpen(open === m.user_id ? null : m.user_id)}>{open === m.user_id ? 'Hide shifts' : `Shifts (${m.own.length})`}</button>
            {m.on && <button className="btn small" onClick={() => clockOutNow(m.on)}>Clock out now</button>}
            <button className="btn small ghost" onClick={() => resetPin(m)}>New PIN</button>
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
      {removed.length > 0 && (
        <div className="card"><h3>Former staff</h3>{removed.map((s) => (
          <div key={s.id} className="line"><span>{s.staff_name} · {dayLabel(s.clock_in)}</span><b>{durLabel(mins(s))}</b></div>
        ))}</div>
      )}
      <button className="btn primary block" onClick={() => setSheet({ kind: 'add' })}>+ Add staff login</button>
      {sheet?.kind === 'add' && <AddStaff householdId={householdId} onClose={() => setSheet(null)} onCreated={(username, pin) => { load(); setSheet({ kind: 'login', username, pin }) }} />}
      {sheet?.kind === 'login' && <LoginDetails {...sheet} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'shift' && <ShiftEditor shift={sheet.shift} name={sheet.name} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); load() }} />}
    </section>
  )
}

function AddStaff({ householdId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true); setError(null)
    const pin = generatePin()
    try {
      await manageMembers('create', { householdId, username: username.trim().toLowerCase(), pin, name: name.trim(), rate: Number(rate) || 0 })
      onCreated(username.trim().toLowerCase(), pin)
    } catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <Sheet title="Add staff login" sub="They sign in with the username and a 6-digit PIN, then turn on fingerprint." onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <label>Name<input autoFocus value={name} onChange={(e) => { setName(e.target.value); if (!username || username === slug(name)) setUsername(slug(e.target.value)) }} placeholder="Full name" /></label>
      <label>Username<input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} autoCapitalize="none" spellCheck={false} /></label>
      <label>Hourly rate (₹)<input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 60" /></label>
      <SheetActions onClose={onClose} busy={busy} disabled={username.length < 3} label="Create login" />
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
    if (outAt && new Date(outAt) < new Date(inAt)) { setError('Clock out is before clock in.'); return }
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
    <Sheet title={`Shift · ${name}`} sub={shift.edited_by ? 'Edited by the admin before' : 'From their clock in / out'} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <label>Clock in<input type="datetime-local" value={inAt} onChange={(e) => setInAt(e.target.value)} required /></label>
      <label>Clock out<input type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} /></label>
      <SheetActions onClose={onClose} busy={busy} label="Save" />
      <button type="button" className="btn link" style={{ justifySelf: 'start', color: 'var(--neg)' }} onClick={del}>Delete this shift</button>
    </Sheet>
  )
}
