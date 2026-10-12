import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { addDays, dayLabel, dayStart, durLabel, hoursLabel, timeLabel, useNow } from '../../lib/shop'

// Staff: shift Log in / Log out (owner's wording; rpc shop_clock) and this week's hours. The admin pays from these hours.
export default function Shift({ householdId, userId, toast }) {
  const now = useNow(30_000)
  const [shifts, setShifts] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
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

  return (
    <section className="gx-split even">
      <div className="gx-col">
      <div className="card gx-clock">
        {error && <div className="alert error">{error}</div>}
        {open ? (<>
          <span className="pill gx-pill free">On shift</span>
          <div className="muted small" style={{ marginTop: 8 }}>Since {timeLabel(open.clock_in)}</div>
          <div className="gx-big">{durLabel(mins(open))}</div>
          <button className="gx-clock-btn out" disabled={busy || !shifts} onClick={() => clock('out')}>LOG<br />OUT</button>
        </>) : (<>
          <span className="pill gx-pill">Off shift</span>
          <div className="muted small" style={{ marginTop: 8 }}>{dayLabel(now)}</div>
          <button className="gx-clock-btn in" disabled={busy || !shifts} onClick={() => clock('in')}>LOG<br />IN</button>
        </>)}
        <p className="muted small" style={{ margin: 0 }}>Forgot to log out? Ask the admin to fix it.</p>
      </div>
      </div>
      <div className="gx-col">
      <div className="card">
        <div className="card-head"><h3>Last 7 days</h3><span className="amt muted small">{hoursLabel(week)}</span></div>
        {shifts === null ? <div className="muted small">Loading…</div> : shifts.length === 0 ? <div className="muted small">No shifts yet.</div> : shifts.map((s) => (
          <div key={s.id} className="line">
            <div><div>{dayLabel(s.clock_in)}</div><div className="muted small">{timeLabel(s.clock_in)} – {s.clock_out ? timeLabel(s.clock_out) : 'now'}</div></div>
            <b>{durLabel(mins(s))}</b>
          </div>
        ))}
      </div>
      </div>
    </section>
  )
}
