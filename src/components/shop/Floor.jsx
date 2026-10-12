import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../../lib/dialog'
import { supabase } from '../../lib/supabase'
import { DURATIONS, balanceFor, byLine, customerKey, duesByCustomer, durLabel, isHappyDay, minutesLeft, priceFor, sessionEnd, sessionPaid, sessionTotal, shortCode, timeLabel, useNow, rs } from '../../lib/shop'
import { Chips, Sheet, SheetActions, SumRow } from './ui'
import { UpiQrButton } from './UpiQr'
import { alarm } from '../../lib/alarm'
import CustomerFields from './CustomerFields'

// The Floor ("Slots" tab): every system with its live state. Free → Start; playing → + F&B, Extend, Pause, End.
// A PS5 has one row per controller (owner: each controller is a separate customer with its own timer; start
// them together or one later). Pause / Resume (technical failure) stops the clock, so no one loses time.
// Replaces the sheet's rows (Name, System, Time in/out, F&B, Extend, Total, Payment mode).
export default function Floor({ shop, householdId, toast, admin }) {
  const now = useNow(10_000)
  const [sheet, setSheet] = useState(null) // { kind: 'start'|'fnb'|'extend'|'end', system, session, seats }
  const running = shop.sessions.filter((s) => s.status === 'running')
  const seatsOf = (sys) => sys.seats || 1
  const off = (sys, n) => (sys.off_seats || []).includes(n)
  // Which session holds each controller: its own seat, plus one more free controller per extra player
  // (owner: "2 players = 2 controllers busy"). Out-of-order controllers are never free.
  const holders = (sys) => {
    const m = new Map()
    const mine = running.filter((s) => s.system_id === sys.id)
    for (const s of mine) m.set(s.seat || 1, s)
    for (const s of mine) {
      for (let extra = (s.players || 1) - 1; extra > 0; extra--) {
        const n = Array.from({ length: seatsOf(sys) }, (_, i) => i + 1).find((k) => !m.has(k) && !off(sys, k))
        if (n) m.set(n, { ...s, shared: true })
      }
    }
    return m
  }
  const at = (sysId, seat) => { const sys = shop.systems.find((x) => x.id === sysId); return sys ? holders(sys).get(seat) : null }
  const freeSeats = (sys) => { const h = holders(sys); return Array.from({ length: seatsOf(sys) }, (_, i) => i + 1).filter((n) => !h.has(n) && !off(sys, n)) }
  const working = (sys) => seatsOf(sys) - (sys.off_seats || []).filter((n) => n <= seatsOf(sys)).length
  const totalSeats = shop.systems.reduce((a, x) => a + working(x), 0)
  const busySeats = shop.systems.reduce((a, x) => a + (working(x) - freeSeats(x).length), 0)
  useTimeUpAlarm(running, now)
  async function setOff(sys, n, isOff) {
    const next = isOff ? [...new Set([...(sys.off_seats || []), n])] : (sys.off_seats || []).filter((k) => k !== n)
    const { error } = await supabase.from('shop_systems').update({ off_seats: next }).eq('id', sys.id)
    done(error ? error.message : isOff ? `Controller ${n} marked out of order` : `Controller ${n} is back in use`)
  }
  const close = () => setSheet(null)
  const done = (msg) => { setSheet(null); toast(msg); shop.reload() }

  const startBooking = (b) => {
    const need = b.players || 1
    const sys = shop.systems.find((x) => x.kind === b.kind && freeSeats(x).length >= need)
    if (!sys) { toast(`No free ${b.kind === 'PS' ? 'PS5 controllers' : 'PC'} right now`); return }
    setSheet({ kind: 'start', system: sys, seats: freeSeats(sys).slice(0, need), booking: b })
  }
  async function pause(list, on) {
    const t = new Date()
    const results = await Promise.all(list.map((s) => supabase.from('shop_sessions').update(on
      ? { paused_at: t.toISOString() }
      : { paused_at: null, paused_minutes: Number(s.paused_minutes || 0) + (t - new Date(s.paused_at)) / 60_000 }).eq('id', s.id)))
    const err = results.find((r) => r.error)?.error
    done(err ? err.message : on ? 'Paused · the time left is kept' : 'Resumed')
  }
  if (!shop.systems.length) return <div className="card muted">No systems yet. The admin adds them in ⚙ → Systems & rates.</div>

  return (
    <section className="gx-floor">
      <div className="chips">
        <span className="pill gx-pill busy">{busySeats} playing</span>
        <span className="pill gx-pill free">{totalSeats - busySeats} free</span>
        {isHappyDay(shop.settings) && <span className="pill gx-pill happy">Happy hours today</span>}
        <button className="btn small primary gx-book-btn" onClick={() => setSheet({ kind: 'book' })}>+ Book</button>
      </div>
      <Bookings bookings={shop.bookings} eventChecks={shop.eventChecks} entryChecks={shop.entryChecks} onArrived={startBooking} onBook={() => setSheet({ kind: 'book' })} onChanged={(m) => { toast(m); shop.reload() }} />
      {shop.systems.map((sys) => {
        const n = seatsOf(sys)
        if (n === 1) {
          const s = at(sys.id, 1)
          if (!s) return (
            <div key={sys.id} className="card gx-sys free">
              <div className="gx-sys-top">
                <span className={`gx-badge ${sys.kind === 'PS' ? 'ps' : ''}`}>{sys.name}</span>
                <div className="grow"><div className="gx-free">Free</div><div className="muted small">{sys.kind === 'PS' ? 'PlayStation' : 'PC'}</div></div>
                <button className="btn small gx-ok" onClick={() => setSheet({ kind: 'start', system: sys, seats: [1] })}>Start</button>
              </div>
            </div>
          )
          return (
            <div key={sys.id} className={`card gx-sys ${stateOf(s, now)}`}>
              <SessionRow sys={sys} s={s} now={now} badge={sys.name} onSheet={(kind) => setSheet({ kind, system: sys, session: s })} onPause={(on) => pause([s], on)} />
            </div>
          )
        }
        const held = holders(sys)
        const list = Array.from({ length: n }, (_, i) => i + 1).map((seat) => ({ seat, s: held.get(seat) }))
        const playing = list.filter((x) => x.s && !x.s.shared).map((x) => x.s)
        const used = list.filter((x) => x.s).length
        const free = freeSeats(sys)
        const anyRunning = playing.some((s) => !s.paused_at), anyPaused = playing.some((s) => s.paused_at)
        return (
          <div key={sys.id} className={`card gx-sys ${playing.length ? 'busy' : 'free'} gx-multi`}>
            <div className="gx-sys-top">
              <span className={`gx-badge ${sys.kind === 'PS' ? 'ps' : ''}`}>{sys.name}</span>
              <div className="grow"><div className={used ? 'gx-name' : 'gx-free'}>{used ? `${used} of ${working(sys)} controllers busy` : 'Free'}</div>
                <div className="muted small">{free.length ? `${free.length} controller${free.length === 1 ? '' : 's'} free` : 'All controllers busy'}</div></div>
              {free.length > 0 && <button className="btn small gx-ok" onClick={() => setSheet({ kind: 'start', system: sys, seats: free })}>Start{free.length > 1 ? '…' : ''}</button>}
            </div>
            {playing.length > 1 && (
              <div className="gx-btns">
                {anyRunning && <button className="btn small" onClick={() => pause(playing.filter((s) => !s.paused_at), true)}>⏸ Pause all</button>}
                {anyPaused && <button className="btn small" onClick={() => pause(playing.filter((s) => s.paused_at), false)}>▶ Resume all</button>}
              </div>
            )}
            {list.map(({ seat, s }) => s?.shared ? (
              <div key={seat} className="gx-seat">
                <div className="gx-sys-top"><span className="gx-badge sm">🎮{seat}</span><div className="grow muted small">With {s.customer_name} (controller {s.seat || 1})</div></div>
              </div>
            ) : off(sys, seat) ? (
              <div key={seat} className="gx-seat">
                <div className="gx-sys-top"><span className="gx-badge sm">🎮{seat}</span><div className="grow muted small">Controller {seat} · out of order</div>
                  {admin && <button className="btn small ghost" onClick={() => setOff(sys, seat, false)}>Back in use</button>}</div>
              </div>
            ) : s ? (
              <div key={seat} className={`gx-seat ${stateOf(s, now)}`}>
                <SessionRow sys={sys} s={s} now={now} badge={`🎮${seat}`} onSheet={(kind) => setSheet({ kind, system: sys, session: s })} onPause={(on) => pause([s], on)} />
              </div>
            ) : (
              <div key={seat} className="gx-seat free">
                <div className="gx-sys-top">
                  <span className="gx-badge sm">🎮{seat}</span>
                  <div className="grow"><span className="gx-free">Controller {seat} free</span></div>
                  {admin && <button className="btn small ghost" onClick={() => setOff(sys, seat, true)} title="Mark out of order">Out of order</button>}
                  <button className="btn small gx-ok" onClick={() => setSheet({ kind: 'start', system: sys, seats: [seat] })}>Start</button>
                </div>
              </div>
            ))}
          </div>
        )
      })}
      {sheet?.kind === 'start' && <StartSheet system={sheet.system} seats={sheet.seats} free={freeSeats(sheet.system)} booking={sheet.booking} dues={shop.dues} rates={shop.rates} settings={shop.settings} happy={isHappyDay(shop.settings)} householdId={householdId} onClose={close} onDone={done} />}
      {sheet?.kind === 'book' && <BookSheet shop={shop} householdId={householdId} onClose={close} onDone={done} />}
      {sheet?.kind === 'fnb' && <FnbSheet session={sheet.session} onClose={close} onDone={done} />}
      {sheet?.kind === 'extend' && <ExtendSheet system={sheet.system} session={sheet.session} rates={shop.rates} onClose={close} onDone={done} />}
      {sheet?.kind === 'end' && <EndSheet session={sheet.session} settings={shop.settings} deposits={shop.deposits} householdId={householdId} onClose={close} onDone={done} />}
    </section>
  )
}

