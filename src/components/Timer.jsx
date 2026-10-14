import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { timeLabel } from '../lib/shop'
import { alarm, scheduleAlarm, speak } from '../lib/alarm'
import PublicNav from './PublicNav'

// Timer screen (/#timer) — open it on each PC (or on the customer's phone): type the 6-character code from the
// booking, or the one staff read from Slots for a walk-in. Once staff press Start it shows the time left, live,
// and "Paused" during a technical failure. Only public_timer is used: system, controller and times, no names.
const KEY = 'gx.timerCode'

export default function Timer() {
  // A link from the counter (#timer/4DB5C8 — Slots → code → QR / WhatsApp) opens straight on that code.
  const [code, setCode] = useState(() => {
    const fromLink = location.hash.match(/^#timer\/([0-9a-f]{6})$/i)?.[1]?.toUpperCase()
    try { if (fromLink) { localStorage.setItem(KEY, fromLink); history.replaceState(null, '', '#timer') } return fromLink || localStorage.getItem(KEY) || '' } catch { return fromLink || '' }
  })
  const [input, setInput] = useState('')
  const [data, setData] = useState(null)
  const [skew, setSkew] = useState(0) // server clock − this device's clock
  const [error, setError] = useState(null)
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    if (!code) return
    const { data, error } = await supabase.rpc('public_timer', { p_code: code })
    if (error) { setError(error.message); return }
    setError(null); setData(data); setSkew(new Date(data.now).getTime() - Date.now())
  }, [code])
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    const s = setInterval(() => tick((n) => n + 1), 1000)
    return () => { clearInterval(t); clearInterval(s) }
  }, [load])

  // Beep at 5 minutes left (5 s) and at time up (10 s). Booked ahead on the audio clock so it rings on time
  // even with a full-screen game in front; re-booked whenever the end time changes (extend / pause / resume).
  // A mark passed less than a minute ago (page just opened) rings at once.
  const booked = useRef({ key: '', cancel: [] })
  useEffect(() => {
    const list = (data?.sessions || []).filter((x) => x.status === 'running' && !x.paused_at)
    const key = list.map((x) => `${x.system}:${x.seat}:${x.ends_at}`).join('|')
    if (key === booked.current.key) return
    booked.current.cancel.forEach((f) => f())
    const cancel = []
    const off = new Date(data?.now || Date.now()).getTime() - Date.now()
    for (const x of list) {
      const end = new Date(x.ends_at).getTime() - off // on this device's clock
      for (const [mark, secs, words] of [[5, 5, '5 minutes remaining'], [0, 10, 'Your time is up. Thanks for playing, do visit again!']]) {
        const at = end - mark * 60_000
        if (at > Date.now()) {
          cancel.push(scheduleAlarm(at, secs))
          // the voice follows the beep (a page timer, so behind a full-screen game it can be a little late)
          const t = setTimeout(() => speak(words), at - Date.now() + secs * 1000)
          cancel.push(() => clearTimeout(t))
        } else if (Date.now() - at < 60_000) { alarm(secs); setTimeout(() => speak(words), secs * 1000) }
      }
    }
    booked.current = { key, cancel }
  }, [data])

  // Staff can press End before the time runs out (owner's test: closed 3 min early, so the booked time-up beep
  // was cancelled and the page went quiet). A session that was running and is now ended early rings time up at once (on time, it already rang).
  const wasRunning = useRef(null)
  useEffect(() => {
    if (!data) return
    const id = (x) => `${x.system}:${x.seat}`
    const prev = wasRunning.current
    wasRunning.current = new Set((data.sessions || []).filter((x) => x.status === 'running').map(id))
    if (prev && (data.sessions || []).some((x) => x.status !== 'running' && prev.has(id(x)) && new Date(x.ends_at) > new Date(data.now))) {
      alarm(10); setTimeout(() => speak('Your time is up. Thanks for playing, do visit again!'), 10_000)
    }
  }, [data])
  useEffect(() => () => booked.current.cancel.forEach((f) => f()), [])

  function use(e) {
    e.preventDefault()
    const c = input.replace(/[^0-9a-f]/gi, '').toUpperCase()
    if (c.length !== 6) { setError('Enter the 6-character code.'); return }
    try { localStorage.setItem(KEY, c) } catch { /* ignore */ }
    setData(null); setCode(c); setInput('')
  }
  function forget() { try { localStorage.removeItem(KEY) } catch { /* ignore */ } setCode(''); setData(null) }
  const fullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {})

  const now = Date.now() + skew
  const running = (data?.sessions || []).filter((s) => s.status === 'running')
  const ended = (data?.sessions || []).filter((s) => s.status !== 'running')

  return (
    <div className="timer-page pub-page">
      <PublicNav active="timer" />
      {!code ? (
        <form className="card timer-code" onSubmit={use}>
          <h2>Enter your code</h2>
          <p className="muted small">The 6-character code from your booking, or ask at the counter.</p>
          <input className="mono" autoFocus={typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches} value={input} onChange={(e) => setInput(e.target.value.toUpperCase().slice(0, 8))} placeholder="e.g. 4DB5C8" autoCapitalize="characters" spellCheck={false} />
          {error && <div className="alert error" style={{ margin: 0 }}>{error}</div>}
          <button className="btn primary">Show my timer</button>
        </form>
      ) : (<>
        {error && <div className="alert error">{error}</div>}
        {data && !running.length && (
          <div className="card timer-wait">
            {data.booking && data.booking.status !== 'cancelled' && !ended.length ? (<>
              <h2>Waiting to start</h2>
              <p className="muted">Booked for {timeLabel(data.booking.starts_at)}. Your timer starts here when the staff press Start.</p>
            </>) : ended.length ? <h2>Your time is up. Thanks for playing!<br /><span className="timer-again">Do visit again 🎮</span></h2> : <h2>No game found for code {code}</h2>}
          </div>
        )}
        {running.map((s) => {
          const end = new Date(s.ends_at).getTime() + (s.paused_at ? now - new Date(data.now).getTime() : 0)
          const left = Math.max(0, end - now)
          const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000), sec = Math.floor((left % 60_000) / 1000)
          const total = (Number(s.minutes)) * 60_000
          return (
            <div key={`${s.system}-${s.seat}`} className={`card timer-card ${s.paused_at ? 'paused' : left < 5 * 60_000 ? 'low' : ''}`}>
              <div className="timer-where">{s.system}{s.seats > 1 ? ` · Controller ${s.seat}` : ''}</div>
              <div className="timer-big">{left ? `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}` : 'Time up'}</div>
              <div className="timer-sub">{s.paused_at ? 'Paused · your time is safe' : left ? `left · ends ${timeLabel(end)}` : 'Ask at the counter to extend'}</div>
              <div className="gx-bar"><i style={{ width: `${Math.min(100, Math.max(0, 100 - (left / total) * 100))}%` }} /></div>
            </div>
          )
        })}
        <p className="muted small" style={{ textAlign: 'center' }}>Code <b className="mono">{code}</b> · <button className="btn link" style={{ padding: 0 }} onClick={forget}>Use another code</button> · <button className="btn link" style={{ padding: 0 }} onClick={fullscreen}>Full screen</button> · <a href="#">Home</a></p>
      </>)}
    </div>
  )
}
