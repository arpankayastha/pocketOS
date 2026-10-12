import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BrandMark } from '../lib/icons'
import { timeLabel } from '../lib/shop'
import { alarm } from '../lib/alarm'

// Timer screen (/#timer) — open it on each PC (or on the customer's phone): type the 6-character code from the
// booking, or the one staff read from Slots for a walk-in. Once staff press Start it shows the time left, live,
// and "Paused" during a technical failure. Only public_timer is used: system, controller and times, no names.
const KEY = 'gx.timerCode'
const beeped = new Set()

export default function Timer() {
  const [code, setCode] = useState(() => { try { return localStorage.getItem(KEY) || '' } catch { return '' } })
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
  // Beep at 5 minutes left and at time up (owner: "alarm when time ends").
  for (const s of running) {
    if (s.paused_at) continue
    const left = (new Date(s.ends_at).getTime() - now) / 60_000
    for (const mark of [5, 0]) {
      const key = `${s.system}:${s.seat}:${s.ends_at}:${mark}`
      if (left <= mark && left > mark - 1 && !beeped.has(key)) { beeped.add(key); alarm(mark === 0 ? 10 : 5) }
    }
  }
  const ended = (data?.sessions || []).filter((s) => s.status !== 'running')

  return (
    <div className="timer-page">
      <header className="timer-head"><a className="brand big" href="#"><BrandMark size={30} />GRANDXGAMER</a>
        {code && <button className="btn small ghost" onClick={fullscreen}>Full screen</button>}</header>
      {!code ? (
        <form className="card timer-code" onSubmit={use}>
          <h2>Enter your code</h2>
          <p className="muted small">The 6-character code from your booking, or ask at the counter.</p>
          <input className="mono" autoFocus value={input} onChange={(e) => setInput(e.target.value.toUpperCase().slice(0, 8))} placeholder="e.g. 4DB5C8" autoCapitalize="characters" spellCheck={false} />
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
            </>) : ended.length ? <h2>Your time is over. Thanks for playing!</h2> : <h2>No game found for code {code}</h2>}
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
        <p className="muted small" style={{ textAlign: 'center' }}>Code <b className="mono">{code}</b> · <button className="btn link" style={{ padding: 0 }} onClick={forget}>Use another code</button></p>
      </>)}
    </div>
  )
}