// Owner: "alarm when time ends". Every phone with Slots open beeps (and buzzes) when a session reaches
// 5 minutes left and again when its time is up; a phone notification too if alerts are allowed.
function useTimeUpAlarm(running, now) {
  const fired = useRef(new Set())
  useEffect(() => {
    for (const s of running) {
      if (s.paused_at) continue
      const left = minutesLeft(s, now)
      for (const [mark, msg] of [[5, '5 minutes left'], [0, 'time is up']]) {
        const key = `${s.id}:${s.minutes}:${mark}`
        if (left <= mark && left > mark - 3 && !fired.current.has(key)) {
          fired.current.add(key)
          alarm(mark === 0 ? 3 : 1)
          const title = `${s.system_name}${s.seat > 1 || s.system_name.startsWith('PS') ? ` · controller ${s.seat || 1}` : ''}: ${msg}`
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            navigator.serviceWorker?.getRegistration().then((reg) => reg?.showNotification(title, { body: s.customer_name, icon: '/icons/icon-192.png', tag: key })).catch(() => {})
          }
        }
      }
    }
  }, [running, now])
}
const stateOf = (s, now) => { const left = minutesLeft(s, now); return s.paused_at ? 'paused' : left <= 0 ? 'over' : left <= 5 ? 'ending' : 'busy' }

