import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BrandMark } from '../lib/icons'
import { DAY_NAMES, dayStart, durLabel, rs, timeLabel } from '../lib/shop'
import { googleEnabled, isCustomer, signInWithGoogle, useMyStatus } from '../lib/mine'
import Passkeys, { passkeyError, signInWithFingerprint } from './Passkeys'
import { PasskeyIcon } from '../lib/icons'

// The café's public home page (the owner's brief, 12 Oct): "Welcome to GRANDXGAMER" over the owner's photo,
// Book your slots now, the events (GTA VI slot booking, the Valorant tournament), job openings, and Google
// sign-in for customers. A customer's phone shows their bookings and, once staff press Start, the time left.
// Everything comes from public security-definer rpcs (public_home, public_my_status); no shop rows are readable.
export default function Home({ session }) {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [now, setNow] = useState(null)
  const [google, setGoogle] = useState(null)
  const customer = isCustomer(session) ? session : null
  const { status, reload } = useMyStatus(customer)

  useEffect(() => {
    supabase.rpc('public_home').then(({ data, error }) => { if (error) setError(error.message); else setInfo(data) })
    supabase.rpc('public_availability', { p_day: dayStart().toLocaleDateString('en-CA') }).then(({ data }) => setNow(data))
    googleEnabled().then(setGoogle)
  }, [])
  const current = now?.find((a) => { const t = new Date(a.t).getTime(); return t <= Date.now() && Date.now() < t + 30 * 60_000 })
  const happyToday = info && (info.happy_days || []).includes(new Date().getDay())

  async function google_() {
    if (google === false) { setError('Google sign-in is being set up. You can still book without signing in.'); return }
    const { error } = await signInWithGoogle()
    if (error) setError(error.message)
  }

  return (
    <div className="home">
      <header className="home-hero" style={info?.hero_url ? { '--hero': `url("${info.hero_url}")` } : undefined}>
        <nav className="home-nav">
          <span className="brand"><BrandMark size={26} />GRANDXGAMER</span>
          {customer ? (
            <button className="btn small ghost home-me" onClick={() => supabase.auth.signOut()} title="Sign out">
              {customer.user.user_metadata?.avatar_url && <img src={customer.user.user_metadata.avatar_url} alt="" referrerPolicy="no-referrer" />}
              {(status?.me?.name || customer.user.user_metadata?.full_name || 'Me').split(' ')[0]} · Sign out
            </button>
          ) : (
            <span className="home-signin">
              <button className="btn small home-google" onClick={google_}><GoogleG /> Sign in</button>
              <button className="btn small home-google" aria-label="Sign in with fingerprint" title="Sign in with fingerprint" onClick={async () => {
                const { error } = await signInWithFingerprint().catch((e) => ({ error: e }))
                if (error) setError(passkeyError(error))
              }}><PasskeyIcon /></button>
            </span>
          )}
        </nav>
        <div className="home-hero-text">
          <div className="home-kicker">PC &amp; PS5 gaming café</div>
          <h1>Welcome to <span>GRANDXGAMER</span></h1>
          <div className="home-ctas"><a className="btn primary home-cta" href="#book">Book your slots now</a>
            <a className="btn home-cta ghostlight" href="#timer">Have a code? Timer</a></div>
          {current && info && (
            <div className="home-live">
              <span><i className={current.PC ? 'on' : ''} />{current.PC} of {info.systems?.PC} PCs free</span>
              <span><i className={current.PS ? 'on' : ''} />PS5 {current.PS ? `${current.PS} of 3 controllers free` : 'busy'}</span>
            </div>
          )}
        </div>
      </header>

      <main className="home-main">
        {error && <div className="alert error">{error}</div>}
        {customer && status && !status.me?.phone && <Profile me={status.me} session={customer} onSaved={reload} />}
        {status && <Mine status={status} />}
        {customer && status?.me?.phone && <details className="card home-fp"><summary>Fingerprint sign-in</summary><Passkeys /></details>}

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
      <div className="home-event-art" style={ev.image_url ? { backgroundImage: `url("${ev.image_url}")` } : undefined}>
        {!ev.image_url && <span>{ev.name}</span>}
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

// First Google sign-in: name + mobile, so the counter can link the time they play to this account.
function Profile({ me, session, onSaved }) {
  const [name, setName] = useState(me?.name || session.user.user_metadata?.full_name || '')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.rpc('customer_profile', { p_name: name.trim(), p_phone: phone })
    setBusy(false)
    if (error) setError(error.message); else onSaved()
  }
  return (
    <form className="card stack" onSubmit={save}>
      <h3 style={{ margin: 0 }}>Welcome! Add your mobile</h3>
      <p className="muted small" style={{ margin: 0 }}>Give the same number at the counter and your time left shows here while you play.</p>
      {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
      <div className="grid2">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        <label>Mobile<input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))} inputMode="tel" autoComplete="tel" placeholder="10 digits" /></label>
      </div>
      <button className="btn primary" disabled={busy || name.trim().length < 2 || phone.replace(/\D/g, '').length < 10}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  )
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
