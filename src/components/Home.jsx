import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DAY_NAMES, eventImage, dayStart, durLabel, rs, timeLabel } from '../lib/shop'
import { isCustomer, useMyStatus } from '../lib/mine'
import PublicNav from './PublicNav'
import { Profile } from './Me'

// The café's public home page (the owner's brief, 12 Oct): "Welcome to GRANDXGAMER" over the owner's photo,
// Book your slots now, the events (GTA VI slot booking, the Valorant tournament), job openings, and Google
// sign-in for customers. A customer's phone shows their bookings and, once staff press Start, the time left.
// Everything comes from public security-definer rpcs (public_home, public_my_status); no shop rows are readable.
export default function Home({ session }) {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(null)
  const customer = isCustomer(session) ? session : null
  const { status, reload } = useMyStatus(customer)

  useEffect(() => {
    supabase.rpc('public_home').then(({ data, error }) => { if (error) setError(error.message); else setInfo(data) })
    supabase.rpc('public_availability', { p_day: dayStart().toLocaleDateString('en-CA') }).then(({ data }) => setNow(data))
  }, [])
  const current = now?.find((a) => { const t = new Date(a.t).getTime(); return t <= Date.now() && Date.now() < t + 30 * 60_000 })
  const happyToday = info && (info.happy_days || []).includes(new Date().getDay())

  return (
    <div className="home pub-page">
      <PublicNav active="home" />
      <header className="home-hero" style={{ '--hero': `url("${info?.hero_url || '/brand/hero.jpg'}")` }}>
        <Social links={info?.social} />
        <div className="home-hero-text">
          <div className="home-kicker">PC &amp; PS5 gaming café</div>
          <h1>Welcome to <span>GRANDXGAMER</span></h1>
          <p className="home-legacy">5 Years of Gaming Legacy — The Journey Continues! <span>(Since 2021)</span></p>
          <div className="home-ctas"><a className="btn primary home-cta" href="#book">Book your slots now</a>
            <a className="btn home-cta ghostlight" href="#timer">Have a code? Timer</a></div>
          {current && info && (
            <div className="home-live">
              <span><i className={current.PC ? 'on' : ''} />{current.PC} of {info.systems?.PC} PCs available</span>
              <span><i className={current.PS ? 'on' : ''} />{current.PS ? 'PS5 available' : 'PS5 busy'}</span>
            </div>
          )}
        </div>
      </header>

      <main className="home-main">
        {error && <div className="alert error">{error}</div>}
        {customer && status && !status.me?.phone && <Profile me={status.me} session={customer} onSaved={reload} />}
        {status && <Mine status={status} />}

        <section className="home-section">
          <h2>Events</h2>
          {!info ? <div className="card muted">Loading…</div> : info.events.length === 0 ? <div className="card muted small">No events right now. Follow @grandxgamer for the next one.</div> : (
            <div className="home-events">{info.events.map((ev) => <EventCard key={ev.id} ev={ev} />)}</div>
          )}
        </section>

        {info && (
          <section className="home-section home-two">
            <a className="card home-tile" href="#book">
              <b>Book gaming slots</b>
              <span className="muted small">PC or PS5 · today or tomorrow · pay by UPI</span>
              <Rates info={info} />
              {happyToday ? <span className="pill gx-pill happy">Happy hours today</span>
                : <span className="muted small">Happy hours every {(info.happy_days || []).map((d) => DAY_NAMES[d]).join(', ')} · all day</span>}
            </a>
            <a className="card home-tile" href="#jobs">
              <b>Job vacancy availability</b>
              <span className="muted small">{info.jobs ? `${info.jobs} opening${info.jobs === 1 ? '' : 's'} now · apply on WhatsApp` : 'No openings right now · check back soon'}</span>
              <span className="home-arrow">See jobs ›</span>
            </a>
          </section>
        )}

        <footer className="home-foot">
          <span className="muted small">Open {info ? `${timeLabel(`2000-01-01T${info.open_time}`)} – ${timeLabel(`2000-01-01T${info.close_time}`)}` : ''} · Pune</span>
          <a className="muted small" href="#staff">Staff login</a>
        </footer>
      </main>
    </div>
  )
}