// One running session (a PC, or one PS5 controller): customer, times, code for the timer screen, actions.
function SessionRow({ sys, s, now, badge, onSheet, onPause }) {
  const left = minutesLeft(s, now)
  const state = stateOf(s, now)
  const pct = Math.min(100, Math.max(0, 100 - (left / s.minutes) * 100))
  const fnb = Number(s.fnb_before) + Number(s.fnb_while)
  return (<>
    <div className="gx-sys-top">
      <span className={`gx-badge ${badge.length > 3 ? 'sm' : ''} ${sys.kind === 'PS' ? 'ps' : ''}`}>{badge}</span>
      <div className="grow">
        <div className="gx-name">{s.customer_name}{s.players > 1 ? ` · ${s.players} players` : ''}</div>
        <div className="muted small">{timeLabel(s.started_at)} – {timeLabel(sessionEnd(s, now))}{fnb ? ` · F&B ${rs(fnb)}` : ''}{s.entered_by ? ` · ${byLine(s)}` : ''} · code <b className="mono">{shortCode(s.id)}</b></div>
      </div>
      <span className={`pill gx-pill ${state}`}>{s.paused_at ? `Paused · ${durLabel(left)} left` : left <= 0 ? `Time up ${durLabel(-left)} ago` : `${durLabel(left)} left`}</span>
    </div>
    <div className="gx-bar"><i style={{ width: `${pct}%` }} /></div>
    <div className="gx-btns">
      <button className="btn small" onClick={() => onSheet('fnb')}>+ F&amp;B</button>
      <button className="btn small" onClick={() => onSheet('extend')}>Extend</button>
      <button className="btn small" onClick={() => onPause(!s.paused_at)}>{s.paused_at ? '▶ Resume' : '⏸ Pause'}</button>
      <button className="btn small primary" style={{ marginLeft: 'auto' }} onClick={() => onSheet('end')}>End &amp; collect</button>
    </div>
  </>)
}

const FNB = [[0, 'None'], [10, '₹10'], [20, '₹20'], [30, '₹30'], [40, '₹40'], [60, '₹60']]

