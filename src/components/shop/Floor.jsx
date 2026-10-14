import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../../lib/dialog'
import { supabase } from '../../lib/supabase'
import { qrSvg } from '../../lib/upi'
import PcPicker from '../PcPicker'
import { DURATIONS, balanceFor, customerKey, duesByCustomer, durLabel, isHappyDay, minutesLeft, priceFor, sessionEnd, sessionPaid, sessionTotal, shortCode, timeLabel, useNow, rs } from '../../lib/shop'
import { ActionGrid, ActionSheet, Chips, Sheet, SheetActions, SumRow, inOut } from './ui'
import { ClockPlusIcon, CupIcon, MoveIcon, PauseIcon, PhoneIcon, PlayIcon, QrIcon, XIcon } from '../../lib/icons'
import { UpiQrButton } from './UpiQr'
import { alarm, speak } from '../../lib/alarm'
import CustomerFields from './CustomerFields'

// The Floor ("Slots" tab): every system with its live state. Free → Start; playing → + F&B, Extend, Pause, End.
// A PS5 has one row per controller (owner: each controller is a separate customer with its own timer; start
// them together or one later). Pause / Resume (technical failure) stops the clock, so no one loses time.
// Replaces the sheet's rows (Name, System, Time in/out, F&B, Extend, Total, Payment mode).
export default function Floor({ shop, householdId, toast }) {
  const now = useNow(10_000)
  const dialog = useDialog()
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
  const freeSeats = (sys) => { const h = holders(sys); return Array.from({ length: seatsOf(sys) }, (_, i) => i + 1).filter((n) => !h.has(n) && !off(sys, n)) }
  const working = (sys) => seatsOf(sys) - (sys.off_seats || []).filter((n) => n <= seatsOf(sys)).length
  const totalSeats = shop.systems.reduce((a, x) => a + working(x), 0)
  const busySeats = shop.systems.reduce((a, x) => a + (working(x) - freeSeats(x).length), 0)
  async function setOff(sys, n, isOff) {
    // Staff and admin (owner, 13 Oct): rpc set_seat_off changes only this controller's out-of-order flag.
    const { error } = await supabase.rpc('set_seat_off', { p_system: sys.id, p_seat: n, p_off: isOff })
    done(error ? error.message : isOff ? `Controller ${n} marked out of order` : `Controller ${n} is back in use`)
  }
  const close = () => setSheet(null)
  // Owner: a calendar in Slots like Events — see tomorrow's bookings (online and counter) and book from it.
  const [view, setView] = useState(() => { try { return localStorage.getItem('gx.slotsView') || 'live' } catch { return 'live' } })
  const setViewSaved = (v) => { setView(v); try { localStorage.setItem('gx.slotsView', v) } catch { /* ignore */ } }
  const done = (msg) => { setSheet(null); toast(msg); shop.reload() }

  const startBooking = (b) => {
    const need = b.players || 1
    const named = b.system_id && shop.systems.find((x) => x.id === b.system_id && freeSeats(x).length >= need)
    const sys = named || shop.systems.find((x) => x.kind === b.kind && freeSeats(x).length >= need)
    if (!sys) { toast(`No free ${b.kind === 'PS' ? 'PS5 controllers' : 'PC'} right now`); return }
    setSheet({ kind: 'start', system: sys, seats: freeSeats(sys).slice(0, need), booking: b })
  }
  async function pause(list, on) {
    const t = new Date()
    list = on ? list : list.filter((x) => !x.waiting) // waiting entries start with ▶ Start timer, not Resume
    const results = await Promise.all(list.map((s) => supabase.from('shop_sessions').update(on
      ? { paused_at: t.toISOString() }
      : { paused_at: null, paused_minutes: Number(s.paused_minutes || 0) + (t - new Date(s.paused_at)) / 60_000 }).eq('id', s.id)))
    const err = results.find((r) => r.error)?.error
    done(err ? err.message : on ? 'Paused · the time left is kept' : 'Resumed')
  }
  // Owner (13 Oct): details first, clock later — a waiting entry's time starts now, from its full length.
  // A waiting entry the customer won't use (left / saved by mistake): cancelled, no bill (staff and admin).
  async function cancelWaiting(s) {
    const paid = Number(s.paid_cash) + Number(s.paid_online)
    if (!await dialog.confirm({ title: `Cancel ${s.customer_name}'s entry on ${s.system_name}?`, danger: true, confirmLabel: 'Cancel entry', cancelLabel: 'Keep',
      message: paid ? `It hasn't started, so there's no bill. They paid ${rs(paid)} — give it back; it comes off today's takings.` : 'It hasn’t started, so there’s no bill. The PC is free again.' })) return
    const { error } = await supabase.from('shop_sessions').update({ status: 'cancelled', waiting: false, ended_at: new Date().toISOString() }).eq('id', s.id)
    done(error ? error.message : `${s.system_name} entry for ${s.customer_name} cancelled`)
  }
  async function startWaiting(s) {
    const { error } = await supabase.from('shop_sessions').update({ waiting: false, started_at: new Date().toISOString(), paused_at: null, paused_minutes: 0 }).eq('id', s.id)
    done(error ? error.message : `${s.system_name} started for ${s.customer_name} · ends ${timeLabel(new Date(Date.now() + s.minutes * 60_000))}`)
  }
  // Owner (13 Oct): a squad comes — enter everyone, then start all their clocks with one tap.
  const waitingAll = shop.sessions.filter((x) => x.status === 'running' && x.waiting)
  async function startAll() {
    const t = new Date().toISOString()
    const { error } = await supabase.from('shop_sessions').update({ waiting: false, started_at: t, paused_at: null, paused_minutes: 0 }).in('id', waitingAll.map((x) => x.id))
    done(error ? error.message : `${waitingAll.length} timers started · ${waitingAll.map((x) => x.system_name + (x.system_name.startsWith('PS') ? ` C${x.seat || 1}` : '')).join(', ')}`)
  }
  if (!shop.systems.length) return <div className="card muted">No systems yet. The admin adds them in ⚙ → Systems & rates.</div>

  // What is free right now: one tile per PC, one per PS5 with its free controllers (tap = Start).
  const freeTiles = shop.systems.flatMap((sys) => {
    const free = freeSeats(sys)
    if (!free.length) return []
    return [{ sys, seats: free, sub: seatsOf(sys) > 1 ? `${free.length} of ${working(sys)} controllers` : sys.kind === 'PS' ? 'PlayStation' : 'PC' }]
  })
  // Everyone on the floor, one row each (a PS5 player with friends holds more controllers but is one row).
  const playingList = shop.systems.flatMap((sys) => {
    const seen = new Set()
    return [...holders(sys).entries()].sort((a, b) => a[0] - b[0]).filter(([, s]) => !s.shared && !seen.has(s.id) && seen.add(s.id)).map(([seat, s]) => ({ sys, seat, s }))
  })
  const live = playingList.filter((x) => !x.s.waiting)
  const multi = shop.systems.filter((x) => seatsOf(x) > 1)
  const offCount = multi.reduce((a, x) => a + (x.off_seats || []).filter((n) => n <= seatsOf(x)).length, 0)
  async function pauseAll(on) {
    const list = live.map((x) => x.s).filter((s) => (on ? !s.paused_at : s.paused_at))
    if (on && !await dialog.confirm({ title: `Pause all ${list.length} running?`, message: 'For a power cut or a technical problem. Nobody loses time; Resume all starts them again.', confirmLabel: 'Pause all' })) return
    pause(list, on)
  }
  const openSession = (x) => setSheet({ kind: 'session', system: x.sys, session: x.s, seat: x.seat })

  return (
    <section className="gx-floor">
      <div className="gx-floor-bar">
        <Chips options={[['live', 'Now'], ['calendar', 'Calendar']]} value={view} onChange={setViewSaved} />
        <button className="btn small primary gx-book-btn" onClick={() => setSheet({ kind: 'book' })}>+ Book</button>
      </div>
      {view === 'calendar' ? (<>
        <SlotCalendar shop={shop} toast={toast} onBook={(initial) => setSheet({ kind: 'book', initial })} onArrived={startBooking} />
      </>) : (<>
      <div className="gx-stats">
        <div><b>{busySeats}</b><span>Playing</span></div>
        <div className="free"><b>{totalSeats - busySeats}</b><span>Free</span></div>
        {isHappyDay(shop.settings) && <span className="pill gx-pill happy">Happy hours today</span>}
      </div>
      <Bookings systems={shop.systems} bookings={shop.bookings} eventChecks={shop.eventChecks} entryChecks={shop.entryChecks} onArrived={startBooking} onChanged={(m) => { toast(m); shop.reload() }} />
      {freeTiles.length > 0 && (
        <div className="card gx-freecard">
          <div className="card-head"><h3>Free now</h3><span className="muted small">Tap to start</span></div>
          <div className="gx-freegrid">
            {freeTiles.map((t) => (
              <button key={t.sys.id} type="button" className={`gx-freetile ${t.sys.kind === 'PS' ? 'ps' : ''}`} onClick={() => setSheet({ kind: 'start', system: t.sys, seats: t.seats })}>
                <b>{t.sys.name}</b><span>{t.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="gx-sec-head">
        <h3>Playing <span className="muted">{playingList.length}</span></h3>
        <div className="gx-sec-actions">
          {multi.length > 0 && <button type="button" className="btn link small" onClick={() => setSheet({ kind: 'controllers' })}>Controllers{offCount ? ` · ${offCount} off` : ''}</button>}
          {live.some((x) => x.s.paused_at) && <button type="button" className="btn link small" onClick={() => pauseAll(false)}>Resume all</button>}
          {live.filter((x) => !x.s.paused_at).length > 1 && <button type="button" className="btn link small" onClick={() => pauseAll(true)}>Pause all</button>}
        </div>
      </div>
      {waitingAll.length > 1 && <button className="btn primary block gx-startall" onClick={startAll}>▶ Start all {waitingAll.length} waiting</button>}
      {!playingList.length && <div className="card muted small gx-empty">Nobody playing right now.</div>}
      {playingList.map((x) => <RunRow key={x.s.id} {...x} now={now} onOpen={() => openSession(x)} onStart={() => startWaiting(x.s)} />)}
      </>)}
      {sheet?.kind === 'session' && <SessionSheet system={sheet.system} seat={sheet.seat} s={sheet.session} now={now} onClose={close}
        onAction={(kind) => setSheet({ ...sheet, kind })} onPause={(on) => pause([sheet.session], on)} onStart={() => startWaiting(sheet.session)} onCancel={() => cancelWaiting(sheet.session)} />}
      {sheet?.kind === 'controllers' && <ControllersSheet systems={multi} holders={holders} off={off} onSet={setOff} onClose={close} />}
      {sheet?.kind === 'start' && <StartSheet system={sheet.system} seats={sheet.seats} freeOf={freeSeats} systems={shop.systems} booking={sheet.booking} dues={shop.dues} rates={shop.rates} settings={shop.settings} happy={isHappyDay(shop.settings)} householdId={householdId} onClose={close} onDone={done} />}
      {sheet?.kind === 'book' && <BookSheet shop={shop} householdId={householdId} initial={sheet.initial} onClose={close} onDone={done} />}
      {sheet?.kind === 'fnb' && <FnbSheet session={sheet.session} settings={shop.settings} onClose={close} onDone={done} />}
      {sheet?.kind === 'timer' && <TimerCodeSheet session={sheet.session} onClose={close} />}
      {sheet?.kind === 'move' && <MoveSheet session={sheet.session} systems={shop.systems} freeOf={freeSeats} onClose={close} onDone={done} />}
      {sheet?.kind === 'extend' && <ExtendSheet system={sheet.system} session={sheet.session} rates={shop.rates} settings={shop.settings} onClose={close} onDone={done} />}
      {sheet?.kind === 'end' && <EndSheet session={sheet.session} settings={shop.settings} deposits={shop.deposits} householdId={householdId} onClose={close} onDone={done} />}
    </section>
  )
}

// Owner: "alarm when time ends". Every phone with Slots open beeps (and buzzes) when a session reaches
// 5 minutes left and again when its time is up; a phone notification too if alerts are allowed.
export function useTimeUpAlarm(running, now, onAlert) {
  const fired = useRef(new Set())
  useEffect(() => {
    for (const s of running) {
      if (s.paused_at) continue
      const left = minutesLeft(s, now)
      for (const [mark, msg] of [[5, '5 minutes left'], [0, 'time is up']]) {
        const key = `${s.id}:${s.minutes}:${mark}`
        if (left <= mark && left > mark - 3 && !fired.current.has(key)) {
          fired.current.add(key)
          alarm(mark === 0 ? 10 : 5) // seconds: 5 at 5 min left, 10 at time up
          const where = s.system_name.startsWith('PS') ? `${s.system_name.replace('PS', 'P S ')}, controller ${s.seat || 1}` : s.system_name.replace(/^PC/, 'P C ')
          setTimeout(() => speak(`${mark === 0 ? 'Time is up for' : '5 minutes remaining for'} ${where}, ${s.customer_name.replace(/ \(\d+\/\d+\)$/, '')}`), (mark === 0 ? 10 : 5) * 1000)
          const title = `${s.system_name}${s.seat > 1 || s.system_name.startsWith('PS') ? ` · controller ${s.seat || 1}` : ''}: ${msg}`
          onAlert?.(`⏰ ${title} · ${s.customer_name}`)
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            navigator.serviceWorker?.getRegistration().then((reg) => reg?.showNotification(title, { body: s.customer_name, icon: '/icons/icon-192.png', tag: key })).catch(() => {})
          }
        }
      }
    }
  }, [running, now]) // eslint-disable-line react-hooks/exhaustive-deps
}
const stateOf = (s, now) => { const left = minutesLeft(s, now); return s.waiting ? 'waiting' : s.paused_at ? 'paused' : left <= 0 ? 'over' : left <= 5 ? 'ending' : 'busy' }

// "32m" / "1h 05m" — the big number on a customer's row.
const leftLabel = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m` }
const whereOf = (sys, seat) => (seatsOf1(sys) > 1 ? `${sys.name} · controller ${seat}` : sys.name)
const seatsOf1 = (sys) => sys.seats || 1
const dueOf = (s) => Math.max(0, sessionTotal(s) - sessionPaid(s))

// One customer on the floor: where, who, when it ends, what's still to collect, and the time left — tap for
// everything else (F&B, Extend, Move, Pause, timer code, End & collect). A waiting entry has ▶ Start.
function RunRow({ sys, seat, s, now, onOpen, onStart }) {
  const left = minutesLeft(s, now)
  const state = stateOf(s, now)
  const pct = Math.min(100, Math.max(0, 100 - (left / s.minutes) * 100))
  const due = dueOf(s)
  return (
    <div className={`card gx-run ${state}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <span className={`gx-badge ${sys.kind === 'PS' ? 'ps' : ''}`}>{seatsOf1(sys) > 1 ? <span className="gx-badge-2">{sys.name}<small>C{seat}</small></span> : sys.name}</span>
      <div className="gx-run-main">
        <div className="gx-name">{s.customer_name}{s.players > 1 ? <span className="muted"> · {s.players} players</span> : ''}</div>
        <div className="muted small">{s.waiting ? `Waiting · ${durLabel(s.minutes)} · not started` : `${timeLabel(s.started_at)} – ${timeLabel(sessionEnd(s, now))}${s.paused_at ? ' · paused' : ''}`} · <b className="mono gx-rowcode">{shortCode(s.id)}</b>{due > 0 && <span className="gx-due"> · {rs(due)} due</span>}</div>
      </div>
      {s.waiting
        ? <button type="button" className="btn small primary" onClick={(e) => { e.stopPropagation(); onStart() }}>▶ Start</button>
        : <div className={`gx-left ${state}`}><b>{left <= 0 ? 'Time up' : leftLabel(left)}</b>{left > 0 && <span>{s.paused_at ? 'paused' : 'left'}</span>}</div>}
      {!s.waiting && <div className="gx-bar"><i style={{ width: `${pct}%` }} /></div>}
    </div>
  )
}

// Everything for one customer, in one sheet: the bill so far, how it was paid, and the actions.
function SessionSheet({ system, seat, s, now, onClose, onAction, onPause, onStart, onCancel }) {
  const left = minutesLeft(s, now)
  const bill = sessionTotal(s), paid = sessionPaid(s), due = Math.max(0, bill - paid)
  const how = [Number(s.paid_cash) && 'cash', Number(s.paid_online) && 'online', Number(s.paid_deposit || 0) && 'deposit'].filter(Boolean).join(' + ')
  return (
    <ActionSheet title={`${s.customer_name}${s.players > 1 ? ` · ${s.players} players` : ''}`}
      sub={`${whereOf(system, seat)} · ${s.waiting ? `waiting · ${durLabel(s.minutes)}` : `${inOut(s)}${s.paused_at ? ' · paused' : left > 0 ? ` · ${durLabel(left)} left` : ' · time up'}`}`}
      onClose={onClose}
      primary={s.waiting ? <button type="button" className="btn primary" onClick={onStart}>▶ Start timer</button> : <button type="button" className="btn primary" onClick={() => onAction('end')}>End &amp; collect</button>}>
      <div className="gx-skpis">
        <div><span>Bill</span><b>{rs(bill)}</b></div>
        <div><span>Paid{how ? ` · ${how}` : ''}</span><b className={paid ? 'pos' : ''}>{rs(paid)}</b></div>
        <div><span>To collect</span><b className={due ? 'neg' : ''}>{rs(due)}</b></div>
      </div>
      <ActionGrid items={[
        { label: '+ F&B', icon: <CupIcon />, onClick: () => onAction('fnb') },
        { label: 'Extend', icon: <ClockPlusIcon />, onClick: () => onAction('extend') },
        { label: 'Move', icon: <MoveIcon />, onClick: () => onAction('move') },
        !s.waiting && { label: s.paused_at ? 'Resume' : 'Pause', icon: s.paused_at ? <PlayIcon /> : <PauseIcon />, onClick: () => onPause(!s.paused_at) },
        { label: `Code ${shortCode(s.id)}`, icon: <QrIcon />, onClick: () => onAction('timer') },
        s.customer_phone && { label: 'Call', icon: <PhoneIcon />, href: `tel:${s.customer_phone}` },
        s.waiting && { label: 'Cancel entry', icon: <XIcon />, onClick: onCancel, danger: true },
      ]} />
      <div className="muted small">{s.entered_by ? `Taken by ${s.entered_by}` : ''}{Number(s.fnb_before) + Number(s.fnb_while) ? ` · F&B ${rs(Number(s.fnb_before) + Number(s.fnb_while))}` : ''}</div>
    </ActionSheet>
  )
}

// PS5 controllers: who has each one, and Out of order / Back in use (staff and admin).
function ControllersSheet({ systems, holders, off, onSet, onClose }) {
  return (
    <ActionSheet title="Controllers" sub="Mark a broken controller out of order; it's left out of Start and online booking." onClose={onClose}>
      {systems.map((sys) => {
        const h = holders(sys)
        return (
          <div key={sys.id} className="gx-ctl-list">
            {systems.length > 1 && <div className="caps muted">{sys.name}</div>}
            {Array.from({ length: sys.seats || 1 }, (_, i) => i + 1).map((n) => {
              const s = h.get(n)
              return (
                <div key={n} className="line">
                  <span className="gx-badge sm ps">C{n}</span>
                  <div className="grow">{off(sys, n) ? <span className="neg">Out of order</span> : s ? <>In use · {s.customer_name}</> : <span className="pos">Free</span>}</div>
                  {off(sys, n) ? <button type="button" className="btn small" onClick={() => onSet(sys, n, false)}>Back in use</button>
                    : !s && <button type="button" className="btn small ghost" onClick={() => onSet(sys, n, true)}>Out of order</button>}
                </div>
              )
            })}
          </div>
        )
      })}
    </ActionSheet>
  )
}

const FNB = [[0, 'None'], [10, '₹10'], [20, '₹20'], [30, '₹30'], [40, '₹40'], [60, '₹60']]

// Start one PC, or one or more PS5 controllers together (each controller = one customer, one timer, priced
// per head). A booking's amount is split across its controllers as already paid online.
function StartSheet({ system: first, seats, freeOf, systems, booking, dues, rates, settings, happy, householdId, onClose, onDone }) {
  const now = useNow(30_000)
  // Owner: "booked PC2 but sat at PC4" — any free system of the same kind can be picked here.
  const [system, setSystem] = useState(first)
  const free = freeOf(system)
  const others = systems.filter((x) => x.kind === first.kind && freeOf(x).length > 0)
  const [picked, setPicked] = useState(seats || [free[0]])
  const [cashPart, setCashPart] = useState('')
  const [name, setName] = useState(booking?.customer_name || '')
  const [phone, setPhone] = useState(booking?.customer_phone || '')
  const [mins, setMins] = useState(booking?.minutes || 60)
  const [fnb, setFnb] = useState(0)
  const [fnbOther, setFnbOther] = useState('') // owner: type any F&B amount, not only the chips
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

  // later = the owner's "details first": the entry holds the PC, its clock starts from the row's ▶ Start timer.
  async function save(later = false) {
    setBusy(true); setError(null)
    const t0 = new Date().toISOString()
    const split = (v) => Math.round((v / count) * 100) / 100
    // Cash + online (owner: "₹80 bill, 50 cash and 30 online"): the cash part is shared across the timers.
    const cashShare = pay === 'split' && total > 0 ? Math.min(Number(cashPart) || 0, total) / total : 0
    const rows = picked.map((seat, i) => {
      const g = bookedSame ? split(Number(booking.amount)) : each
      const f = i === 0 ? fnb : 0
      const c = Math.round((g + f) * cashShare)
      return {
        household_id: householdId, system_id: system.id, system_name: system.name, seat,
        customer_name: (name.trim() || 'Walk-in') + (count > 1 ? ` (${i + 1}/${count})` : ''), customer_phone: phone.trim() || null,
        base_minutes: mins, minutes: mins, gaming_amount: g, fnb_before: f, players: 1, happy, booking_id: booking?.id || null,
        paid_cash: pay === 'cash' ? g + f : pay === 'split' ? c : 0,
        paid_online: pay === 'online' ? g + f : pay === 'split' ? g + f - c : pay === 'booked' ? split(Number(booking.amount)) : 0,
        ...(later ? { waiting: true, paused_at: t0 } : {}),
      }
    })
    const { data: created, error } = await supabase.from('shop_sessions').insert(rows).select('id')
    setBusy(false)
    if (error) { setError(error.code === '23505' ? (multi ? `Another controller on ${system.name} can’t start until the database update for controllers is approved. Start one at a time for now.` : `${system.name} is already running.`) : error.message); return }
    if (booking) await supabase.from('shop_bookings').update({ status: 'arrived', session_id: created[0].id }).eq('id', booking.id)
    const where = `${system.name}${multi ? ` · controller${count > 1 ? 's' : ''} ${picked.join(', ')}` : ''}`
    onDone(later ? `${where} saved for ${name.trim() || 'walk-in'} · press ▶ Start timer when they sit down`
      : `${where} started for ${name.trim() || 'walk-in'} · ends ${timeLabel(new Date(Date.now() + mins * 60_000))}`)
  }

  return (
    <Sheet title={`${system.name} · new customer`} sub={`${durLabel(mins)}${happy ? ' · happy hours' : ''} · save now, start the clock when they sit down`} onClose={onClose} onSubmit={() => save(true)}>
      {error && <div className="alert error">{error}</div>}
      {others.length > 1 && (<>
        <div className="caps muted">{first.kind === 'PS' ? 'Console' : 'PC'} · where they sit</div>
        <Chips scroll options={others.map((x) => [x.id, x.name])} value={system.id} onChange={(id) => { const x = others.find((o) => o.id === id); setSystem(x); setPicked(freeOf(x).slice(0, Math.max(1, picked.length))) }} />
      </>)}
      {multi && (<>
        <div className="caps muted">Controllers · one customer each, charged per head</div>
        <div className="chips">{free.map((n) => <button type="button" key={n} className={`chip chip-btn ${picked.includes(n) ? 'on' : ''}`} onClick={() => toggle(n)}>🎮 {n}</button>)}</div>
      </>)}
      <CustomerFields householdId={householdId} name={name} setName={setName} phone={phone} setPhone={setPhone} />
      {owes && <div className="alert error" style={{ margin: 0 }}>{owes.name} owes {rs(owes.total)} from before · collect it in Cash → Customer dues</div>}
      <div className="caps muted">Time</div>
      <Chips scroll options={DURATIONS.map((m) => [m, durLabel(m)])} value={mins} onChange={setMins} />
      <div className="caps muted">F&amp;B before gaming</div>
      <Chips scroll options={FNB} value={fnbOther ? null : fnb} onChange={(v) => { setFnb(v); setFnbOther('') }} />
      <input className="gx-other" inputMode="numeric" value={fnbOther} placeholder="Other amount ₹"
        onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 5); setFnbOther(v); setFnb(Number(v) || 0) }} />
      <div className="caps muted">Payment</div>
      {booking && !online && Number(booking.paid) > 0 && <div className="small muted">{rs(booking.paid)} advance was taken when booking — it's offered at the end as {booking.customer_name}’s deposit.</div>}
      <Chips options={[...(online ? [['booked', `Paid online · ${rs(booking.amount)}`]] : []), ['end', 'At the end'], ['cash', 'Paid now · cash'], ['online', 'Paid now · online'], ['split', 'Cash + online']]} value={pay} onChange={setPay} />
      {pay === 'split' && <label>Cash part<input inputMode="numeric" value={cashPart} onChange={(e) => setCashPart(e.target.value.replace(/\D/g, ''))} placeholder={`of ${rs(total)} — rest is online`} /></label>}
      {(pay === 'online' || pay === 'split') && <UpiQrButton settings={settings} amount={pay === 'split' ? Math.max(0, total - (Number(cashPart) || 0)) : total} note={`${system.name} · ${name.trim() || 'Walk-in'}`} />}
      <div className="gx-box">
        <SumRow label={`Gaming · ${durLabel(mins)}${count > 1 ? ` × ${count}` : ''}${happy ? ' · happy hours' : ''}`} value={rs(gaming)} />
        {fnb > 0 && <SumRow label="F&B" value={rs(fnb)} />}
        <SumRow strong label={pay === 'end' ? 'Total so far' : pay === 'booked' ? 'Paid when booking' : 'Paid now'} value={rs(pay === 'booked' ? Number(booking.amount) : total)} />
        {pay === 'split' && <SumRow label={`Cash ${rs(Math.min(Number(cashPart) || 0, total))} · online`} value={rs(Math.max(0, total - (Number(cashPart) || 0)))} />}
      </div>
      {/* Owner: several customers at once — save each entry first, start the clock when they sit down. */}
      <div className="actions gx-start-actions">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save · start later'}</button>
        <button type="button" className="btn gx-ok" disabled={busy} onClick={() => save(false)}>{count > 1 ? `Start ${count} now` : 'Start now'}</button>
      </div>
    </Sheet>
  )
}

// Pay for an add-on now or at the end (owner, 13 Oct: "customer paid online but it showed ₹50 to collect").
const PAY_NOW = [['end', 'With the bill at the end'], ['cash', 'Paid now · cash'], ['online', 'Paid now · online']]
const paidPatch = (session, pay, value) => pay === 'cash' ? { paid_cash: Number(session.paid_cash) + value }
  : pay === 'online' ? { paid_online: Number(session.paid_online) + value } : {}
const payNote = (pay) => pay === 'cash' ? ' · paid cash' : pay === 'online' ? ' · paid online' : ' · to collect at the end'

function FnbSheet({ session, settings, onClose, onDone }) {
  const [amt, setAmt] = useState(20)
  const [custom, setCustom] = useState('')
  const [pay, setPay] = useState('end')
  const [busy, setBusy] = useState(false)
  const value = custom ? Number(custom) : amt
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').update({ fnb_while: Number(session.fnb_while) + value, ...paidPatch(session, pay, value) }).eq('id', session.id)
    setBusy(false)
    if (error) { onDone(error.message); return }
    onDone(`${rs(value)} F&B added to ${session.system_name}${payNote(pay)}`)
  }
  return (
    <Sheet title={`F&B · ${session.system_name}`} sub={`${session.customer_name} · added to the bill`} onClose={onClose} onSubmit={save}>
      <Chips scroll options={FNB.slice(1)} value={custom ? null : amt} onChange={(v) => { setAmt(v); setCustom('') }} />
      <label>Other amount<input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} placeholder="₹" /></label>
      <div className="caps muted">Payment</div>
      <Chips options={PAY_NOW} value={pay} onChange={setPay} />
      {pay === 'online' && value > 0 && <UpiQrButton settings={settings} amount={value} note={`${session.system_name} F&B · ${session.customer_name}`} />}
      <SheetActions onClose={onClose} busy={busy} disabled={!(value > 0)} label={`Add ${rs(value || 0)}`} />
    </Sheet>
  )
}