function Rates({ info }) {
  const r = (kind, minutes, happy = false) => info.rates?.find((x) => x.kind === kind && x.minutes === minutes && !!x.happy === happy)?.price
  return (
    <div className="home-rates">
      <span>PC <b>{rs(r('PC', 60))}</b>/hr</span>
      <span>PS5 <b>{rs(r('PS', 60))}</b>/hr per head</span>
    </div>
  )
}

// GTA VI-style slot events and tournaments (Valorant), with the picture the owner uploads in Events.
function EventCard({ ev }) {
  const tour = ev.format === 'tournament'
  const d = (x) => new Date(`${x}T00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const when = !ev.starts_on ? 'Date coming soon' : ev.starts_on === ev.ends_on || tour ? `${d(ev.starts_on)}${tour ? ` · ${timeLabel(`${ev.starts_on}T${ev.open_time}`)}` : ''}` : `${d(ev.starts_on)} – ${d(ev.ends_on)}`
  const full = tour && ev.max_entries && ev.entries >= ev.max_entries
  return (
    <a className={`card home-event ${tour ? 'tour' : ''}`} href={full ? undefined : `#event/${ev.id}`}>
      <div className="home-event-art" style={eventImage(ev) ? { backgroundImage: `url("${eventImage(ev)}")` } : undefined}>
        {!eventImage(ev) && <span>{ev.name}</span>}
        <em>{tour ? 'Upcoming tournament' : ev.kind === 'PS' ? 'PS5 slots' : 'PC slots'}</em>
      </div>
      <div className="home-event-body">
        <b>{tour ? `Upcoming ${ev.name}` : ev.name}</b>
        <span className="muted small">{when}{tour ? '' : ` · ${timeLabel(`2000-01-01T${ev.open_time}`)} – ${timeLabel(`2000-01-01T${ev.close_time}`)}`}</span>
        {ev.description && <span className="small">{ev.description}</span>}
        <span className="small">{tour
          ? `${ev.entry_fee === null ? 'Entry fee to be announced' : `Entry ${rs(ev.entry_fee)}`}${ev.max_entries ? ` · ${Math.max(0, ev.max_entries - ev.entries)} places left` : ''}`
          : `${rs(ev.first_price)} first hour · then ${rs(ev.next_price)}/hr${ev.kind === 'PS' ? ' per head' : ''}`}</span>
        <span className="btn primary small home-event-cta">{full ? 'Full' : tour ? 'Enter now' : `Book ${ev.name.replace(/ launch$/i, '')} slots`}</span>
      </div>
    </a>
  )
}