// Start one PC, or one or more PS5 controllers together (each controller = one customer, one timer, priced
// per head). A booking's amount is split across its controllers as already paid online.
function StartSheet({ system, seats, free, booking, dues, rates, settings, happy, householdId, onClose, onDone }) {
  const now = useNow(30_000)
  const [picked, setPicked] = useState(seats || [free[0]])
  const [name, setName] = useState(booking?.customer_name || '')
  const [phone, setPhone] = useState(booking?.customer_phone || '')
  const [mins, setMins] = useState(booking?.minutes || 60)
  const [fnb, setFnb] = useState(0)
  const online = booking && booking.source !== 'counter' // online bookings are paid in full by UPI
  const [pay, setPay] = useState(online ? 'booked' : 'end')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const multi = (system.seats || 1) > 1
  const count = picked.length
  const each = priceFor(rates, system.kind, mins, happy)
  const bookedSame = booking && mins === booking.minutes && count === (booking.players || 1)
  const gaming = bookedSame ? Number(booking.amount) : each * count
  const total = gaming + fnb
  const key = customerKey(name, phone)
  const owes = key.length > 2 ? duesByCustomer(dues).find((d) => d.key === key) : null
  const toggle = (n) => setPicked((p) => (p.includes(n) ? (p.length > 1 ? p.filter((x) => x !== n) : p) : [...p, n].sort()))

  async function save() {
    setBusy(true); setError(null)
    const split = (v) => Math.round((v / count) * 100) / 100
    const rows = picked.map((seat, i) => {
      const g = bookedSame ? split(Number(booking.amount)) : each
      const f = i === 0 ? fnb : 0
      return {
        household_id: householdId, system_id: system.id, system_name: system.name, seat,
        customer_name: (name.trim() || 'Walk-in') + (count > 1 ? ` (${i + 1}/${count})` : ''), customer_phone: phone.trim() || null,
        base_minutes: mins, minutes: mins, gaming_amount: g, fnb_before: f, players: 1, happy, booking_id: booking?.id || null,
        paid_cash: pay === 'cash' ? g + f : 0, paid_online: pay === 'online' ? g + f : pay === 'booked' ? split(Number(booking.amount)) : 0,
      }
    })
    const { data: created, error } = await supabase.from('shop_sessions').insert(rows).select('id')
    setBusy(false)
    if (error) { setError(error.code === '23505' ? (multi ? `Another controller on ${system.name} can’t start until the database update for controllers is approved. Start one at a time for now.` : `${system.name} is already running.`) : error.message); return }
    if (booking) await supabase.from('shop_bookings').update({ status: 'arrived', session_id: created[0].id }).eq('id', booking.id)
    onDone(`${system.name}${multi ? ` · controller${count > 1 ? 's' : ''} ${picked.join(', ')}` : ''} started for ${name.trim() || 'walk-in'} · ends ${timeLabel(new Date(Date.now() + mins * 60_000))}`)
  }

  return (
    <Sheet title={`Start ${system.name}`} sub={`${timeLabel(now)} – ${timeLabel(now + mins * 60_000)}${happy ? ' · happy hours' : ''}`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      {multi && (<>
        <div className="caps muted">Controllers · one customer each, charged per head</div>
        <div className="chips">{free.map((n) => <button type="button" key={n} className={`chip chip-btn ${picked.includes(n) ? 'on' : ''}`} onClick={() => toggle(n)}>🎮 {n}</button>)}</div>
      </>)}
      <CustomerFields householdId={householdId} name={name} setName={setName} phone={phone} setPhone={setPhone} />
      {owes && <div className="alert error" style={{ margin: 0 }}>{owes.name} owes {rs(owes.total)} from before · collect it in Cash → Customer dues</div>}
      <div className="caps muted">Time</div>
      <Chips scroll options={DURATIONS.map((m) => [m, durLabel(m)])} value={mins} onChange={setMins} />
      <div className="caps muted">F&amp;B before gaming</div>
      <Chips scroll options={FNB} value={fnb} onChange={setFnb} />
      <div className="caps muted">Payment</div>
      {booking && !online && Number(booking.paid) > 0 && <div className="small muted">{rs(booking.paid)} advance was taken when booking — it's offered at the end as {booking.customer_name}’s deposit.</div>}
      <Chips options={[...(online ? [['booked', `Paid online · ${rs(booking.amount)}`]] : []), ['end', 'At the end'], ['cash', 'Paid now · cash'], ['online', 'Paid now · online']]} value={pay} onChange={setPay} />
      {pay === 'online' && <UpiQrButton settings={settings} amount={total} note={`${system.name} · ${name.trim() || 'Walk-in'}`} />}
      <div className="gx-box">
        <SumRow label={`Gaming · ${durLabel(mins)}${count > 1 ? ` × ${count}` : ''}${happy ? ' · happy hours' : ''}`} value={rs(gaming)} />
        {fnb > 0 && <SumRow label="F&B" value={rs(fnb)} />}
        <SumRow strong label={pay === 'end' ? 'Total so far' : pay === 'booked' ? 'Paid when booking' : 'Paid now'} value={rs(pay === 'booked' ? Number(booking.amount) : total)} />
      </div>
      <SheetActions onClose={onClose} busy={busy} label={count > 1 ? `Start ${count} timers` : 'Start timer'} />
    </Sheet>
  )
}

function FnbSheet({ session, onClose, onDone }) {
  const [amt, setAmt] = useState(20)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const value = custom ? Number(custom) : amt
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').update({ fnb_while: Number(session.fnb_while) + value }).eq('id', session.id)
    setBusy(false)
    if (error) { onDone(error.message); return }
    onDone(`${rs(value)} F&B added to ${session.system_name}`)
  }
  return (
    <Sheet title={`F&B · ${session.system_name}`} sub={`${session.customer_name} · added to the bill, paid at the end`} onClose={onClose} onSubmit={save}>
      <Chips scroll options={FNB.slice(1)} value={custom ? null : amt} onChange={(v) => { setAmt(v); setCustom('') }} />
      <label>Other amount<input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} placeholder="₹" /></label>
      <SheetActions onClose={onClose} busy={busy} disabled={!(value > 0)} label={`Add ${rs(value || 0)}`} />
    </Sheet>
  )
}

