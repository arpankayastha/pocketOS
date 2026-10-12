import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BrandMark } from '../lib/icons'
import { addDays, dayStart, durLabel, priceFor, rs, timeLabel } from '../lib/shop'
import { qrSvg, upiLink } from '../lib/upi'

// Public booking page (/#book) — what the "Scan to book" banner at the shop opens. No login: the page only
// talks to public_shop_info / public_availability / public_book (security definer, checked on the server).
// Customers book a PC or the PS5 for today or tomorrow, pay the full amount by UPI (advance, non-refundable),
// and staff confirm the request on the Floor once the payment shows up.
const DURS = [30, 60, 90, 120, 180]

export default function Book() {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [kind, setKind] = useState('PC')
  const [day, setDay] = useState(0)
  const [avail, setAvail] = useState(null)
  const [now, setNow] = useState(null)
  const [start, setStart] = useState(null)
  const [minutes, setMinutes] = useState(60)
  const [players, setPlayers] = useState(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [ref, setRef] = useState('')
  const [step, setStep] = useState('form') // form | pay | done
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    supabase.rpc('public_shop_info').then(({ data, error }) => { if (error) setError(error.message); else setInfo(data) })
    supabase.rpc('public_availability', { p_day: dayStart().toLocaleDateString('en-CA') }).then(({ data }) => setNow(data))
  }, [])
  const dayDate = addDays(dayStart(), day)
  useEffect(() => {
    setAvail(null); setStart(null)
    supabase.rpc('public_availability', { p_day: dayDate.toLocaleDateString('en-CA') }).then(({ data, error }) => { if (error) setError(error.message); else setAvail(data) })
  }, [day]) // eslint-disable-line react-hooks/exhaustive-deps

  const happy = info && start ? (info.happy_days || []).includes(new Date(start).getDay()) : info ? (info.happy_days || []).includes(dayDate.getDay()) : false
  const each = info ? priceFor(info.rates || [], kind, minutes, happy) : 0
  const amount = each * players
  const maxPlayers = kind === 'PS' ? 3 : 1
  const fits = (t) => { // free for the whole duration from slot t
    const i = avail.findIndex((a) => a.t === t)
    for (let k = 0; k < minutes / 30; k++) { const a = avail[i + k]; if (!a || a[kind] < 1) return false }
    return true
  }
  const slots = useMemo(() => (avail || []).filter((a) => new Date(a.t).getTime() > Date.now() - 10 * 60_000), [avail])
  const current = now?.find((a) => { const t = new Date(a.t).getTime(); return t <= Date.now() && Date.now() < t + 30 * 60_000 })

  async function send() {
    setBusy(true); setError(null)
    const { data, error } = await supabase.rpc('public_book', { p_kind: kind, p_start: start, p_minutes: minutes, p_players: players, p_name: name.trim(), p_phone: phone, p_upi_ref: ref.trim() || null })
    setBusy(false)
    if (error) { setError(error.message); if (/booked|passed|hours/i.test(error.message)) setStep('form'); return }
    setDone({ ...data, start, minutes, kind, players }); setStep('done')
  }

  if (error && !info) return <Page><div className="alert error">Couldn’t open booking: {error}</div></Page>
  if (!info) return <Page><div className="card muted">Loading…</div></Page>
  if (!info.online_booking) return <Page><div className="card"><b>Online booking is closed right now.</b><p className="muted small" style={{ margin: '6px 0 0' }}>Please call or visit the shop.</p></div></Page>

  if (step === 'done') return (
    <Page>
      <div className="card book-done">
        <div className="book-tick">✓</div>
        <h2>Booking request sent</h2>
        <div className="book-code mono">{done.code}</div>
        <p>{done.kind === 'PS' ? 'PS5' : 'PC'} · {new Date(done.start).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · {timeLabel(done.start)} – {timeLabel(new Date(done.start).getTime() + done.minutes * 60_000)}{done.players > 1 ? ` · ${done.players} players` : ''} · {rs(done.amount)}</p>
        <p className="muted small">The shop confirms it once your payment shows up. Show this code at the counter.</p>
        <button className="btn block" onClick={() => { setStep('form'); setStart(null); setRef(''); setDone(null) }}>Book another</button>
      </div>
    </Page>
  )

  if (step === 'pay') {
    const note = `${kind === 'PS' ? 'PS5' : 'PC'} booking ${name.trim()}`
    return (
      <Page>
        <div className="card book-pay">
          <button className="btn link" style={{ justifySelf: 'start', padding: 0 }} onClick={() => setStep('form')}>‹ Change</button>
          <div className="muted small">{kind === 'PS' ? 'PS5' : 'PC'} · {new Date(start).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · {timeLabel(start)} – {timeLabel(new Date(start).getTime() + minutes * 60_000)}{players > 1 ? ` · ${players} players` : ''}</div>
          <div className="gx-qr-amount">{rs(amount)}</div>
          {info.upi_id ? (<>
            <div className="gx-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg(upiLink(info, amount, note)) }} />
            <a className="btn primary block" href={upiLink(info, amount, note)}>Pay in UPI app</a>
            <div className="small">or pay to <b className="mono">{info.upi_id}</b></div>
            <label className="book-ref">UPI reference / last 4 digits (optional)<input value={ref} onChange={(e) => setRef(e.target.value)} inputMode="numeric" /></label>
          </>) : <p className="muted small">Pay at the counter when you arrive.</p>}
          <p className="muted small" style={{ margin: 0 }}>Advance payment is non-refundable once paid.</p>
          {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
          <button className="btn primary block" disabled={busy} onClick={send}>{busy ? 'Sending…' : info.upi_id ? 'I’ve paid · send booking' : 'Send booking'}</button>
        </div>
      </Page>
    )
  }

  const ready = start && name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10
  return (
    <Page>
      {current && (
        <div className="card book-now">
          <div className="muted small">Right now</div>
          <div className="book-now-row">
            <span><b className={current.PC ? 'pos' : 'neg'}>{current.PC}</b> of {info.systems.PC} PCs free</span>
            <span>PS5 <b className={current.PS ? 'pos' : 'neg'}>{current.PS ? 'free' : 'busy'}</b></span>
          </div>
        </div>
      )}
      <div className="card book-form">
        <div className="seg book-seg">
          <button className={kind === 'PC' ? 'on' : ''} onClick={() => { setKind('PC'); setPlayers(1); setStart(null) }}>PC</button>
          <button className={kind === 'PS' ? 'on' : ''} onClick={() => { setKind('PS'); setStart(null) }}>PS5</button>
        </div>
        <div className="seg book-seg">
          {[0, 1].map((d) => <button key={d} className={day === d ? 'on' : ''} onClick={() => setDay(d)}>{d === 0 ? 'Today' : 'Tomorrow'} · {addDays(dayStart(), d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</button>)}
        </div>
        {happy && <div className="pill gx-pill happy" style={{ justifySelf: 'start' }}>Happy hours · lower prices all day</div>}
        <div className="caps muted">How long</div>
        <div className="chips">{DURS.map((m) => <button key={m} type="button" className={`chip chip-btn ${minutes === m ? 'on' : ''}`} onClick={() => { setMinutes(m); setStart(null) }}>{durLabel(m)}</button>)}</div>
        {maxPlayers > 1 && (<>
          <div className="caps muted">Players · price is per head</div>
          <div className="chips">{[1, 2, 3].map((n) => <button key={n} type="button" className={`chip chip-btn ${players === n ? 'on' : ''}`} onClick={() => setPlayers(n)}>{n}</button>)}</div>
        </>)}
        <div className="caps muted">Start time</div>
        {!avail ? <div className="muted small">Loading times…</div> : slots.length === 0 ? <div className="muted small">No more times today. Try tomorrow.</div> : (
          <div className="book-slots">
            {slots.map((a) => {
              const ok = fits(a.t)
              return <button key={a.t} type="button" disabled={!ok} className={`book-slot ${start === a.t ? 'on' : ''}`} onClick={() => setStart(a.t)}>{timeLabel(a.t)}</button>
            })}
          </div>
        )}
        <div className="grid2">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label>Mobile<input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))} inputMode="tel" autoComplete="tel" placeholder="10 digits" /></label>
        </div>
        <div className="book-total">
          <span className="muted">{durLabel(minutes)}{players > 1 ? ` × ${players}` : ''}{happy ? ' · happy hours' : ''}</span>
          <b>{rs(amount)}</b>
        </div>
        {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
        <button className="btn primary block" disabled={!ready} onClick={() => { setError(null); setStep('pay') }}>{start ? `Book ${timeLabel(start)} · ${rs(amount)}` : 'Pick a start time'}</button>
      </div>
      <p className="muted small" style={{ textAlign: 'center' }}>Book for today or tomorrow. Advance payment is non-refundable once paid.</p>
    </Page>
  )
}

function Page({ children }) {
  return (
    <div className="jobs-page">
      <header className="jobs-head">
        <div className="brand big"><BrandMark size={34} />GRANDXGAMER</div>
        <h1>Book your game</h1>
        <p className="muted">PC & PS5 gaming café · Pune</p>
      </header>
      {children}
    </div>
  )
}