// Owner (13 Oct): each extension is charged on its own from the rate card — +30 min is ₹50 every time
// (before, the 2nd +30 min came to ₹30 because it was "2 h price − 1 h 30 m price").
function ExtendSheet({ system, session, rates, settings, onClose, onDone }) {
  const [add, setAdd] = useState(30)
  const [pay, setPay] = useState('end')
  const [busy, setBusy] = useState(false)
  const minutes = session.minutes + add
  const extra = priceFor(rates, system.kind, add, session.happy) * (session.players || 1)
  const newEnd = sessionEnd({ ...session, minutes })
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').update({ minutes, extend_amount: Number(session.extend_amount) + extra, ...paidPatch(session, pay, extra) }).eq('id', session.id)
    setBusy(false)
    if (error) { onDone(error.message); return }
    onDone(`${session.system_name} now ends ${timeLabel(newEnd)} · +${rs(extra)}${payNote(pay)}`)
  }
  return (
    <Sheet title={`Extend ${session.system_name}`} sub={`${session.customer_name} · now ends ${timeLabel(sessionEnd(session))}`} onClose={onClose} onSubmit={save}>
      <Chips options={[[30, '+30 min'], [60, '+1 hr'], [90, '+1h 30m'], [120, '+2 hr'], [180, '+3 hr'], [240, '+4 hr']]} value={add} onChange={setAdd} />
      <div className="gx-box">
        <SumRow label="New end" value={timeLabel(newEnd)} />
        <SumRow strong label="Extend amount" value={`+${rs(extra)}`} />
      </div>
      <div className="caps muted">Payment</div>
      <Chips options={PAY_NOW} value={pay} onChange={setPay} />
      {pay === 'online' && <UpiQrButton settings={settings} amount={extra} note={`${session.system_name} extend · ${session.customer_name}`} />}
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
function Bookings({ systems = [], bookings = [], eventChecks = [], entryChecks = [], onArrived, onChanged }) {
  const dialog = useDialog()
  const [open, setOpen] = useState(null)
  const [all, setAll] = useState(false)
  async function update(table, row, patch, msg, ask) {
    if (ask && !await dialog.confirm(ask)) return
    const { error } = await supabase.from(table).update(patch).eq('id', row.id)
    setOpen(null)
    onChanged(error ? error.message : msg)
  }
  const notPaid = (name) => ({ title: `Payment not received from ${name}?`, message: 'This cancels the request and frees the time.', confirmLabel: 'Not received · cancel', cancelLabel: 'Keep', danger: true })
  const day = (d) => { const x = new Date(d), t = new Date(); return x.toDateString() === t.toDateString() ? 'Today' : x.toDateString() === new Date(t.getTime() + 86_400_000).toDateString() ? 'Tomorrow' : x.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) }
  const until = (b) => timeLabel(new Date(b.starts_at).getTime() + b.minutes * 60_000)

  // Slot bookings, event advances and tournament entries as one list: each row has one main action
  // (Received / Arrived / Confirm); the rest (details, call, not received, cancel) is in its sheet.
  const items = [
    ...entryChecks.map((x) => ({
      id: x.id, badge: '🏆', cls: 'ev', name: `${x.name} · ${x.rank}`, sub: `${x.shop_events?.name}${Number(x.fee) ? ` · ${rs(x.fee)}` : ''}`, phone: x.phone, check: true,
      pill: Number(x.fee) ? 'Payment?' : 'New entry',
      details: [['Event', x.shop_events?.name], ['Entry fee', Number(x.fee) ? rs(x.fee) : 'not set yet'], ['UPI ref', x.upi_ref], ['Mobile', x.phone]],
      main: { label: Number(x.fee) ? 'Received' : 'Confirm', run: () => update('shop_entries', x, { status: 'confirmed' }, `${x.name} is in`) },
      other: { label: Number(x.fee) ? 'Not received' : 'Remove', run: () => update('shop_entries', x, { status: 'cancelled' }, 'Entry cancelled', Number(x.fee) ? notPaid(x.name) : { title: `Remove ${x.name}’s entry?`, confirmLabel: 'Remove', danger: true }) },
    })),
    ...eventChecks.map((b) => ({
      id: b.id, badge: 'EV', cls: 'ev', name: `${b.customer_name}${b.players > 1 ? ` · ${b.players}` : ''}`, sub: `${b.shop_events?.name} · ${day(b.slot_start)} ${timeLabel(b.slot_start)}`, phone: b.customer_phone, check: true,
      pill: 'Payment?',
      details: [['Event', b.shop_events?.name], ['When', `${day(b.slot_start)} ${timeLabel(b.slot_start)}`], ['Advance', `${rs(b.advance_paid)} of ${rs(b.amount)}`], ['UPI ref', b.upi_ref], ['Mobile', b.customer_phone]],
      main: { label: 'Received', run: () => update('shop_event_bookings', b, { payment_ok: true }, 'Advance received · slot confirmed') },
      other: { label: 'Not received', run: () => update('shop_event_bookings', b, { status: 'cancelled' }, 'Booking cancelled', notPaid(b.customer_name)) },
    })),
    ...bookings.map((b) => {
      const pc = systems.find((x) => x.id === b.system_id)?.name
      const req = b.status === 'requested'
      return {
        id: b.id, badge: b.kind === 'PS' ? 'PS5' : pc || 'PC', cls: b.kind === 'PS' ? 'ps' : '', name: `${b.customer_name}${b.players > 1 ? ` · ${b.players} players` : ''}`,
        sub: `${day(b.starts_at)} ${timeLabel(b.starts_at)} – ${until(b)}`, phone: b.customer_phone, check: req,
        pill: req ? 'Payment?' : b.source === 'counter' ? 'Booked' : 'Paid',
        details: [
          ['When', `${day(b.starts_at)} ${timeLabel(b.starts_at)} – ${until(b)}`], ['Where', b.kind === 'PS' ? 'PS5' : pc || 'Any PC'], ['Amount', rs(b.amount)],
          ['Payment', b.source === 'counter' ? (Number(b.paid) > 0 ? `${rs(b.paid)} advance · ${b.paid_mode}` : 'at the counter') : req ? 'online · to check' : 'paid online'],
          ['UPI ref', b.upi_ref], ['Mobile', b.customer_phone], ['Booked by', b.source === 'counter' ? b.entered_by || 'staff' : 'online'], ['Checked by', b.handled_by], ['Note', b.note], ['Code', shortCode(b.id)]],
        main: req ? { label: 'Received', run: () => update('shop_bookings', b, { status: 'confirmed' }, 'Payment received · booking confirmed') }
          : { label: 'Arrived', run: () => { setOpen(null); onArrived(b) } },
        other: req ? { label: 'Not received', run: () => update('shop_bookings', b, { status: 'cancelled' }, 'Booking cancelled', notPaid(b.customer_name)) }
          : { label: 'Cancel booking', run: () => update('shop_bookings', b, { status: 'cancelled' }, 'Booking cancelled', { title: `Cancel ${b.customer_name}’s booking?`, message: b.source === 'counter' ? (Number(b.paid) > 0 ? `The time opens up. The ${rs(b.paid)} advance stays as their deposit.` : 'The time opens up for others.') : 'The time opens up for others. The online payment is non-refundable.', confirmLabel: 'Cancel booking', cancelLabel: 'Keep', danger: true }) },
      }
    }),
  ]
  if (!items.length) return null
  const toCheck = items.filter((x) => x.check).length
  const shown = all ? items : items.slice(0, 4)
  return (
    <div className="card gx-bookings">
      <div className="card-head"><h3>Bookings <span className="muted">{items.length}</span></h3>{toCheck > 0 && <span className="pill gx-pill ending">{toCheck} to check</span>}</div>
      {shown.map((x) => (
        <div key={x.id} className="gx-brow" role="button" tabIndex={0} onClick={() => setOpen(x)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(x) }}>
          <span className={`gx-badge sm ${x.cls}`}>{x.badge}</span>
          <div className="gx-run-main">
            <div className="gx-name">{x.name}</div>
            <div className="muted small">{x.sub}</div>
          </div>
          <button type="button" className={`btn small ${x.check ? 'primary' : ''}`} onClick={(e) => { e.stopPropagation(); x.main.run() }}>{x.main.label}</button>
        </div>
      ))}
      {items.length > 4 && <button type="button" className="btn link small" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${items.length}`}</button>}
      {open && (
        <ActionSheet title={open.name} sub={open.sub} onClose={() => setOpen(null)}
          primary={<button type="button" className="btn primary" onClick={open.main.run}>{open.main.label}</button>}>
          <div className="gx-details">{open.details.filter(([, v]) => v).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
          <ActionGrid items={[
            open.phone && { label: 'Call', icon: <PhoneIcon />, href: `tel:${open.phone}` },
            { label: open.other.label, icon: <XIcon />, onClick: open.other.run, danger: true },
          ]} />
        </ActionSheet>
      )}
    </div>
  )
}

// Owner: staff book a customer who calls (Slots → + Book): PC or PS5, day, time, how long, players, name and
// mobile, then an advance (cash / online, kept as the customer's deposit and used at the end) or pay at the
// counter. Free systems come from public_availability (the same count online booking uses).
const ymdLocal = (d) => d.toLocaleDateString('en-CA')
function BookSheet({ shop, householdId, initial, onClose, onDone }) {
  const [kind, setKind] = useState(initial?.kind || 'PC')
  const [day, setDay] = useState(() => initial?.day || ymdLocal(new Date()))
  const [time, setTime] = useState(initial?.time || null)
  const keepTime = useRef(!!initial?.time)
  // Owner: "some come at 10:15" — any start time can be typed instead of the half-hour chips.
  const [custom, setCustom] = useState('')
  const [mins, setMins] = useState(60)
  const [players, setPlayers] = useState(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [system, setSystem] = useState(null) // owner: a specific PC (PC1…PC5), or any
  const [pay, setPay] = useState('counter')
  const [adv, setAdv] = useState('')
  const [avail, setAvail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    setAvail(null)
    if (keepTime.current) keepTime.current = false; else setTime(null)
    supabase.rpc('public_availability', { p_day: day }).then(({ data, error }) => { if (error) setError(error.message); else setAvail(data || []) })
  }, [day])
  const happy = (shop.settings?.happy_days || [3, 4, 5]).includes(new Date(`${day}T00:00`).getDay())
  const amount = priceFor(shop.rates, kind, mins, happy) * players
  const ps = shop.systems.filter((x) => x.kind === 'PS')
  const maxPlayers = kind === 'PS' ? Math.max(1, ps.reduce((a, x) => a + (x.seats || 1) - (x.off_seats || []).length, 0)) : 1
  const fits = (t) => {
    // every half hour the booking touches must have room (a 10:15 start checks 10:00, 10:30, …)
    const start = new Date(t).getTime(), end = start + mins * 60_000
    const rows = (avail || []).filter((a) => { const x = new Date(a.t).getTime(); return x < end && x + 30 * 60_000 > start })
    if (!rows.length || rows.length < Math.ceil((end - Math.floor(start / 1800_000) * 1800_000) / 1800_000)) return false
    return rows.every((a) => a[kind] >= players) && start > Date.now() - 10 * 60_000
  }
  const pickCustom = (v) => {
    setCustom(v)
    if (!/^\d{2}:\d{2}$/.test(v)) return
    const t = new Date(`${day}T${v}`)
    if (t.getHours() < 6) t.setDate(t.getDate() + 1) // after midnight belongs to this shop day
    setTime(t.toISOString())
  }
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d })
  async function save() {
    const digits = phone.replace(/\D/g, '').slice(-10)
    if (digits.length !== 10) { setError('Enter a 10-digit mobile number.'); return }
    const paid = pay === 'counter' ? 0 : Number(adv) || 0
    setBusy(true); setError(null)
    const { error } = await supabase.from('shop_bookings').insert({
      household_id: householdId, kind, starts_at: time, minutes: mins, players, customer_name: name.trim(), customer_phone: digits, system_id: kind === 'PC' ? system : null,
      amount, status: 'confirmed', source: 'counter', paid, paid_mode: paid ? pay : null, note: note.trim() || null,
    })
    if (!error && paid) {
      // The advance is money in today (drawer / Cashbook) and becomes their deposit, used when they play.
      await supabase.from('shop_deposits').insert({ household_id: householdId, customer_name: name.trim(), customer_phone: digits, kind: 'add', amount: paid, mode: pay })
    }
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${name.trim()} booked${system && kind === 'PC' ? ` · ${shop.systems.find((x) => x.id === system)?.name}` : ''} · ${new Date(time).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })} ${timeLabel(time)}`)
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
        <div className="book-slots">{slots.map((a) => <button key={a.t} type="button" disabled={!fits(a.t)} className={`book-slot ${time === a.t && !custom ? 'on' : ''}`} onClick={() => { setCustom(''); setTime(a.t) }}>{timeLabel(a.t)}</button>)}</div>
      )}
      <label>Or type a time<input type="time" step="300" value={custom} onChange={(e) => pickCustom(e.target.value)} /></label>
      {custom && time && !fits(time) && <div className="alert error" style={{ margin: 0 }}>Not free for the whole {durLabel(mins)} from {timeLabel(time)}{players > 1 ? ` for ${players} players` : ''} — you can still book it.</div>}
      <PcPicker kind={kind} start={time} minutes={mins} value={system} onChange={setSystem} />
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