function ExtendSheet({ system, session, rates, onClose, onDone }) {
  const [add, setAdd] = useState(30)
  const [busy, setBusy] = useState(false)
  const minutes = session.minutes + add
  const extend = Math.max(0, priceFor(rates, system.kind, minutes, session.happy) * (session.players || 1) - Number(session.gaming_amount))
  const extra = extend - Number(session.extend_amount)
  const newEnd = sessionEnd({ ...session, minutes })
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').update({ minutes, extend_amount: extend }).eq('id', session.id)
    setBusy(false)
    if (error) { onDone(error.message); return }
    onDone(`${session.system_name} now ends ${timeLabel(newEnd)}`)
  }
  return (
    <Sheet title={`Extend ${session.system_name}`} sub={`${session.customer_name} · now ends ${timeLabel(sessionEnd(session))}`} onClose={onClose} onSubmit={save}>
      <Chips options={[[30, '+30 min'], [60, '+1 hr'], [90, '+1h 30m'], [120, '+2 hr']]} value={add} onChange={setAdd} />
      <div className="gx-box">
        <SumRow label="New end" value={timeLabel(newEnd)} />
        <SumRow strong label="Extend amount" value={`+${rs(extra)}`} />
      </div>
      <SheetActions onClose={onClose} busy={busy} label="Extend" />
    </Sheet>
  )
}

