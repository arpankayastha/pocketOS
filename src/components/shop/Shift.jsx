import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { addDays, dayLabel, dayStart, dayTotals, duesByCustomer, durLabel, hoursLabel, minutesLeft, rs, sessionTotal, timeLabel, useNow } from '../../lib/shop'

// Staff home (owner, 12 Oct: "too spacious — compact, with the details their role needs"): a one-line shift bar
// (Log in / Log out, rpc shop_clock; the admin pays from these hours), then what needs doing now — systems
// playing / free, time running out, payments to check, today's bookings — today's money and the customers
// this person took. Each tile opens the tab that handles it.
export default function Shift({ householdId, userId, toast, shop, onOpen }) {
  const now = useNow(30_000)
  const [shifts, setShifts] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Owner: one staff member on duty at a time (shop_clock refuses a second Log in) — show who it is up front.
  const [other, setOther] = useState(null)
  const loadOther = useCallback(async () => {
    const { data } = await supabase.from('shop_shifts').select('user_id, clock_in, staff_name').eq('household_id', householdId).is('clock_out', null).neq('user_id', userId).maybeSingle()
    if (!data) { setOther(null); return }
    const { data: m } = await supabase.from('household_members').select('display_name, username').eq('user_id', data.user_id).maybeSingle()
    setOther({ name: m?.display_name || m?.username || data.staff_name || 'Someone', since: data.clock_in })
  }, [householdId, userId])
  useEffect(() => { loadOther() }, [loadOther])
  const load = useCallback(async () => {
    loadOther()
    const from = addDays(dayStart(), -6).toISOString()
    const { data, error } = await supabase.from('shop_shifts').select('*').eq('household_id', householdId).eq('user_id', userId)
      .or(`clock_in.gte.${from},clock_out.is.null`).order('clock_in', { ascending: false })
    if (error) setError(error.message); else setShifts(data)
  }, [householdId, userId])
  useEffect(() => { load() }, [load])

  const open = shifts?.find((s) => !s.clock_out)
  async function clock(action) {
    setBusy(true); setError(null)
    const { data, error } = await supabase.rpc('shop_clock', { p_household: householdId, p_action: action })
    setBusy(false)
    if (error) { setError(error.message); return }
    toast(action === 'in' ? `Logged in at ${timeLabel(data.clock_in)}` : `Logged out. ${durLabel((new Date(data.clock_out) - new Date(data.clock_in)) / 60_000)} today.`)
    load()
  }

  const mins = (s) => ((s.clock_out ? new Date(s.clock_out) : new Date(now)) - new Date(s.clock_in)) / 60_000
  const week = (shifts || []).reduce((a, s) => a + mins(s), 0)

  const [me, setMe] = useState(null)
  useEffect(() => {
    supabase.from('household_members').select('display_name, username, designation').eq('user_id', userId).maybeSingle().then(({ data }) => setMe(data))
  }, [userId])

  const running = (shop?.sessions || []).filter((x) => x.status === 'running')
  const seats = (shop?.systems || []).filter((x) => x.active !== false).reduce((a, x) => a + (x.seats || 1) - (x.off_seats || []).filter((n) => n <= (x.seats || 1)).length, 0)
  const playing = running.reduce((a, x) => a + Math.max(1, Number(x.players) || 1), 0)
  const ending = running.filter((x) => !x.paused_at && minutesLeft(x, now) <= 10).sort((a, b) => minutesLeft(a, now) - minutesLeft(b, now))
  const toCheck = (shop?.bookings || []).filter((b) => b.status === 'requested').length + (shop?.eventChecks || []).length + (shop?.entryChecks || []).length
  const today = dayStart(), tomorrow = addDays(today, 1)
  const upcoming = (shop?.bookings || []).filter((b) => ['requested', 'confirmed'].includes(b.status) && new Date(b.starts_at) >= new Date(now - 30 * 60_000) && new Date(b.starts_at) < tomorrow)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
  const totals = shop ? dayTotals(shop) : null
  const dues = duesByCustomer(shop?.dues)
  const myName = me?.display_name || me?.username
  const mine = (shop?.sessions || []).filter((x) => myName && x.entered_by === myName && new Date(x.started_at) >= today)
  const tile = (to, label, value, sub, tone) => (
    <button className={`card gx-tile ${tone || ''}`} onClick={() => onOpen?.(to)}>
      <span className="muted small">{label}</span><b>{value}</b>{sub && <span className="small muted gx-tile-sub">{sub}</span>}
    </button>
  )

  return (
    <section className="gx-split even gx-home">
      <div className="gx-col">
      <div className={`card gx-shiftbar ${open ? 'on' : ''}`}>
        <div className="grow">
          <div className="gx-shiftbar-who">{myName || 'Shift'}{me?.designation ? <span className="muted small"> · {me.designation}</span> : null}</div>
          <div className="small muted">{open ? <>On duty since {timeLabel(open.clock_in)} · <b className="pos">{durLabel(mins(open))}</b></> : 'Off duty'}</div>
        </div>
        {open
          ? <button className="btn danger" disabled={busy || !shifts} onClick={() => clock('out')}>Log out</button>
          : <button className="btn primary" disabled={busy || !shifts || !!other} onClick={() => clock('in')}>Log in</button>}
      </div>
      {error && <div className="alert error">{error}</div>}
      {!open && other && <div className="alert error" style={{ margin: 0 }}>{other.name} is on duty since {timeLabel(other.since)}. Only one person can be logged in — ask them to log out first.</div>}

      {shop && (<>
        <h3 className="gx-home-h">Right now</h3>
        <div className="gx-tiles">
          {tile('floor', 'Playing', `${playing} / ${seats}`, `${Math.max(0, seats - playing)} free`, playing >= seats ? 'warn' : '')}
          {tile('floor', 'Ending soon', ending.length || '—', ending.length ? ending.slice(0, 2).map((x) => `${x.system_name}${x.seat ? ` C${x.seat}` : ''} ${minutesLeft(x, now) <= 0 ? 'time up' : `${Math.ceil(minutesLeft(x, now))}m`}`).join(' · ') : 'nobody in the next 10 min', ending.length ? 'warn' : '')}
          {tile('floor', 'Payments to check', toCheck || '—', toCheck ? 'online bookings · advances · fees' : 'all checked', toCheck ? 'warn' : '')}
          {tile('floor', 'Bookings today', upcoming.length || '—', upcoming[0] ? `next ${timeLabel(upcoming[0].starts_at)} · ${upcoming[0].customer_name}` : 'none coming up')}
        </div>
      </>)}
      </div>

      <div className="gx-col">
      {totals && (
        <button className="card gx-money" onClick={() => onOpen?.('cash')}>
          <div className="card-head"><h3>Today's money</h3><span className="muted small">Cash ›</span></div>
          <div className="line"><span>Should be in drawer</span><b>{rs(totals.drawer)}</b></div>
          <div className="line"><span className="muted">Online today</span><span>{rs(totals.online)}</span></div>
          <div className="line"><span className="muted">Customer dues</span><span className={dues.length ? 'neg' : 'muted'}>{dues.length ? `${rs(dues.reduce((a, d) => a + d.total, 0))} · ${dues.length}` : 'none'}</span></div>
        </button>
      )}
      {myName && shop && (
        <div className="card">
          <div className="card-head"><h3>My customers today</h3><span className="muted small">{mine.length} · {rs(mine.reduce((a, x) => a + sessionTotal(x), 0))}</span></div>
          {mine.length === 0 ? <div className="muted small">None yet.</div> : mine.slice(0, 6).map((x) => (
            <div key={x.id} className="line"><span>{x.system_name} · {x.customer_name}<span className="muted small"> · {timeLabel(x.started_at)}</span></span><span className={x.status === 'running' ? 'pos small' : 'small muted'}>{x.status === 'running' ? 'playing' : rs(sessionTotal(x))}</span></div>
          ))}
        </div>
      )}
      <MyPay householdId={householdId} version={shifts?.length} />
      <details className="card gx-week">
        <summary><b>My hours · last 7 days</b><span className="muted small">{hoursLabel(week)}</span></summary>
        {shifts === null ? <div className="muted small">Loading…</div> : shifts.length === 0 ? <div className="muted small">No shifts yet.</div> : shifts.map((s) => (
          <div key={s.id} className="line">
            <div><div>{dayLabel(s.clock_in)}</div><div className="muted small">{timeLabel(s.clock_in)} – {s.clock_out ? timeLabel(s.clock_out) : 'now'}</div></div>
            <b>{durLabel(mins(s))}</b>
          </div>
        ))}
        <p className="muted small" style={{ margin: '8px 0 0' }}>Forgot to log out? Ask the admin to fix it.</p>
      </details>
      </div>
    </section>
  )
}

