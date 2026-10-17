import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../../../lib/dialog'
import { supabase } from '../../../lib/supabase'
import PcPicker from '../../PcPicker'
import { DURATIONS, durLabel, priceFor, rs, shortCode, timeLabel } from '../../../lib/shop'
import { ActionGrid, ActionSheet, Chips, Sheet, SheetActions, SumRow } from '../ui'
import { ClockPlusIcon, PhoneIcon, XIcon } from '../../../lib/icons'
import { UpiQrButton } from '../UpiQr'
import CustomerFields from '../CustomerFields'
import { timeHistory, whenLabel, ymdLocal } from './common'

// Owner, 16 Oct: "booked customers sometimes don't come on time — others are waiting, we give them the system".
// Not arrived · change time: move the booking to a new day / time (same length); the first time is kept.
export function ChangeTimeSheet({ booking: b, onClose, onDone }) {
  const d0 = new Date(b.starts_at)
  const [date, setDate] = useState(d0.toLocaleDateString('en-CA'))
  const [time, setTime] = useState(`${String(d0.getHours()).padStart(2, '0')}:${String(d0.getMinutes()).padStart(2, '0')}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    const to = new Date(`${date}T${time}`)
    if (Number.isNaN(to.getTime())) { setError('Pick a date and time.'); return }
    if (to.getTime() === d0.getTime()) { onClose(); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const by = user?.user_metadata?.username ? user.user_metadata.username.replace(/^./, (c) => c.toUpperCase()) : null
    const { error } = await supabase.from('shop_bookings').update({
      starts_at: to.toISOString(), first_starts_at: b.first_starts_at || b.starts_at,
      time_changes: [...(b.time_changes || []), { from: b.starts_at, to: to.toISOString(), at: new Date().toISOString(), by }],
    }).eq('id', b.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${b.customer_name}'s booking moved to ${whenLabel(to)} · first booked ${whenLabel(b.first_starts_at || b.starts_at)}`)
  }
  return (
    <Sheet title={`Change time · ${b.customer_name}`} sub={`Booked ${whenLabel(b.starts_at)} · ${durLabel(b.minutes)}${b.first_starts_at ? ` · first booked ${whenLabel(b.first_starts_at)}` : ''}`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <div className="grid2">
        <label>Day<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>New start time<input type="time" autoFocus value={time} onChange={(e) => setTime(e.target.value)} /></label>
      </div>
      <div className="small muted">The system is free for others meanwhile. The first booked time stays in the booking's history.</div>
      <SheetActions onClose={onClose} busy={busy} label="Change time" />
    </Sheet>
  )
}

// Online money to check, on every phone (admin and staff): slot bookings from /#book, event advances and
// tournament entry fees from the home page. Staff open their UPI app, then tap Received — or Not received,
// which cancels the request. "Arrived" on a confirmed slot booking starts its session, already paid.
export function Bookings({ systems = [], bookings = [], eventChecks = [], entryChecks = [], onArrived, onChanged }) {
  const dialog = useDialog()
  const [open, setOpen] = useState(null)
  const [move, setMove] = useState(null) // a booking whose customer didn't come on time → new time
  const [all, setAll] = useState(false)
  async function update(table, row, patch, msg, ask) {
    if (ask && !await dialog.confirm(ask)) return
    // A group booked online (one UPI payment for everyone): Received / Not received applies to all of them.
    const { error } = table === 'shop_bookings' && row.group_id && row.status === 'requested'
      ? await supabase.from(table).update(patch).eq('group_id', row.group_id).eq('status', 'requested')
      : await supabase.from(table).update(patch).eq('id', row.id)
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
      const group = b.group_id ? bookings.filter((x) => x.group_id === b.group_id) : []
      return {
        raw: b, id: b.id, badge: b.kind === 'PS' ? 'PS5' : pc || 'PC', cls: b.kind === 'PS' ? 'ps' : '', name: `${b.customer_name}${b.players > 1 ? ` · ${b.players} players` : ''}`,
        sub: `${day(b.starts_at)} ${timeLabel(b.starts_at)} – ${until(b)}${b.first_starts_at ? ` · moved from ${timeLabel(b.first_starts_at)}` : ''}${group.length > 1 ? ` · group of ${group.length}` : ''}`, phone: b.customer_phone, check: req,
        pill: req ? 'Payment?' : b.source === 'counter' ? 'Booked' : 'Paid',
        details: [
          ['When', `${day(b.starts_at)} ${timeLabel(b.starts_at)} – ${until(b)}`], ['Where', b.kind === 'PS' ? 'PS5' : pc || 'Any PC'], ['Amount', rs(b.amount)],
          ['Payment', b.source === 'counter' ? (Number(b.paid) > 0 ? `${rs(b.paid)} advance · ${b.paid_mode}` : 'at the counter') : req ? 'online · to check' : 'paid online'],
          ['Group', group.length > 1 ? `${group.length} people · ${group.map((x) => x.customer_name).join(', ')}${req ? ' · one payment for all' : ''}` : null],
          ...timeHistory(b), ['UPI ref', b.upi_ref], ['Mobile', b.customer_phone], ['Booked by', b.source === 'counter' ? b.entered_by || 'staff' : 'online'], ['Checked by', b.handled_by], ['Note', b.note], ['Code', shortCode(b.id)]],
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
            open.raw?.status === 'confirmed' && { label: 'Not arrived · change time', icon: <ClockPlusIcon />, onClick: () => { setMove(open.raw); setOpen(null) } },
            { label: open.other.label, icon: <XIcon />, onClick: open.other.run, danger: true },
          ]} />
        </ActionSheet>
      )}
      {move && <ChangeTimeSheet booking={move} onClose={() => setMove(null)} onDone={(m) => { setMove(null); onChanged(m) }} />}
    </div>
  )
}

// Owner: staff book a customer who calls (Slots → + Book): PC or PS5, day, time, how long, players, name and
// mobile, then an advance (cash / online, kept as the customer's deposit and used at the end) or pay at the
// counter. Free systems come from public_availability (the same count online booking uses).
export function BookSheet({ shop, householdId, initial, onClose, onDone }) {
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
    // One call: the booking and its advance (kept as the customer's deposit, money in today) — rpc shop_book_counter.
    const { error } = await supabase.rpc('shop_book_counter', {
      p_booking: { household_id: householdId, kind, starts_at: time, minutes: mins, players, customer_name: name.trim(), customer_phone: digits, system_id: kind === 'PC' ? system || null : null, amount, note: note.trim() || null },
      p_advance: paid, p_mode: paid ? pay : null,
    })
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