// Owner: "booked PC2 but sat at PC4 — need to change it". Moves a running session (time, bill and code kept)
// to a free PC, or a free controller on the PS5.
// Owner: a customer who didn't save their code — staff open it from the session row: the code in big letters,
// a QR the customer scans to open their timer, open it on this device, copy the link or send it on WhatsApp.
function TimerCodeSheet({ session, onClose }) {
  const code = shortCode(session.id)
  const link = `${location.origin}/#timer/${code}`
  const digits = (session.customer_phone || '').replace(/\D/g, '')
  const wa = `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(`Your GRANDXGAMER timer: ${link} (code ${code})`)}`
  const [copied, setCopied] = useState(false)
  return (
    <Sheet title={`Timer · ${session.customer_name}`} sub={`${session.system_name}${(session.seat || 1) > 1 && session.system_name?.startsWith('PS') ? ` · controller ${session.seat}` : ''} · type this code on the timer screen, or scan`} onClose={onClose}>
      <div className="gx-timercode mono">{code}</div>
      <div className="gx-timerqr" dangerouslySetInnerHTML={{ __html: qrSvg(link) }} />
      <div className="gx-btns">
        <a className="btn" href={link} target="_blank" rel="noreferrer">Open timer here</a>
        <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        {digits.length >= 10 && <a className="btn" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
      </div>
      <div className="actions"><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
    </Sheet>
  )
}

function MoveSheet({ session, systems, freeOf, onClose, onDone }) {
  const kind = systems.find((x) => x.id === session.system_id)?.kind || (session.system_name.startsWith('PS') ? 'PS' : 'PC')
  const targets = systems.filter((x) => x.kind === kind).flatMap((x) => freeOf(x).map((seat) => ({ sys: x, seat, key: `${x.id}:${seat}`, label: (x.seats || 1) > 1 ? `${x.name} · 🎮${seat}` : x.name })))
  const [to, setTo] = useState(targets[0]?.key || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    const t = targets.find((x) => x.key === to)
    if (!t) return
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').update({ system_id: t.sys.id, system_name: t.sys.name, seat: t.seat }).eq('id', session.id)
    setBusy(false)
    if (error) { setError(error.code === '23505' ? 'That one just got taken. Pick another.' : error.message); return }
    onDone(`${session.customer_name} moved to ${t.label}`)
  }
  return (
    <Sheet title={`Move ${session.customer_name}`} sub={`Now on ${session.system_name}${(session.seat || 1) > 1 ? ` · 🎮${session.seat}` : ''}. Time, bill and code stay the same.`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      {targets.length === 0 ? <div className="muted small">Nothing free to move to right now.</div> : <Chips options={targets.map((t) => [t.key, t.label])} value={to} onChange={setTo} />}
      <SheetActions onClose={onClose} busy={busy} disabled={!to} label="Move" />
    </Sheet>
  )
}

// Slots → Calendar (owner: "a calendar like Events — see tomorrow's bookings, and book from here"). One row per
// hour of the shop's day: how many PCs / PS5 controllers are free (public_availability, the same count online
// booking uses) and every booking in that hour (online and counter), with Book on free hours.
function SlotCalendar({ shop, onBook, onArrived, toast }) {
  const dialog = useDialog()
  // Owner (13 Oct): staff and admin cancel a booking from the Calendar too (✕), same rules as the Bookings card.
  async function cancel(b) {
    const msg = b.status === 'requested' ? 'This cancels the request and frees the time.'
      : b.source === 'counter' ? (Number(b.paid) > 0 ? `The time opens up. The ${rs(b.paid)} advance stays as their deposit this month.` : 'The time opens up for others.')
      : 'The time opens up for others. The online payment is non-refundable.'
    if (!await dialog.confirm({ title: `Cancel ${b.customer_name}’s booking?`, message: msg, confirmLabel: 'Cancel booking', cancelLabel: 'Keep', danger: true })) return
    const { error } = await supabase.from('shop_bookings').update({ status: 'cancelled' }).eq('id', b.id)
    toast?.(error ? error.message : 'Booking cancelled'); if (!error) shop.reload()
  }
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d })
  const [day, setDay] = useState(() => ymdLocal(new Date()))
  const [kind, setKind] = useState('PC')
  const [avail, setAvail] = useState(null)
  const [list, setList] = useState([])
  const [hoursVersion, setHoursVersion] = useState(0)
  const version = (shop.bookings || []).map((b) => `${b.id}${b.status}`).join() + shop.sessions.length + ':' + hoursVersion
  useEffect(() => {
    let live = true
    const from = new Date(`${day}T00:00`), to = new Date(from); to.setDate(to.getDate() + 1); to.setHours(6)
    Promise.all([
      supabase.rpc('public_availability', { p_day: day }),
      supabase.from('shop_bookings').select('*').eq('household_id', shop.systems[0]?.household_id).in('status', ['requested', 'confirmed', 'arrived'])
        .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at'),
    ]).then(([a, b]) => { if (live) { setAvail(a.data || []); setList(b.data || []) } })
    return () => { live = false }
  }, [day, version, shop.systems])
  const total = shop.systems.filter((x) => x.kind === kind).reduce((a, x) => a + (x.seats || 1) - (x.off_seats || []).filter((n) => n <= (x.seats || 1)).length, 0)
  // hour rows from the half-hour availability
  const hours = []
  for (let i = 0; i < (avail || []).length; i += 2) {
    const a = avail[i], b = avail[i + 1]
    const t0 = new Date(a.t).getTime(), t1 = t0 + 60 * 60_000
    hours.push({
      t: a.t, end: t1, free: Math.min(a[kind], b ? b[kind] : a[kind]), freeFirstHalf: a[kind],
      past: t1 <= Date.now(),
      bookings: list.filter((x) => x.kind === kind && new Date(x.starts_at).getTime() < t1 && new Date(x.starts_at).getTime() + x.minutes * 60_000 > t0),
    })
  }
  const label = (d, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }))
  const mine = list.filter((x) => x.kind === kind)
  const count = mine.length
  const [showPast, setShowPast] = useState(false)
  const [openB, setOpenB] = useState(null)
  return (
    <div className="gx-cal">
      <Chips scroll options={days.map((d, i) => [ymdLocal(d), label(d, i)])} value={day} onChange={setDay} />
      <DayHours day={day} shop={shop} onChanged={() => setHoursVersion((v) => v + 1)} />
      <Chips options={[['PC', 'PC'], ['PS', 'PS5']]} value={kind} onChange={setKind} />
      {!avail ? <div className="card muted small">Loading…</div> : hours.length === 0 ? <div className="card muted small">Closed this day. Use Hours above to open it.</div> : (<>
        <div className="card gx-freecard">
          <div className="card-head"><h3>{kind === 'PS' ? 'PS5' : 'PC'} hours</h3><span className="muted small">Tap a free hour to book</span></div>
          <div className="gx-freegrid">
            {hours.filter((h) => showPast || !h.past).map((h) => (
              <button key={h.t} type="button" className={`gx-freetile ${kind === 'PS' ? 'ps' : ''}`} disabled={h.past || h.freeFirstHalf <= 0} onClick={() => onBook({ kind, day, time: h.t })}>
                <b>{timeLabel(h.t)}</b><span>{h.past ? 'Past' : h.free <= 0 ? 'Full' : `${h.free} of ${total} free`}{h.bookings.length ? ` · ${h.bookings.length} booked` : ''}</span>
              </button>
            ))}
          </div>
          {hours.some((h) => h.past) && <button type="button" className="btn link small" style={{ justifySelf: 'start', padding: 0 }} onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide past hours' : `Show ${hours.filter((h) => h.past).length} past hours`}</button>}
        </div>
        <div className="card gx-bookings">
          <div className="card-head"><h3>Booked <span className="muted">{count}</span></h3></div>
          {mine.length === 0 ? <div className="muted small">No {kind === 'PS' ? 'PS5' : 'PC'} bookings this day.</div> : mine.map((b) => {
            const today = new Date(b.starts_at).toDateString() === new Date().toDateString()
            return (
              <div key={b.id} className="gx-brow" role="button" tabIndex={0} onClick={() => setOpenB(b)}>
                <span className={`gx-badge sm ${kind === 'PS' ? 'ps' : ''}`}>{kind === 'PS' ? 'PS5' : shop.systems.find((x) => x.id === b.system_id)?.name || 'PC'}</span>
                <div className="gx-run-main">
                  <div className="gx-name">{b.customer_name}{b.players > 1 ? <span className="muted"> · {b.players}</span> : ''}</div>
                  <div className="muted small">{timeLabel(b.starts_at)} – {timeLabel(new Date(b.starts_at).getTime() + b.minutes * 60_000)}{b.status === 'requested' ? <span className="gx-due"> · check payment</span> : ''}</div>
                </div>
                {b.status === 'arrived' ? <span className="pill gx-pill free">Arrived</span>
                  : b.status === 'confirmed' && today ? <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); onArrived(b) }}>Arrived</button>
                  : <span className="pill gx-pill">{b.source === 'online' ? 'Online' : 'Counter'}</span>}
              </div>
            )
          })}
        </div>
      </>)}
      {openB && (
        <ActionSheet title={openB.customer_name} sub={`${timeLabel(openB.starts_at)} – ${timeLabel(new Date(openB.starts_at).getTime() + openB.minutes * 60_000)}${openB.players > 1 ? ` · ${openB.players} players` : ''}`} onClose={() => setOpenB(null)}>
          <div className="gx-details">
            {[['Where', openB.kind === 'PS' ? 'PS5' : shop.systems.find((x) => x.id === openB.system_id)?.name || 'Any PC'], ['Amount', rs(openB.amount)],
              ['Payment', openB.source === 'counter' ? (Number(openB.paid) > 0 ? `${rs(openB.paid)} advance · ${openB.paid_mode}` : 'at the counter') : openB.status === 'requested' ? 'online · to check' : 'paid online'],
              ['Mobile', openB.customer_phone], ['Booked by', openB.source === 'online' ? 'online' : openB.entered_by || 'staff'], ['Note', openB.note], ['Code', shortCode(openB.id)]]
              .filter(([, v]) => v).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
          </div>
          <ActionGrid items={[
            openB.customer_phone && { label: 'Call', icon: <PhoneIcon />, href: `tel:${openB.customer_phone}` },
            openB.status !== 'arrived' && { label: 'Cancel booking', icon: <XIcon />, onClick: () => { const b = openB; setOpenB(null); cancel(b) }, danger: true },
          ]} />
        </ActionSheet>
      )}
    </div>
  )
}

