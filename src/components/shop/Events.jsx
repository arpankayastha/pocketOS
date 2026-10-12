import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useDialog } from '../../lib/dialog'
import { RANKS, durLabel, eventImage, timeLabel, rs } from '../../lib/shop'
import { Chips, Sheet, SheetActions, SumRow } from './ui'
import { UpiQrButton } from './UpiQr'
import { useSwipe } from '../../lib/useSwipe'
import { uploadShopImage } from '../../lib/media'

// Events with bookable slots — GTA VI launch now, anything later. Everything about an event (dates,
// hours, slot length, how many per slot, price, advance) is set here by the admin; staff book slots
// for walk-ins and phone calls; customers book from the home page (advance by UPI, checked on the Floor).
// Tournaments (Valorant) take entries instead: name, mobile, rank, entry fee.

const ymd = (d) => d.toLocaleDateString('en-CA')
function eventDays(ev) {
  const out = []
  if (!ev.starts_on || !ev.ends_on) return out
  for (let d = new Date(`${ev.starts_on}T00:00`); ymd(d) <= ev.ends_on; d.setDate(d.getDate() + 1)) out.push(ymd(d))
  return out
}
function daySlots(ev, day) {
  const [oh, om] = ev.open_time.split(':').map(Number)
  const [ch, cm] = ev.close_time.split(':').map(Number)
  const start = new Date(`${day}T00:00`); start.setHours(oh, om)
  const end = new Date(`${day}T00:00`); end.setHours(ch, cm)
  if (end <= start) end.setDate(end.getDate() + 1) // closes after midnight
  const out = []
  for (let t = start.getTime(); t + ev.slot_minutes * 60_000 <= end.getTime(); t += ev.slot_minutes * 60_000) out.push(new Date(t))
  return out
}
// Owner's pricing: first hour at the event price, each later hour at the normal price (GTA VI: ₹200 then
// ₹100/hr), per head. Older events without first/next prices charge `price` per slot.
const firstPrice = (ev) => Number(ev.first_hour_price ?? ev.price) || 0
const nextPrice = (ev) => Number(ev.next_hour_price ?? ev.price) || 0
const eventPrice = (ev, hours, players = 1) => (firstPrice(ev) + Math.max(0, hours - 1) * nextPrice(ev)) * players
const covers = (ev, b, t) => { const s0 = new Date(b.slot_start).getTime(); return t >= s0 && t < s0 + (b.hours || 1) * ev.slot_minutes * 60_000 }
const dayChip = (day) => !day ? 'Date TBA' : new Date(`${day}T00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

export default function Events({ householdId, admin, settings, toast }) {
  const dialog = useDialog()
  const [events, setEvents] = useState(null)
  const [eventId, setEventId] = useState(null)
  const [day, setDay] = useState(null)
  const [bookings, setBookings] = useState([])
  const [sheet, setSheet] = useState(null)
  const [error, setError] = useState(null)

  const loadEvents = useCallback(async () => {
    const { data, error } = await supabase.from('shop_events').select('*').eq('household_id', householdId).order('starts_on', { nullsFirst: false }).order('created_at')
    if (error) { setError(error.message); return }
    setEvents(data)
    setEventId((cur) => (data.some((e) => e.id === cur) ? cur : (data.find((e) => e.active && (!e.ends_on || e.ends_on >= ymd(new Date()))) || data[0])?.id || null))
  }, [householdId])
  useEffect(() => { loadEvents() }, [loadEvents])

  const ev = events?.find((e) => e.id === eventId)
  const loadBookings = useCallback(async () => {
    if (!eventId || events?.find((e) => e.id === eventId)?.format === 'tournament') return
    const { data, error } = await supabase.from('shop_event_bookings').select('*').eq('event_id', eventId).neq('status', 'cancelled').order('slot_start')
    if (error) setError(error.message); else setBookings(data)
  }, [eventId, events])
  useEffect(() => { loadBookings() }, [loadBookings])
  useEffect(() => {
    if (!ev) return
    const days = eventDays(ev), today = ymd(new Date())
    setDay((cur) => (days.includes(cur) ? cur : days.find((d) => d >= today) || days[0]))
  }, [ev])

  const allDays = ev ? eventDays(ev) : []
  const di = allDays.indexOf(day)
  const daySwipe = useSwipe({
    ignore: '.gx-scroll',
    onLeft: () => { if (di >= 0 && di < allDays.length - 1) setDay(allDays[di + 1]) },
    onRight: () => { if (di > 0) setDay(allDays[di - 1]) },
  })
  if (events === null) return <div className="card muted small">Loading…</div>

  const slots = ev && day ? daySlots(ev, day) : []
  const totalSlots = ev ? eventDays(ev).reduce((a, d) => a + daySlots(ev, d).length * ev.capacity, 0) : 0
  const advance = bookings.reduce((a, b) => a + Number(b.advance_paid), 0)
  const done = (msg) => { setSheet(null); toast(msg); loadBookings(); loadEvents() }

  async function setStatus(b, status) {
    if (status === 'cancelled' && !await dialog.confirm({ title: `Cancel ${b.customer_name}’s booking?`, message: Number(b.advance_paid) ? `The ${rs(b.advance_paid)} advance is non-refundable. The hours open up for someone else.` : 'The hours open up for someone else.', confirmLabel: 'Cancel booking', cancelLabel: 'Keep', danger: true })) return
    const { error } = await supabase.from('shop_event_bookings').update({ status }).eq('id', b.id)
    if (error) toast(error.message); else { toast(status === 'arrived' ? `${b.customer_name} arrived` : 'Booking cancelled'); loadBookings() }
  }

  return (
    <section className="gx-split side-first">
      <div className="gx-col">
      {error && <div className="alert error">{error}</div>}
      {events.length > 1 && <Chips scroll options={events.map((e) => [e.id, e.name + (e.active ? '' : ' (off)')])} value={eventId} onChange={setEventId} />}
      {!ev ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No events yet.{admin ? ' Add one for a game launch or a tournament day.' : ''}</p></div>
      ) : ev.format === 'tournament' ? (<>
        <TournamentHead ev={ev} admin={admin} onEdit={() => setSheet({ kind: 'event', event: ev })} />
        {admin && <button className="btn block gx-new-event" style={{ order: 9 }} onClick={() => setSheet({ kind: 'event', event: null })}>+ New event</button>}
      </>) : (<>
        <div className="card gx-event">
          <div className="card-head">
            <span className={`pill gx-pill ${ev.system_kind === 'PS' ? 'ps' : ''}`}>{ev.system_kind === 'PS' ? 'PS5' : 'PC'} · {dayChip(ev.starts_on)} – {dayChip(ev.ends_on)}</span>
            {admin && <button className="btn small ghost" onClick={() => setSheet({ kind: 'event', event: ev })}>Edit</button>}
          </div>
          {eventImage(ev) && <img className="gx-event-img" src={eventImage(ev)} alt="" />}
          <div className="gx-event-name">{ev.name}</div>
          {ev.description && <div className="small">{ev.description}</div>}
          <div className="muted small">{rs(firstPrice(ev))} first {durLabel(ev.slot_minutes)} · {rs(nextPrice(ev))} each extra · up to {ev.max_hours || 1} · per head · {rs(ev.advance)} advance, non-refundable · {ev.capacity} at a time{ev.active ? '' : ' · switched off'}</div>
          <div className="gx-kpis" style={{ marginTop: 12 }}>
            <div className="gx-kpi"><b>{bookings.length} / {totalSlots}</b><span>Slots booked</span></div>
            <div className="gx-kpi"><b>{rs(advance)}</b><span>Advance taken</span></div>
          </div>
        </div>
        {admin && <button className="btn block gx-new-event" style={{ order: 9 }} onClick={() => setSheet({ kind: 'event', event: null })}>+ New event</button>}
      </>)}
      </div>
      <div className="gx-col">
      {ev?.format === 'tournament' && <Entries ev={ev} settings={settings} householdId={householdId} toast={toast} />}
      {ev && ev.format !== 'tournament' && (<>
        <Chips scroll options={eventDays(ev).map((d) => [d, dayChip(d)])} value={day} onChange={setDay} />
        <div className="gx-slots gx-dateswipe" {...daySwipe}>
          {slots.map((t) => {
            const here = bookings.filter((b) => covers(ev, b, t.getTime()))
            const full = here.length >= ev.capacity
            return (
              <div key={t.toISOString()} className={`card gx-slot ${full ? 'full' : ''}`}>
                <div className="gx-sys-top">
                  <div className="grow">
                    <div className="gx-name">{timeLabel(t)} – {timeLabel(t.getTime() + ev.slot_minutes * 60_000)}</div>
                    <div className="muted small">{full ? 'Full' : `${ev.capacity - here.length} of ${ev.capacity} free`}</div>
                  </div>
                  {!full && ev.active && <button className="btn small primary" onClick={() => setSheet({ kind: 'book', slot: t })}>Book</button>}
                </div>
                {here.map((b) => (
                  <div key={b.id} className="line">
                    <div className="grow">
                      <div>{b.customer_name}{b.players > 1 ? ` +${b.players - 1}` : ''} {b.status === 'arrived' && <span className="pill gx-pill free">Arrived</span>}{!b.payment_ok && <span className="pill gx-pill ending">Check payment</span>}</div>
                      <div className="muted small">{timeLabel(b.slot_start)} – {timeLabel(new Date(b.slot_start).getTime() + (b.hours || 1) * ev.slot_minutes * 60_000)} · {b.customer_phone || 'No mobile'} · {Number(b.advance_paid) ? `${rs(b.advance_paid)} ${b.advance_mode}` : 'No advance'} · {b.source === 'online' ? 'online' : `by ${b.entered_by || '—'}`}{b.handled_by ? ` · ✓ ${b.handled_by}` : ''}</div>
                    </div>
                    {!b.payment_ok && <button className="btn small primary" onClick={async () => { const { error } = await supabase.from('shop_event_bookings').update({ payment_ok: true }).eq('id', b.id); toast(error ? error.message : 'Advance received'); loadBookings() }}>Received</button>}
                    {b.payment_ok && b.status !== 'arrived' && <button className="btn small" onClick={() => setStatus(b, 'arrived')}>Arrived</button>}
                    <button className="btn small ghost" aria-label="Cancel booking" onClick={() => setStatus(b, 'cancelled')}>✕</button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </>)}
      {!ev && admin && <button className="btn block" onClick={() => setSheet({ kind: 'event', event: null })}>+ New event</button>}
      </div>
      {sheet?.kind === 'book' && <BookSheet ev={ev} slot={sheet.slot} settings={settings} householdId={householdId} onClose={() => setSheet(null)} onDone={done}
        freeHours={(() => { // how many hours in a row are free from this slot, up to the event's max
          let n = 0
          for (const t of slots.filter((x) => x >= sheet.slot)) {
            if (n >= (ev.max_hours || 1) || bookings.filter((b) => covers(ev, b, t.getTime())).length >= ev.capacity) break
            if (t.getTime() !== sheet.slot.getTime() + n * ev.slot_minutes * 60_000) break
            n++
          }
          return Math.max(1, n)
        })()} />}
      {sheet?.kind === 'event' && <EventSheet event={sheet.event} householdId={householdId} onClose={() => setSheet(null)}
        onDone={(msg, id) => { if (id) setEventId(id); done(msg) }} />}
    </section>
  )
}

function BookSheet({ ev, slot, freeHours, settings, householdId, onClose, onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [players, setPlayers] = useState(1)
  const [hours, setHours] = useState(1)
  const total = eventPrice(ev, hours, players)
  const end = slot.getTime() + hours * ev.slot_minutes * 60_000
  const [mode, setMode] = useState(Number(ev.advance) ? 'online' : 'none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true); setError(null)
    const { error } = await supabase.from('shop_event_bookings').insert({
      household_id: householdId, event_id: ev.id, slot_start: slot.toISOString(),
      customer_name: name.trim(), customer_phone: phone.trim() || null, players, hours, amount: total,
      advance_paid: mode === 'none' ? 0 : ev.advance, advance_mode: mode === 'none' ? null : mode,
    })
    setBusy(false)
    if (error) { setError(/full/i.test(error.message) ? 'Someone just took this slot.' : error.message); return }
    onDone(`${name.trim()} booked for ${timeLabel(slot)}`)
  }
  return (
    <Sheet title={`Book · ${ev.name}`} sub={`${dayChip(ymd(slot))} · ${timeLabel(slot)} – ${timeLabel(end)}`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <div className="grid2">
        <label>Customer<input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" /></label>
        <label>Mobile<input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))} inputMode="tel" placeholder="For reminders" /></label>
      </div>
      <div className="caps muted">How long</div>
      <Chips options={Array.from({ length: freeHours }, (_, i) => [i + 1, durLabel((i + 1) * ev.slot_minutes)])} value={hours} onChange={setHours} />
      <div className="caps muted">Players · charged per head</div>
      <Chips options={Array.from({ length: ev.system_kind === 'PS' ? 3 : 1 }, (_, i) => [i + 1, String(i + 1)])} value={players} onChange={setPlayers} />
      <div className="caps muted">Advance {rs(ev.advance)} · non-refundable once paid</div>
      <Chips options={[['online', 'Online / scanner'], ['cash', 'Cash'], ['none', 'Not paid yet']]} value={mode} onChange={setMode} />
      {mode === 'online' && <UpiQrButton settings={settings} amount={Number(ev.advance)} note={`${ev.name} advance · ${name.trim() || 'customer'}`} />}
      <div className="gx-box">
        <SumRow label={`First ${durLabel(ev.slot_minutes)}${players > 1 ? ` × ${players}` : ''}`} value={rs(firstPrice(ev) * players)} />
        {hours > 1 && <SumRow label={`${hours - 1} more × ${rs(nextPrice(ev))}${players > 1 ? ` × ${players}` : ''}`} value={rs((hours - 1) * nextPrice(ev) * players)} />}
        <SumRow label="Advance now" value={`−${rs(mode === 'none' ? 0 : ev.advance)}`} />
        <SumRow strong label="At the counter" value={rs(total - (mode === 'none' ? 0 : Number(ev.advance)))} />
      </div>
      <SheetActions onClose={onClose} busy={busy} disabled={!name.trim()} label={`Book ${durLabel(hours * ev.slot_minutes)}`} />
    </Sheet>
  )
}

function EventSheet({ event, householdId, onClose, onDone }) {
  const today = ymd(new Date())
  const [f, setF] = useState(() => event ? { ...event, open_time: event.open_time.slice(0, 5), close_time: event.close_time.slice(0, 5), starts_on: event.starts_on || '', ends_on: event.ends_on || '' }
    : { format: 'slots', name: '', system_kind: 'PS', starts_on: today, ends_on: today, open_time: '10:00', close_time: '22:00', slot_minutes: 60, capacity: 1, first_hour_price: 200, next_hour_price: 100, max_hours: 3, advance: 100, active: true, description: '', image_url: null, entry_fee: '', max_entries: '' })
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e })
  const tour = f.format === 'tournament'
  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true); setError(null)
    try { setF((x) => ({ ...x, image_url: null })); const url = await uploadShopImage(householdId, file, 'event'); setF((x) => ({ ...x, image_url: url })) } catch (err) { setError(err.message) }
    setUploading(false)
  }
  async function save() {
    if (!tour && (!f.starts_on || !f.ends_on)) { setError('Pick the first and last day.'); return }
    if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) { setError('The last day is before the first day.'); return }
    setBusy(true); setError(null)
    const common = { name: f.name.trim(), format: f.format, system_kind: f.system_kind, open_time: f.open_time, close_time: f.close_time, active: f.active,
      description: (f.description || '').trim() || null, image_url: f.image_url || null }
    const row = tour
      ? { ...common, starts_on: f.starts_on || null, ends_on: f.starts_on || null, entry_fee: f.entry_fee === '' || f.entry_fee === null ? null : Number(f.entry_fee),
          max_entries: Number(f.max_entries) || null, max_hours: 1, advance: 0 }
      : { ...common, starts_on: f.starts_on, ends_on: f.ends_on,
          slot_minutes: Number(f.slot_minutes), capacity: Number(f.capacity) || 1, advance: Number(f.advance) || 0,
          first_hour_price: Number(f.first_hour_price ?? f.price) || 0, next_hour_price: Number(f.next_hour_price ?? f.price) || 0,
          price: Number(f.first_hour_price ?? f.price) || 0, max_hours: Number(f.max_hours) || 1 }
    const res = event ? await supabase.from('shop_events').update(row).eq('id', event.id).select().single()
      : await supabase.from('shop_events').insert({ ...row, household_id: householdId }).select().single()
    setBusy(false)
    if (res.error) { setError(res.error.message); return }
    onDone(event ? 'Event saved' : `${row.name} added`, res.data.id)
  }
  return (
    <Sheet title={event ? 'Edit event' : 'New event'} sub={tour ? 'Customers enter from the home page: name, mobile, rank and the entry fee by UPI.' : 'Slots are made from these settings. Existing bookings keep their times.'} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      {!event && <Chips options={[['slots', 'Slot booking'], ['tournament', 'Tournament']]} value={f.format} onChange={set('format')} />}
      <label>Name<input required value={f.name} onChange={set('name')} placeholder={tour ? 'e.g. Valorant Tournament' : 'e.g. GTA VI launch'} /></label>
      <label>About it (home page)<textarea rows={2} value={f.description || ''} onChange={set('description')} placeholder={tour ? 'Format, prizes, rules' : 'What customers get'} /></label>
      <div className="caps muted">Picture (home page)</div>
      {f.image_url && <img className="gx-hero-preview" src={f.image_url} alt="" />}
      <div className="gx-btns">
        <label className={`btn small ${uploading ? 'disabled' : ''}`}>{uploading ? 'Uploading…' : f.image_url ? 'Change picture' : 'Add picture'}<input type="file" accept="image/*" hidden onChange={pick} disabled={uploading} /></label>
        {f.image_url && <button type="button" className="btn small ghost" onClick={() => setF({ ...f, image_url: null })}>Remove</button>}
      </div>
      <div className="caps muted">On</div>
      <Chips options={[['PS', 'PS5'], ['PC', 'PC']]} value={f.system_kind} onChange={set('system_kind')} />
      {tour ? (
        <div className="grid2">
          <label>Date (empty = coming soon)<input type="date" value={f.starts_on || ''} onChange={set('starts_on')} /></label>
          <label>Starts at<input type="time" required value={f.open_time} onChange={set('open_time')} /></label>
          <label>Entry fee (₹, empty = TBA)<input inputMode="numeric" value={f.entry_fee ?? ''} onChange={(e) => setF({ ...f, entry_fee: e.target.value.replace(/\D/g, '') })} /></label>
          <label>Most entries (empty = no limit)<input inputMode="numeric" value={f.max_entries ?? ''} onChange={(e) => setF({ ...f, max_entries: e.target.value.replace(/\D/g, '') })} /></label>
          <label>Entries<select value={f.active ? 'on' : 'off'} onChange={(e) => setF({ ...f, active: e.target.value === 'on' })}><option value="on">Open · on home page</option><option value="off">Closed · hidden</option></select></label>
        </div>
      ) : (<>
        <div className="grid2">
          <label>First day<input type="date" required value={f.starts_on} onChange={set('starts_on')} /></label>
          <label>Last day<input type="date" required value={f.ends_on} onChange={set('ends_on')} /></label>
          <label>Opens<input type="time" required value={f.open_time} onChange={set('open_time')} /></label>
          <label>Closes<input type="time" required value={f.close_time} onChange={set('close_time')} /></label>
        </div>
        <div className="caps muted">Slot length</div>
        <Chips options={[[60, '1 hr'], [30, '30 min'], [120, '2 hr']]} value={Number(f.slot_minutes)} onChange={set('slot_minutes')} />
        <div className="grid2">
          <label>First slot, per head (₹)<input inputMode="numeric" value={f.first_hour_price ?? f.price ?? ''} onChange={set('first_hour_price')} /></label>
          <label>Each extra slot (₹)<input inputMode="numeric" value={f.next_hour_price ?? f.price ?? ''} onChange={set('next_hour_price')} /></label>
          <label>Most slots per booking<input inputMode="numeric" value={f.max_hours ?? 1} onChange={set('max_hours')} /></label>
          <label>Systems at a time<input inputMode="numeric" value={f.capacity} onChange={set('capacity')} /></label>
          <label>Advance, non-refundable (₹)<input inputMode="numeric" value={f.advance} onChange={set('advance')} /></label>
          <label>Bookings<select value={f.active ? 'on' : 'off'} onChange={(e) => setF({ ...f, active: e.target.value === 'on' })}><option value="on">Open · on home page</option><option value="off">Closed · hidden</option></select></label>
        </div>
      </>)}
      <SheetActions onClose={onClose} busy={busy || uploading} disabled={!f.name.trim()} label={event ? 'Save' : 'Add event'} />
    </Sheet>
  )
}

// Tournament (Valorant): entries come from the home page (fee by UPI, checked on the Floor or here) or the counter.
function TournamentHead({ ev, admin, onEdit }) {
  return (
    <div className="card gx-event">
      <div className="card-head">
        <span className="pill gx-pill">🏆 Tournament · {ev.system_kind === 'PS' ? 'PS5' : 'PC'} · {ev.starts_on ? `${dayChip(ev.starts_on)} ${timeLabel(`${ev.starts_on}T${ev.open_time}`)}` : 'date coming soon'}</span>
        {admin && <button className="btn small ghost" onClick={onEdit}>Edit</button>}
      </div>
      {ev.image_url && <img className="gx-event-img" src={ev.image_url} alt="" />}
      <div className="gx-event-name">{ev.name}</div>
      {ev.description && <div className="small">{ev.description}</div>}
      <div className="muted small">{ev.entry_fee === null ? 'Entry fee not set yet' : `Entry fee ${rs(ev.entry_fee)}`}{ev.max_entries ? ` · up to ${ev.max_entries} players` : ''}{ev.active ? ' · entries open' : ' · entries closed'}</div>
    </div>
  )
}

function Entries({ ev, settings, householdId, toast }) {
  const dialog = useDialog()
  const [rows, setRows] = useState(null)
  const [adding, setAdding] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('shop_entries').select('*').eq('event_id', ev.id).neq('status', 'cancelled').order('created_at')
    if (error) toast(error.message); else setRows(data)
  }, [ev.id, toast])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = supabase.channel(`entries:${ev.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'shop_entries', filter: `event_id=eq.${ev.id}` }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [ev.id, load])
  async function set(x, status) {
    if (status === 'cancelled' && !await dialog.confirm({ title: `Remove ${x.name}?`, message: Number(x.fee) ? 'The entry fee is non-refundable.' : 'Their place opens up.', confirmLabel: 'Remove', danger: true })) return
    const { error } = await supabase.from('shop_entries').update({ status }).eq('id', x.id)
    toast(error ? error.message : status === 'confirmed' ? `${x.name} is in` : 'Entry removed'); load()
  }
  const fees = (rows || []).filter((x) => x.status === 'confirmed').reduce((a, x) => a + Number(x.fee), 0)
  return (<>
    <div className="gx-kpis">
      <div className="gx-kpi"><b>{rows?.length ?? '…'}{ev.max_entries ? ` / ${ev.max_entries}` : ''}</b><span>Entries</span></div>
      <div className="gx-kpi"><b>{rs(fees)}</b><span>Fees received</span></div>
    </div>
    <div className="card">
      <div className="card-head"><h3>Players</h3>{ev.active && <button className="btn small primary" onClick={() => setAdding(true)}>+ Add entry</button>}</div>
      {rows === null ? <div className="muted small">Loading…</div> : rows.length === 0 ? <div className="muted small">No entries yet. Customers enter from the home page.</div> : rows.map((x, i) => (
        <div key={x.id} className="line">
          <span className="gx-badge sm">{i + 1}</span>
          <div className="grow">
            <div>{x.name} · <b>{x.rank}</b> {x.status === 'requested' && <span className="pill gx-pill ending">{Number(x.fee) ? 'Check payment' : 'New'}</span>}</div>
            <div className="muted small"><a href={`tel:${x.phone}`}>{x.phone}</a> · {Number(x.fee) ? rs(x.fee) : 'no fee yet'}{x.upi_ref ? ` · ref ${x.upi_ref}` : ''} · {x.source === 'online' ? 'online' : `by ${x.entered_by || '—'}`}{x.handled_by ? ` · ✓ ${x.handled_by}` : ''}</div>
          </div>
          {x.status === 'requested' && <button className="btn small primary" onClick={() => set(x, 'confirmed')}>{Number(x.fee) ? 'Received' : 'Confirm'}</button>}
          <button className="btn small ghost" aria-label="Remove entry" onClick={() => set(x, 'cancelled')}>✕</button>
        </div>
      ))}
    </div>
    {adding && <EntrySheet ev={ev} settings={settings} householdId={householdId} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); toast(m); load() }} />}
  </>)
}