// My bookings / entries and, while playing, the time left (staff pressed Start on the Floor).
function Mine({ status }) {
  const [, tick] = useState(0)
  const [fetched, setFetched] = useState(() => Date.now())
  useEffect(() => { setFetched(Date.now()) }, [status])
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  const items = [...status.bookings, ...status.event_bookings, ...status.entries]
  if (!status.playing.length && !items.length) return null
  const label = { requested: 'Payment being checked', confirmed: 'Confirmed', arrived: 'Playing / done', cancelled: 'Cancelled', no_show: 'Missed', booked: 'Booked' }
  return (
    <section className="home-section">
      {status.playing.map((s) => {
        // ends_at already counts pauses; while paused it keeps moving with the clock.
        const end = new Date(s.ends_at).getTime() + (s.paused_at ? Date.now() - fetched : 0)
        const left = Math.max(0, end - Date.now())
        const mm = Math.floor(left / 60_000), ss = Math.floor((left % 60_000) / 1000)
        return (
          <div key={s.id} className="card home-timer">
            <span className="muted small">Playing on {s.system}{s.seats > 1 ? ` · controller ${s.seat}` : ''}</span>
            <div className={`home-timer-big ${left < 5 * 60_000 ? 'neg' : ''}`}>{left ? `${Math.floor(mm / 60) ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}` : mm}:${String(ss).padStart(2, '0')}` : 'Time up'}</div>
            <span className="muted small">{s.paused_at ? 'Paused · your time is safe' : left ? `left · ends ${timeLabel(end)}` : 'Ask at the counter to extend'} · code {s.code}</span>
            <div className="gx-bar"><i style={{ width: `${Math.min(100, 100 - (left / (s.minutes * 60_000)) * 100)}%` }} /></div>
          </div>
        )
      })}
      {items.length > 0 && (
        <div className="card">
          <h3>My bookings</h3>
          {status.bookings.map((b) => (
            <div key={b.id} className="line"><div className="grow"><div>{b.kind === 'PS' ? 'PS5' : 'PC'} · {new Date(b.starts_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })} {timeLabel(b.starts_at)} · {durLabel(b.minutes)}</div>
              <div className="muted small">Code {b.code} · {rs(b.amount)}</div></div><span className={`pill gx-pill ${b.status === 'confirmed' ? 'free' : b.status === 'requested' ? 'ending' : ''}`}>{label[b.status]}</span></div>
          ))}
          {status.event_bookings.map((b) => (
            <div key={b.id} className="line"><div className="grow"><div>{b.event} · {new Date(b.slot_start).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} {timeLabel(b.slot_start)}</div>
              <div className="muted small">Code {b.code} · {durLabel(b.hours * b.slot_minutes)} · {rs(b.amount)}{Number(b.advance) ? ` · advance ${rs(b.advance)}` : ''}</div></div>
              <span className={`pill gx-pill ${b.status === 'cancelled' ? '' : b.payment_ok ? 'free' : 'ending'}`}>{b.status === 'cancelled' ? 'Cancelled' : b.payment_ok ? 'Confirmed' : 'Payment being checked'}</span></div>
          ))}
          {status.entries.map((x) => (
            <div key={x.id} className="line"><div className="grow"><div>{x.event} · {x.rank}</div><div className="muted small">Code {x.code}{Number(x.fee) ? ` · ${rs(x.fee)}` : ''}</div></div>
              <span className={`pill gx-pill ${x.status === 'confirmed' ? 'free' : x.status === 'requested' ? 'ending' : ''}`}>{x.status === 'confirmed' ? 'You’re in' : x.status === 'requested' ? (Number(x.fee) ? 'Payment being checked' : 'Registered') : 'Cancelled'}</span></div>
          ))}
        </div>
      )}
    </section>
  )
}

// Owner (13 Oct): Instagram / Facebook / YouTube / WhatsApp community in the hero's top corner — links from ⚙ → Home page; empty ones hide.
function Social({ links }) {
  const items = [['instagram', 'Instagram', <path key="i" d="M12 2.2c3.2 0 3.6 0 4.8.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 3.9 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2zm0 4.8a5 5 0 100 10 5 5 0 000-10zm0 8.2a3.2 3.2 0 110-6.4 3.2 3.2 0 010 6.4zm5.2-9.6a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z" />],
    ['facebook', 'Facebook', <path key="f" d="M13.5 21.9v-8.2h2.8l.4-3.2h-3.2V8.4c0-.9.3-1.6 1.6-1.6h1.7V4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.3v3.2h2.8v8.2a10 10 0 113.4 0z" />],
    ['youtube', 'YouTube', <path key="y" d="M23 7.2a3 3 0 00-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 001 7.2C.5 9.1.5 12 .5 12s0 2.9.5 4.8a3 3 0 002.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 002.1-2.1c.5-1.9.5-4.8.5-4.8s0-2.9-.5-4.8zM9.7 15.1V8.9L15.5 12l-5.8 3.1z" />],
    ['whatsapp', 'WhatsApp community', <path key="w" d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.1 5.1 0 001.1 2.7 11.6 11.6 0 004.4 3.9c1.6.7 2.3.8 3.1.6a2.7 2.7 0 001.8-1.2 2.2 2.2 0 00.2-1.2c-.1-.1-.3-.2-.5-.3z" />]]
    .filter(([k]) => links?.[k])
  if (!items.length) return null
  return (
    <div className="home-social">
      {items.map(([k, label, icon]) => (
        <a key={k} href={links[k]} target="_blank" rel="noreferrer" aria-label={label} title={label}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">{icon}</svg>
        </a>
      ))}
    </div>
  )
}
