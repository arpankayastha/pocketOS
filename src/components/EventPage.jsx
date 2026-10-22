import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { RANKS, eventImage, durLabel, rs, timeLabel } from '../lib/shop'
import { qrSvg, upiLink } from '../lib/upi'
import { isCustomer, readMine, rememberMine } from '../lib/mine'
import PublicNav from './PublicNav'
import ContactFields from './ContactFields'

// One event from the home page (/#event/<id>): book GTA VI-style hours (advance by UPI) or enter a
// tournament (Valorant: name, mobile, rank, entry fee by UPI). Checked again on the server
// (public_event_book / public_tournament_entry); staff confirm the payment on the Floor.
export default function EventPage({ id, session }) {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [me, setMe] = useState(null)
  useEffect(() => {
    supabase.rpc('public_home').then(({ data, error }) => { if (error) setError(error.message); else setInfo(data) })
    if (isCustomer(session)) {
      const m = readMine()
      supabase.rpc('public_my_status', { p_bookings: m.bookings, p_event_bookings: m.event_bookings, p_entries: m.entries }).then(({ data }) => setMe(data?.me || null))
    }
  }, [session])
  const ev = info?.events.find((e) => e.id === id)
  if (error) return <Page><div className="alert error">{error}</div></Page>
  if (!info) return <Page><div className="card muted">Loading…</div></Page>
  if (!ev) return <Page><div className="card"><b>This event isn’t open right now.</b><p className="muted small" style={{ margin: '6px 0 0' }}><a href="#">Back to the home page</a></p></div></Page>
  return (
    <Page ev={ev}>
      {ev.format === 'tournament' ? <Tournament ev={ev} info={info} me={me} /> : <Slots ev={ev} info={info} me={me} />}
    </Page>
  )
}

function Page({ ev, children }) {
  return (
    <div className="jobs-page pub-page">
      <PublicNav />
      <a className="pub-back" href="#">‹ Home</a>
      <header className="jobs-head">
        {eventImage(ev) && <img className="gx-event-img" src={eventImage(ev)} alt="" />}
        <h1>{ev ? ev.name : 'Event'}</h1>
        {ev?.description && <p className="muted">{ev.description}</p>}
      </header>
      {children}
    </div>
  )
}

const ymd = (d) => d.toLocaleDateString('en-CA')
const today = () => ymd(new Date())

