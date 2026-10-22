import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../../lib/dialog'
import { supabase } from '../../lib/supabase'
import { isHappyDay, minutesLeft, rs, sessionEnd, timeLabel, useNow } from '../../lib/shop'
import { Chips } from './ui'
import { alarm, scheduleAlarm, speak } from '../../lib/alarm'
import { ControllersSheet, MoveSheet, RunRow, SessionSheet, TimerCodeSheet } from './floor/SessionRows'
import { StartSheet } from './floor/StartSheet'
import { CollectSheet, EndSheet, ExtendSheet, FnbSheet } from './floor/PaySheets'
import { Bookings, BookSheet } from './floor/Bookings'
import { SlotCalendar } from './floor/Calendar'

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
              <button key={t.sys.id} type="button" className={`gx-freetile ${t.sys.kind === 'PS' ? 'ps' : ''}`} onClick={() => setSheet({ kind: 'start', system: t.sys, seats: t.seats.slice(0, 1) })}>
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
      {sheet?.kind === 'session' && <SessionSheet system={sheet.system} seat={sheet.seat} s={sheet.session} now={now} bank={(shop.paymentsIn || []).filter((x) => x.match_kind === 'session' && x.match_id === sheet.session.id)} bankOn={(shop.paymentsIn || []).length > 0} onClose={close}
        onAction={(kind) => setSheet({ ...sheet, kind })} onPause={(on) => pause([sheet.session], on)} onStart={() => startWaiting(sheet.session)} onCancel={() => cancelWaiting(sheet.session)} />}
      {sheet?.kind === 'controllers' && <ControllersSheet systems={multi} holders={holders} off={off} onSet={setOff} onClose={close} />}
      {sheet?.kind === 'start' && <StartSheet system={sheet.system} seats={sheet.seats} freeOf={freeSeats} systems={shop.systems} booking={sheet.booking} dues={shop.dues} deposits={shop.deposits} rates={shop.rates} settings={shop.settings} happy={isHappyDay(shop.settings)} householdId={householdId} onClose={close} onDone={done} />}
      {sheet?.kind === 'book' && <BookSheet shop={shop} householdId={householdId} initial={sheet.initial} onClose={close} onDone={done} />}
      {sheet?.kind === 'collect' && <CollectSheet session={sheet.session} settings={shop.settings} onClose={close} onDone={done} />}
      {sheet?.kind === 'fnb' && <FnbSheet session={sheet.session} settings={shop.settings} deposits={shop.deposits} householdId={householdId} onClose={close} onDone={done} />}
      {sheet?.kind === 'timer' && <TimerCodeSheet session={sheet.session} onClose={close} />}
      {sheet?.kind === 'move' && <MoveSheet session={sheet.session} systems={shop.systems} freeOf={freeSeats} onClose={close} onDone={done} />}
      {sheet?.kind === 'extend' && <ExtendSheet system={sheet.system} session={sheet.session} rates={shop.rates} settings={shop.settings} deposits={shop.deposits} householdId={householdId} onClose={close} onDone={done} />}
      {sheet?.kind === 'end' && <EndSheet session={sheet.session} settings={shop.settings} deposits={shop.deposits} householdId={householdId} onClose={close} onDone={done} />}
    </section>
  )
}

// Owner: "alarm when time ends". Every phone with Slots open beeps (and buzzes) when a session reaches
// 5 minutes left and again when its time is up; a phone notification too if alerts are allowed.
export function useTimeUpAlarm(running, now, onAlert) {
  const fired = useRef(new Set())
  // Owner, 22 Oct: no sound when an extended time ran out. The beeps are now booked ahead on the audio clock
  // for each session's end (like the #timer screen), so a throttled background tab still rings on time, and
  // re-booked whenever the end moves (Extend / pause / resume). Keys carry the end time, so a new end rings again.
  const booked = useRef(new Map()) // key → cancel
  const keyOf = (s, mark) => `${s.id}:${sessionEnd(s).getTime()}:${mark}`
  useEffect(() => {
    const want = new Set()
    for (const s of running) {
      if (s.paused_at || s.waiting) continue
      for (const mark of [5, 0]) {
        const key = keyOf(s, mark), at = sessionEnd(s).getTime() - mark * 60_000
        if (at <= Date.now() || fired.current.has(key)) continue
        want.add(key)
        if (!booked.current.has(key)) booked.current.set(key, scheduleAlarm(at, mark === 0 ? 10 : 5))
      }
    }
    for (const [key, cancel] of booked.current) if (!want.has(key) && !fired.current.has(key)) { cancel(); booked.current.delete(key) }
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const cancel of booked.current.values()) cancel() }, [])
  useEffect(() => {
    for (const s of running) {
      if (s.paused_at || s.waiting) continue
      const left = minutesLeft(s, now)
      for (const [mark, msg] of [[5, '5 minutes left'], [0, 'time is up']]) {
        const key = keyOf(s, mark)
        if (left <= mark && left > mark - 3 && !fired.current.has(key)) {
          fired.current.add(key)
          if (!booked.current.has(key)) alarm(mark === 0 ? 10 : 5) // seconds: 5 at 5 min left, 10 at time up
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