// Owner, 16 Oct: staff see their own pay this month — hours × rate, deductions / bonus, what's been paid, what's left.
function MyPay({ householdId, version }) {
  const [p, setP] = useState(null)
  useEffect(() => { supabase.rpc('my_pay', { p_household: householdId }).then(({ data }) => setP(data || null)) }, [householdId, version])
  if (!p) return null
  const left = Math.max(0, Number(p.pay) - Number(p.paid))
  const month = new Date().toLocaleDateString('en-IN', { month: 'long' })
  return (
    <div className="card">
      <div className="card-head"><h3>My pay · {month}</h3><b>{rs(p.pay)}</b></div>
      <div className="line"><span className="muted">{hoursLabel(p.minutes)} × {rs(p.rate)}/hr</span><span>{rs(p.earned)}</span></div>
      {Number(p.adjust) !== 0 && <div className="line"><span className="muted">{Number(p.adjust) < 0 ? 'Deductions' : 'Bonus'}</span><span className={Number(p.adjust) < 0 ? 'neg' : 'pos'}>{Number(p.adjust) < 0 ? '−' : '+'}{rs(Math.abs(p.adjust))}</span></div>}
      <div className="line"><span className="muted">Paid so far</span><span className="pos">{rs(p.paid)}</span></div>
      <div className="line"><b>Left to be paid</b><b>{rs(left)}</b></div>
      {(p.payments || []).map((x, i) => (
        <div key={i} className="muted small">Paid {rs(x.amount)} {x.mode} on {new Date(x.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{x.note ? ` · ${x.note}` : ''}</div>
      ))}
    </div>
  )
}
