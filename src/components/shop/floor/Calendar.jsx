import { useEffect, useState } from 'react'
import { useDialog } from '../../../lib/dialog'
import { supabase } from '../../../lib/supabase'
import { rs, shortCode, timeLabel } from '../../../lib/shop'
import { ActionGrid, ActionSheet, Chips } from '../ui'
import { ClockPlusIcon, PhoneIcon, XIcon } from '../../../lib/icons'
import { timeHistory, ymdLocal } from './common'
import { ChangeTimeSheet } from './Bookings'

// Slots → Calendar (owner: "a calendar like Events — see tomorrow's bookings, and book from here"). One row per
// hour of the shop's day: how many PCs / PS5 controllers are free (public_availability, the same count online
// booking uses) and every booking in that hour (online and counter), with Book on free hours.
export function SlotCalendar({ shop, onBook, onArrived, toast }) {
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
  const [moveB, setMoveB] = useState(null)
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
              ...timeHistory(openB), ['Mobile', openB.customer_phone], ['Booked by', openB.source === 'online' ? 'online' : openB.entered_by || 'staff'], ['Note', openB.note], ['Code', shortCode(openB.id)]]
              .filter(([, v]) => v).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
          </div>
          <ActionGrid items={[
            openB.customer_phone && { label: 'Call', icon: <PhoneIcon />, href: `tel:${openB.customer_phone}` },
            openB.status === 'confirmed' && { label: 'Not arrived · change time', icon: <ClockPlusIcon />, onClick: () => { setMoveB(openB); setOpenB(null) } },
            openB.status !== 'arrived' && { label: 'Cancel booking', icon: <XIcon />, onClick: () => { const b = openB; setOpenB(null); cancel(b) }, danger: true },
          ]} />
        </ActionSheet>
      )}
      {moveB && <ChangeTimeSheet booking={moveB} onClose={() => setMoveB(null)} onDone={(m) => { setMoveB(null); toast?.(m); shop.reload() }} />}
    </div>
  )
}

// Owner: "no fixed open / close — some days we start at 11 or 12". Hours for one date (shop_day_hours) override
// the usual ones from ⚙ → Online booking; online booking and the calendar follow them.
export function DayHours({ day, shop, onChanged }) {
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