function Slots({ ev, info, me }) {
  const days = []
  for (let d = new Date(`${ev.starts_on}T00:00`); ymd(d) <= ev.ends_on; d.setDate(d.getDate() + 1)) if (ymd(d) >= today()) days.push(ymd(d))
  const [day, setDay] = useState(days[0])
  const [slots, setSlots] = useState(null)
  const [start, setStart] = useState(null)
  const [hours, setHours] = useState(1)
  const [players, setPlayers] = useState(1)
  const [name, setName] = useState(me?.name || '')
  const [phone, setPhone] = useState(me?.phone || '')
  const [ref, setRef] = useState('')
  const [step, setStep] = useState('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  useEffect(() => { if (me) { setName((n) => n || me.name || ''); setPhone((p) => p || me.phone || '') } }, [me])
  useEffect(() => {
    if (!day) return
    setSlots(null); setStart(null)
    supabase.rpc('public_event_slots', { p_event: ev.id, p_day: day }).then(({ data, error }) => { if (error) setError(error.message); else setSlots(data) })
  }, [day, ev.id])
  const amount = (Number(ev.first_price) + (hours - 1) * Number(ev.next_price)) * players
  const advance = Math.min(Number(ev.advance) || 0, amount)
  const fits = (t) => {
    const i = slots.findIndex((s) => s.t === t)
    for (let k = 0; k < hours; k++) { const s = slots[i + k]; if (!s || s.free < 1) return false }
    return new Date(t).getTime() > Date.now()
  }
  async function send() {
    setBusy(true); setError(null)
    const { data, error } = await supabase.rpc('public_event_book', { p_event: ev.id, p_start: start, p_hours: hours, p_players: players, p_name: name.trim(), p_phone: phone, p_upi_ref: ref.trim() || null })
    setBusy(false)
    if (error) { setError(error.message); if (/full|passed|slot/i.test(error.message)) setStep('form'); return }
    rememberMine('event_bookings', data.id)
    setDone(data); setStep('done')
  }
  if (!days.length) return <div className="card muted">This event has finished.</div>
  const when = start ? `${new Date(start).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · ${timeLabel(start)} – ${timeLabel(new Date(start).getTime() + hours * ev.slot_minutes * 60_000)}` : ''

  if (step === 'done') return (
    <div className="card book-done">
      <div className="book-tick">✓</div>
      <h2>Booking sent</h2>
      <div className="book-code mono">{done.code}</div>
      <p>{ev.name} · {when}{players > 1 ? ` · ${players} players` : ''} · {rs(done.amount)}</p>
      <p className="muted small">{done.advance ? `The shop confirms it once your ${rs(done.advance)} advance shows up. Pay the rest (${rs(done.amount - done.advance)}) at the counter.` : 'Pay at the counter.'} Your booking shows on the home page.</p>
      <a className="btn block" href="#">Home</a>
    </div>
  )
  if (step === 'pay') return (
    <PayCard amount={advance} info={info} note={`${ev.name} advance ${name.trim()}`} what={`${ev.name} · ${when}`} refValue={ref} setRef={setRef}
      onBack={() => setStep('form')} busy={busy} error={error} onSend={send}
      footer={`Advance ${rs(advance)} now, ${rs(amount - advance)} at the counter. The advance is non-refundable.`} />
  )
  const ready = start && name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10
  return (
    <div className="card book-form">
      <div className="chips gx-scroll">{days.map((d) => <button key={d} type="button" className={`chip chip-btn ${day === d ? 'on' : ''}`} onClick={() => setDay(d)}>{new Date(`${d}T00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</button>)}</div>
      <div className="caps muted">How long</div>
      <div className="chips">{Array.from({ length: ev.max_hours || 1 }, (_, i) => i + 1).map((h) => <button key={h} type="button" className={`chip chip-btn ${hours === h ? 'on' : ''}`} onClick={() => { setHours(h); setStart(null) }}>{durLabel(h * ev.slot_minutes)}</button>)}</div>
      {ev.kind === 'PS' && (<>
        <div className="caps muted">Players · price is per head</div>
        <div className="chips">{[1, 2, 3].map((n) => <button key={n} type="button" className={`chip chip-btn ${players === n ? 'on' : ''}`} onClick={() => setPlayers(n)}>{n}</button>)}</div>
      </>)}
      <div className="caps muted">Start time</div>
      {!slots ? <div className="muted small">Loading times…</div> : (
        <div className="book-slots">
          {slots.map((s) => <button key={s.t} type="button" disabled={!fits(s.t)} className={`book-slot ${start === s.t ? 'on' : ''}`} onClick={() => setStart(s.t)}>{timeLabel(s.t)}</button>)}
        </div>
      )}
      <ContactFields name={name} setName={setName} phone={phone} setPhone={setPhone} />
      <div className="book-total"><span className="muted">{durLabel(hours * ev.slot_minutes)}{players > 1 ? ` × ${players}` : ''}{advance ? ` · advance ${rs(advance)}` : ''}</span><b>{rs(amount)}</b></div>
      {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
      <button className="btn primary block" disabled={!ready || busy} onClick={() => { setError(null); if (advance) setStep('pay'); else send() }}>{start ? (advance ? `Book · pay ${rs(advance)} advance` : 'Book') : 'Pick a start time'}</button>
    </div>
  )
}

function Tournament({ ev, info, me }) {
  const [name, setName] = useState(me?.name || '')
  const [phone, setPhone] = useState(me?.phone || '')
  const [rank, setRank] = useState(null)
  // Owner, 22 Oct: enter as a pair (optional) — partner's name + mobile, the fee is per player.
  const [pair, setPair] = useState(false)
  const [pName, setPName] = useState('')
  const [pPhone, setPPhone] = useState('')
  const [ref, setRef] = useState('')
  const [step, setStep] = useState('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  useEffect(() => { if (me) { setName((n) => n || me.name || ''); setPhone((p) => p || me.phone || '') } }, [me])
  const each = ev.entry_fee === null ? null : Number(ev.entry_fee)
  const fee = each === null ? null : each * (pair ? 2 : 1)
  const left = ev.max_entries ? Math.max(0, ev.max_entries - ev.entries) : null
  async function send() {
    setBusy(true); setError(null)
    const { data, error } = await supabase.rpc('public_tournament_join', { p_event: ev.id, p_name: name.trim(), p_phone: phone, p_rank: rank, p_upi_ref: ref.trim() || null,
      p_partner_name: pair ? pName.trim() : null, p_partner_phone: pair ? pPhone : null })
    setBusy(false)
    if (error) { setError(error.message); setStep('form'); return }
    rememberMine('entries', data.id)
    setDone(data); setStep('done')
  }
  const when = ev.starts_on ? `${new Date(`${ev.starts_on}T00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · ${timeLabel(`${ev.starts_on}T${ev.open_time}`)}` : 'Date coming soon'
  if (step === 'done') return (
    <div className="card book-done">
      <div className="book-tick">✓</div>
      <h2>You’re registered</h2>
      <div className="book-code mono">{done.code}</div>
      <p>{ev.name} · {rank}{pair ? ` · with ${pName.trim()}` : ''} · {when}</p>
      <p className="muted small">{done.fee ? `The shop confirms your place once the ${rs(done.fee)} entry fee shows up.` : 'The entry fee will be announced; the shop will call you.'} Your entry shows on the home page.</p>
      <a className="btn block" href="#">Home</a>
    </div>
  )
  if (step === 'pay') return (
    <PayCard amount={fee} info={info} note={`${ev.name} entry ${name.trim()}`} what={`${ev.name} · ${rank}${pair ? ` · ${name.trim()} + ${pName.trim()}` : ''}`} refValue={ref} setRef={setRef}
      onBack={() => setStep('form')} busy={busy} error={error} onSend={send} footer="The entry fee is non-refundable." />
  )
  const ready = name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10 && rank && left !== 0
    && (!pair || (pName.trim().length >= 2 && pPhone.replace(/\D/g, '').length >= 10))
  return (
    <div className="card book-form">
      <div className="book-total"><span>{when}{pair && each ? ` · ${rs(each)} × 2` : ''}</span><b>{fee === null ? 'Fee TBA' : rs(fee)}</b></div>
      {left !== null && <div className="muted small">{left} place{left === 1 ? '' : 's'} left</div>}
      <ContactFields name={name} setName={setName} phone={phone} setPhone={setPhone} />
      <div className="caps muted">Your rank</div>
      <div className="chips">{RANKS.map((r) => <button key={r} type="button" className={`chip chip-btn ${rank === r ? 'on' : ''}`} onClick={() => setRank(r)}>{r}</button>)}</div>
      {!pair ? (
        <button type="button" className="btn block" onClick={() => setPair(true)}>+ Add a partner (team of 2){each ? ` · ${rs(each)} more` : ''}</button>
      ) : (<>
        <div className="card-head" style={{ margin: 0 }}><div className="caps muted">Partner</div><button type="button" className="btn link" style={{ padding: 0 }} onClick={() => { setPair(false); setPName(''); setPPhone('') }}>Remove</button></div>
        <label>Partner’s name<input value={pName} onChange={(e) => setPName(e.target.value)} maxLength={40} autoComplete="off" /></label>
        <label>Partner’s mobile<input value={pPhone} onChange={(e) => setPPhone(e.target.value.replace(/[^\d+ ]/g, ''))} inputMode="tel" placeholder="10 digits" autoComplete="off" /></label>
      </>)}
      {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
      <button className="btn primary block" disabled={!ready || busy} onClick={() => { setError(null); if (fee) setStep('pay'); else send() }}>{left === 0 ? 'Full' : fee ? `Enter · pay ${rs(fee)}` : busy ? 'Sending…' : 'Register'}</button>
    </div>
  )
}

function PayCard({ amount, info, note, what, refValue, setRef, onBack, busy, error, onSend, footer }) {
  return (
    <div className="card book-pay">
      <button className="btn link" style={{ justifySelf: 'start', padding: 0 }} onClick={onBack}>‹ Change</button>
      <div className="muted small">{what}</div>
      <div className="gx-qr-amount">{rs(amount)}</div>
      {info.upi_id ? (<>
        <div className="gx-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg(upiLink(info, amount, note)) }} />
        <a className="btn primary block" href={upiLink(info, amount, note)}>Pay in UPI app</a>
        <div className="small">or pay to <b className="mono">{info.upi_id}</b></div>
        <label className="book-ref">UPI reference / last 4 digits (optional)<input value={refValue} onChange={(e) => setRef(e.target.value)} inputMode="numeric" /></label>
      </>) : <p className="muted small">Pay at the counter.</p>}
      <p className="muted small" style={{ margin: 0 }}>{footer}</p>
      {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
      <button className="btn primary block" disabled={busy} onClick={onSend}>{busy ? 'Sending…' : info.upi_id ? 'I’ve paid · send' : 'Send'}</button>
    </div>
  )
}