function EndSheet({ session, settings, deposits = [], householdId, onClose, onDone }) {
  const now = useNow(30_000)
  const dep = balanceFor(deposits, session.customer_name, session.customer_phone)
  const [useDep, setUseDep] = useState(!!dep)
  const [mode, setMode] = useState('cash')
  const [discount, setDiscount] = useState('')
  const [cashPart, setCashPart] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const disc = Number(discount) || 0
  const total = sessionTotal(session) - disc
  const paid = sessionPaid(session)
  const before = Math.max(0, total - paid)
  const fromDep = useDep && dep ? Math.min(dep.balance, before) : 0
  const due = before - fromDep
  const cash = mode === 'cash' ? due : mode === 'split' ? Math.min(due, Number(cashPart) || 0) : 0
  const online = mode === 'online' ? due : mode === 'split' ? due - cash : 0
  const owed = mode === 'owes' ? due : 0

  async function save() {
    if (mode === 'owes' && session.customer_name === 'Walk-in') { setError('Add the customer’s name to keep this as dues.'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('shop_sessions').update({
      status: 'closed', ended_at: new Date().toISOString(), closed_by: user?.id,
      discount: Number(session.discount) + disc,
      paid_cash: Number(session.paid_cash) + cash, paid_online: Number(session.paid_online) + online, owed,
      paid_deposit: Number(session.paid_deposit || 0) + fromDep,
    }).eq('id', session.id)
    if (!error && fromDep > 0) {
      await supabase.from('shop_deposits').insert({ household_id: householdId, customer_name: dep.name, customer_phone: dep.phone || null, kind: 'use', amount: fromDep, session_id: session.id })
    }
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(mode === 'owes' ? `${session.system_name} is free. ${rs(owed)} kept as ${session.customer_name}’s dues.`
      : `${session.system_name} is free. ${rs(due)} collected.`)
  }

  async function cancel() {
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('id', session.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${session.system_name} session removed`)
  }

  return (
    <Sheet title={`End ${session.system_name} · ${session.customer_name}`} sub={`${timeLabel(session.started_at)} – ${timeLabel(now)}`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <div className="gx-box">
        <SumRow label={`Gaming · ${durLabel(session.base_minutes)}${session.players > 1 ? ` × ${session.players}` : ''}${session.happy ? ' · happy hours' : ''}`} value={rs(session.gaming_amount)} />
        {Number(session.extend_amount) > 0 && <SumRow label={`Extended · ${durLabel(session.minutes - session.base_minutes)}`} value={rs(session.extend_amount)} />}
        {Number(session.fnb_before) > 0 && <SumRow label="F&B before" value={rs(session.fnb_before)} />}
        {Number(session.fnb_while) > 0 && <SumRow label="F&B while gaming" value={rs(session.fnb_while)} />}
        {disc > 0 && <SumRow label="Discount" value={`−${rs(disc)}`} />}
        {paid > 0 && <SumRow label="Already paid" value={`−${rs(paid)}`} />}
        {fromDep > 0 && <SumRow label="From deposit" value={`−${rs(fromDep)}`} />}
        <SumRow strong label="To collect" value={rs(due)} />
      </div>
      {dep && (
        <label className="gx-check"><input type="checkbox" checked={useDep} onChange={(e) => setUseDep(e.target.checked)} />
          Use {dep.name}’s deposit · {rs(dep.balance)} left this month</label>
      )}
      <div className="caps muted">Paid by</div>
      <Chips options={[['cash', 'Cash'], ['online', 'Online'], ['split', 'Cash + Online'], ['owes', 'Owes (dues)']]} value={mode} onChange={setMode} />
      {(mode === 'online' || mode === 'split') && <UpiQrButton settings={settings} amount={online} note={`${session.system_name} · ${session.customer_name}`} />}
      {mode === 'split' && <label>Cash part<input inputMode="numeric" value={cashPart} onChange={(e) => setCashPart(e.target.value.replace(/\D/g, ''))} placeholder={`of ${rs(due)} — rest is online`} /></label>}
      <label>Discount (optional)<input inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ''))} placeholder="₹" /></label>
      <SheetActions onClose={onClose} busy={busy} label={due === 0 && fromDep > 0 ? 'Paid from deposit · end' : mode === 'owes' ? `Save ${rs(due)} as dues` : `Collect ${rs(due)}`} />
      {paid === 0 && <button type="button" className="btn link" style={{ justifySelf: 'start', color: 'var(--neg)' }} onClick={cancel}>Started by mistake? Remove this session</button>}
    </Sheet>
  )
}

// Online money to check, on every phone (admin and staff): slot bookings from /#book, event advances and
// tournament entry fees from the home page. Staff open their UPI app, then tap Received — or Not received,
// which cancels the request. "Arrived" on a confirmed slot booking starts its session, already paid.
function Bookings({ bookings = [], eventChecks = [], entryChecks = [], onArrived, onBook, onChanged }) {
  const dialog = useDialog()
  async function update(table, row, patch, msg, ask) {
    if (ask && !await dialog.confirm(ask)) return
    const { error } = await supabase.from(table).update(patch).eq('id', row.id)
    onChanged(error ? error.message : msg)
  }
  const notPaid = (name) => ({ title: `Payment not received from ${name}?`, message: 'This cancels the request and frees the time.', confirmLabel: 'Not received · cancel', cancelLabel: 'Keep', danger: true })
  const day = (d) => { const x = new Date(d), t = new Date(); return x.toDateString() === t.toDateString() ? 'Today' : x.toDateString() === new Date(t.getTime() + 86_400_000).toDateString() ? 'Tomorrow' : x.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) }
  const toCheck = bookings.filter((b) => b.status === 'requested').length + eventChecks.length + entryChecks.length
  const by = (r) => (r.handled_by ? ` · ✓ ${r.handled_by}` : '')
  return (
    <div className="card gx-bookings">
      <div className="card-head"><h3>Bookings</h3><span className={`small ${toCheck ? 'neg' : 'muted'}`}>{toCheck ? `${toCheck} payment${toCheck === 1 ? '' : 's'} to check` : 'All checked'}</span></div>
      {bookings.length + eventChecks.length + entryChecks.length === 0 && (
        <div className="muted small">No bookings yet. Online bookings from customers and <button type="button" className="btn link" style={{ padding: 0 }} onClick={onBook}>+ Book</button> show here, by day.</div>
      )}
      {bookings.map((b, i) => (
        <div key={b.id} className="gx-booking">
          {(i === 0 || day(bookings[i - 1].starts_at) !== day(b.starts_at)) && <div className="caps muted gx-book-day">{day(b.starts_at)}</div>}
          <div className="gx-sys-top">
            <span className={`gx-badge sm ${b.kind === 'PS' ? 'ps' : ''}`}>{b.kind === 'PS' ? 'PS5' : 'PC'}</span>
            <div className="grow">
              <div className="gx-name">{b.customer_name}{b.players > 1 ? ` · ${b.players} players` : ''}</div>
              <div className="muted small">{day(b.starts_at)} {timeLabel(b.starts_at)} – {timeLabel(new Date(b.starts_at).getTime() + b.minutes * 60_000)} · {rs(b.amount)}{b.source === 'counter' ? ` · ${Number(b.paid) > 0 ? `${rs(b.paid)} advance ${b.paid_mode}` : 'pay at counter'} · booked by ${b.entered_by || 'staff'}` : ''}{b.upi_ref ? ` · ref ${b.upi_ref}` : ''} · {b.customer_phone}{by(b)}{b.note ? ` · ${b.note}` : ''}</div>
            </div>
            <span className={`pill gx-pill ${b.status === 'requested' ? 'ending' : 'free'}`}>{b.status === 'requested' ? 'Payment?' : b.source === 'counter' ? 'Booked' : 'Paid'}</span>
          </div>
          <div className="gx-btns">
            <a className="btn small ghost" href={`tel:${b.customer_phone}`} title={b.customer_phone}>Call</a>
            {b.status === 'requested' && <button className="btn small primary" onClick={() => update('shop_bookings', b, { status: 'confirmed' }, 'Payment received · booking confirmed')}>Received</button>}
            {b.status === 'requested' && <button className="btn small danger-ghost" onClick={() => update('shop_bookings', b, { status: 'cancelled' }, 'Booking cancelled', notPaid(b.customer_name))}>Not received</button>}
            {b.status === 'confirmed' && <button className="btn small primary" onClick={() => onArrived(b)}>Arrived</button>}
            {b.status === 'confirmed' && <button className="btn small ghost" aria-label="Cancel booking" onClick={() => update('shop_bookings', b, { status: 'cancelled' }, 'Booking cancelled', { title: `Cancel ${b.customer_name}’s booking?`, message: b.source === 'counter' ? (Number(b.paid) > 0 ? `The time opens up. The ${rs(b.paid)} advance stays as their deposit this month.` : 'The time opens up for others.') : 'The time opens up for others. The online payment is non-refundable.', confirmLabel: 'Cancel booking', cancelLabel: 'Keep', danger: true })}>✕</button>}
          </div>
        </div>
      ))}
      {eventChecks.map((b) => (
        <div key={b.id} className="gx-booking">
          <div className="gx-sys-top">
            <span className="gx-badge sm ev">EV</span>
            <div className="grow">
              <div className="gx-name">{b.customer_name}{b.players > 1 ? ` · ${b.players} players` : ''}</div>
              <div className="muted small">{b.shop_events?.name} · {day(b.slot_start)} {timeLabel(b.slot_start)} · advance {rs(b.advance_paid)} of {rs(b.amount)}{b.upi_ref ? ` · ref ${b.upi_ref}` : ''} · {b.customer_phone}</div>
            </div>
            <span className="pill gx-pill ending">Payment?</span>
          </div>
          <div className="gx-btns">
            <a className="btn small ghost" href={`tel:${b.customer_phone}`} title={b.customer_phone}>Call</a>
            <button className="btn small primary" onClick={() => update('shop_event_bookings', b, { payment_ok: true }, 'Advance received · slot confirmed')}>Received</button>
            <button className="btn small danger-ghost" onClick={() => update('shop_event_bookings', b, { status: 'cancelled' }, 'Booking cancelled', notPaid(b.customer_name))}>Not received</button>
          </div>
        </div>
      ))}
      {entryChecks.map((x) => (
        <div key={x.id} className="gx-booking">
          <div className="gx-sys-top">
            <span className="gx-badge sm ev">🏆</span>
            <div className="grow">
              <div className="gx-name">{x.name} · {x.rank}</div>
              <div className="muted small">{x.shop_events?.name} · {Number(x.fee) ? `entry fee ${rs(x.fee)}` : 'fee not set yet'}{x.upi_ref ? ` · ref ${x.upi_ref}` : ''} · {x.phone}</div>
            </div>
            <span className="pill gx-pill ending">{Number(x.fee) ? 'Payment?' : 'New entry'}</span>
          </div>
          <div className="gx-btns">
            <a className="btn small ghost" href={`tel:${x.phone}`} title={x.phone}>Call</a>
            <button className="btn small primary" onClick={() => update('shop_entries', x, { status: 'confirmed' }, `${x.name} is in`)}>{Number(x.fee) ? 'Received' : 'Confirm'}</button>
            <button className="btn small danger-ghost" onClick={() => update('shop_entries', x, { status: 'cancelled' }, 'Entry cancelled', Number(x.fee) ? notPaid(x.name) : { title: `Remove ${x.name}’s entry?`, confirmLabel: 'Remove', danger: true })}>{Number(x.fee) ? 'Not received' : 'Remove'}</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// Owner: staff book a customer who calls (Slots → + Book): PC or PS5, day, time, how long, players, name and
// mobile, then an advance (cash / online, kept as the customer's deposit and used at the end) or pay at the
// counter. Free systems come from public_availability (the same count online booking uses).
const ymdLocal = (d) => d.toLocaleDateString('en-CA')
function BookSheet({ shop, householdId, onClose, onDone }) {
  const [kind, setKind] = useState('PC')
  const [day, setDay] = useState(() => ymdLocal(new Date()))
  const [time, setTime] = useState(null)
  const [mins, setMins] = useState(60)
  const [players, setPlayers] = useState(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [pay, setPay] = useState('counter')
  const [adv, setAdv] = useState('')
  const [avail, setAvail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    setAvail(null); setTime(null)
    supabase.rpc('public_availability', { p_day: day }).then(({ data, error }) => { if (error) setError(error.message); else setAvail(data || []) })
  }, [day])
  const happy = (shop.settings?.happy_days || [3, 4, 5]).includes(new Date(`${day}T00:00`).getDay())
  const amount = priceFor(shop.rates, kind, mins, happy) * players
  const ps = shop.systems.filter((x) => x.kind === 'PS')
  const maxPlayers = kind === 'PS' ? Math.max(1, ps.reduce((a, x) => a + (x.seats || 1) - (x.off_seats || []).length, 0)) : 1
  const fits = (t) => {
    const i = avail.findIndex((a) => a.t === t)
    for (let k = 0; k < Math.ceil(mins / 30); k++) { const a = avail[i + k]; if (!a || a[kind] < players) return false }
    return new Date(t).getTime() > Date.now() - 10 * 60_000
  }
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d })
  async function save() {
    const digits = phone.replace(/\D/g, '').slice(-10)
    if (digits.length !== 10) { setError('Enter a 10-digit mobile number.'); return }
    const paid = pay === 'counter' ? 0 : Number(adv) || 0
    setBusy(true); setError(null)
    const { error } = await supabase.from('shop_bookings').insert({
      household_id: householdId, kind, starts_at: time, minutes: mins, players, customer_name: name.trim(), customer_phone: digits,
      amount, status: 'confirmed', source: 'counter', paid, paid_mode: paid ? pay : null, note: note.trim() || null,
    })
    if (!error && paid) {
      // The advance is money in today (drawer / Cashbook) and becomes their deposit, used when they play.
      await supabase.from('shop_deposits').insert({ household_id: householdId, customer_name: name.trim(), customer_phone: digits, kind: 'add', amount: paid, mode: pay })
    }
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${name.trim()} booked · ${new Date(time).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })} ${timeLabel(time)}`)
  }
  const slots = (avail || []).filter((a) => new Date(a.t).getTime() > Date.now() - 10 * 60_000)
  return (
    <Sheet title="Book for later" sub="A customer who called or came by. They get the slot; staff press Arrived when they come." onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <CustomerFields householdId={householdId} name={name} setName={setName} phone={phone} setPhone={setPhone} phonePlaceholder="10 digits" required autoFocus />
      <Chips options={[['PC', 'PC'], ['PS', 'PS5']]} value={kind} onChange={(v) => { setKind(v); setPlayers(1); setTime(null) }} />
      <Chips scroll options={days.map((d, i) => [ymdLocal(d), i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })])} value={day} onChange={setDay} />
      <div className="caps muted">How long</div>
      <Chips scroll options={DURATIONS.map((m) => [m, durLabel(m)])} value={mins} onChange={(v) => { setMins(v); setTime(null) }} />
      {maxPlayers > 1 && (<>
        <div className="caps muted">Players · one controller each, per head</div>
        <Chips options={Array.from({ length: maxPlayers }, (_, i) => [i + 1, String(i + 1)])} value={players} onChange={(v) => { setPlayers(v); setTime(null) }} />
      </>)}
      <div className="caps muted">Start time{happy ? ' · happy hours' : ''}</div>
      {!avail ? <div className="muted small">Loading…</div> : slots.length === 0 ? <div className="muted small">No more times this day.</div> : (
        <div className="book-slots">{slots.map((a) => <button key={a.t} type="button" disabled={!fits(a.t)} className={`book-slot ${time === a.t ? 'on' : ''}`} onClick={() => setTime(a.t)}>{timeLabel(a.t)}</button>)}</div>
      )}
      <div className="caps muted">Payment</div>
      <Chips options={[['counter', 'Pay at the counter'], ['cash', 'Advance · cash'], ['online', 'Advance · online']]} value={pay} onChange={(v) => { setPay(v); if (v !== 'counter' && !adv) setAdv(String(amount)) }} />
      {pay !== 'counter' && (<>
        <label>Advance (₹)<input inputMode="numeric" value={adv} onChange={(e) => setAdv(e.target.value.replace(/\D/g, ''))} /></label>
        {pay === 'online' && <UpiQrButton settings={shop.settings} amount={Number(adv) || 0} note={`Booking advance · ${name.trim() || 'customer'}`} />}
      </>)}
      <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. birthday, wants PC3" /></label>
      <div className="gx-box">
        <SumRow label={`${kind === 'PS' ? 'PS5' : 'PC'} · ${durLabel(mins)}${players > 1 ? ` × ${players}` : ''}${happy ? ' · happy hours' : ''}`} value={rs(amount)} />
        {pay !== 'counter' && <SumRow label="Advance now" value={`−${rs(adv || 0)}`} />}
        <SumRow strong label="At the counter" value={rs(Math.max(0, amount - (pay === 'counter' ? 0 : Number(adv) || 0)))} />
      </div>
      <SheetActions onClose={onClose} busy={busy} disabled={!time || name.trim().length < 2 || phone.replace(/\D/g, '').length < 10} label={time ? `Book ${timeLabel(time)}` : 'Pick a time'} />
    </Sheet>
  )
}