// Owner: "no fixed open / close — some days we start at 11 or 12". Hours for one date (shop_day_hours) override
// the usual ones from ⚙ → Online booking; online booking and the calendar follow them.
function DayHours({ day, shop, onChanged }) {
  const dialog = useDialog()
  const [row, setRow] = useState(undefined)
  const [edit, setEdit] = useState(false)
  const st = shop.settings || {}
  const hh = shop.systems[0]?.household_id
  useEffect(() => {
    let live = true
    setRow(undefined); setEdit(false)
    supabase.from('shop_day_hours').select('*').eq('household_id', hh).eq('day', day).maybeSingle().then(({ data }) => { if (live) setRow(data || null) })
    return () => { live = false }
  }, [day, hh])
  const open = (row?.open_time || st.open_time || '10:00').slice(0, 5)
  const close = (row?.close_time || st.close_time || '23:00').slice(0, 5)
  const [o, setO] = useState(open), [c, setC] = useState(close)
  useEffect(() => { setO(open); setC(close) }, [open, close])
  const t = (x) => timeLabel(`2000-01-01T${x}`)
  async function save(patch) {
    const { error } = await supabase.from('shop_day_hours').upsert({ household_id: hh, day, open_time: o, close_time: c, closed: false, ...patch, updated_at: new Date().toISOString() })
    if (error) { dialog.alert(error.message); return }
    setEdit(false); setRow({ day, open_time: o, close_time: c, closed: false, ...patch }); onChanged()
  }
  async function reset() {
    const { error } = await supabase.from('shop_day_hours').delete().eq('household_id', hh).eq('day', day)
    if (error) { dialog.alert(error.message); return }
    setRow(null); setEdit(false); onChanged()
  }
  if (row === undefined) return null
  return (
    <div className="card gx-dayhours">
      {!edit ? (
        <div className="gx-sys-top">
          <div className="grow">
            <div className="gx-name">{row?.closed ? 'Closed this day' : `Open ${t(open)} – ${t(close)}`}</div>
            <div className="muted small">{row ? `Set for this day${row.entered_by ? ` by ${row.entered_by}` : ''}` : 'Usual hours'}</div>
          </div>
          <button className="btn small" onClick={() => setEdit(true)}>Hours</button>
        </div>
      ) : (
        <div className="stack">
          <div className="grid2">
            <label>Opens<input type="time" value={o} onChange={(e) => setO(e.target.value)} /></label>
            <label>Closes<input type="time" value={c} onChange={(e) => setC(e.target.value)} /></label>
          </div>
          <div className="gx-btns">
            <button className="btn small primary" onClick={() => save({})}>Save for this day</button>
            <button className="btn small" onClick={() => save({ closed: true })}>Closed this day</button>
            {row && <button className="btn small ghost" onClick={reset}>Usual hours</button>}
            <button className="btn small ghost" onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