function EntrySheet({ ev, settings, householdId, onClose, onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [rank, setRank] = useState(null)
  const [mode, setMode] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fee = Number(ev.entry_fee) || 0
  async function save() {
    const digits = phone.replace(/\D/g, '').slice(-10)
    if (digits.length !== 10) { setError('Enter a 10-digit mobile number.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('shop_entries').insert({ household_id: householdId, event_id: ev.id, name: name.trim(), phone: digits, rank, fee, status: 'confirmed', source: 'counter', upi_ref: fee ? mode : null })
    setBusy(false)
    if (error) { setError(error.code === '23505' ? 'This mobile number is already entered.' : error.message); return }
    onDone(`${name.trim()} entered`)
  }
  return (
    <Sheet title={`Entry · ${ev.name}`} sub={fee ? `Entry fee ${rs(fee)}, non-refundable` : 'Entry fee not set yet'} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <div className="grid2">
        <label>Name<input autoFocus required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Mobile<input required value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))} inputMode="tel" /></label>
      </div>
      <div className="caps muted">Rank</div>
      <Chips options={RANKS.map((r) => [r, r])} value={rank} onChange={setRank} />
      {fee > 0 && (<>
        <div className="caps muted">Fee paid by</div>
        <Chips options={[['cash', 'Cash'], ['online', 'Online / scanner']]} value={mode} onChange={setMode} />
        {mode === 'online' && <UpiQrButton settings={settings} amount={fee} note={`${ev.name} entry · ${name.trim() || 'player'}`} />}
      </>)}
      <SheetActions onClose={onClose} busy={busy} disabled={!name.trim() || !rank} label="Add entry" />
    </Sheet>
  )
}
