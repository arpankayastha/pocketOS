import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { addDays, dayLabel, dayStart, dayTotals, durLabel, hoursLabel, minutesLeft, sessionTotal, timeLabel, useDay, useNow, rs } from '../../lib/shop'
import { DrawerCard } from './Cash'

// Admin's first screen: today's money, sessions, hours by system, who is on shift, and the drawer.
export default function Today({ shop: live, householdId, onOpen }) {
  const now = useNow(30_000)
  const [back, setBack] = useState(0) // days before today
  const day = back ? addDays(dayStart(), -back) : null
  const past = useDay(householdId, day)
  const shop = back ? { ...live, ...(past || { sessions: [], cash: [], advances: [], shifts: [] }) } : live
  const t = dayTotals(shop, day || dayStart())
  const total = t.cash + t.online
  const staff = useStaffNames(householdId)
  const byKind = shop.systems.map((s) => ({
    name: s.name, ps: s.kind === 'PS',
    mins: shop.sessions.filter((x) => x.system_id === s.id && x.status === 'closed').reduce((a, x) => a + x.minutes, 0),
  }))
  const max = Math.max(60, ...byKind.map((b) => b.mins))
  const overdue = shop.sessions.filter((s) => s.status === 'running' && minutesLeft(s, now) <= 0)

  return (
    <section>
      <div className="gx-daynav">
        <button className="btn icon" aria-label="Previous day" onClick={() => setBack(back + 1)}>‹</button>
        <b>{back === 0 ? 'Today' : back === 1 ? 'Yesterday' : dayLabel(day)}</b>
        <button className="btn icon" aria-label="Next day" disabled={back === 0} onClick={() => setBack(back - 1)}>›</button>
      </div>
      {back > 0 && !past && <div className="card muted small">Loading…</div>}
      <div className="card">
        <div className="muted small">Collected · {dayLabel(day || now)}</div>
        <div className="gx-big">{rs(total)}</div>
        <div className="small"><span className="pos">Cash {rs(t.cash)}</span> · <span className="gx-ps">Online {rs(t.online)}</span></div>
        <div className="gx-bar cash"><i style={{ width: `${total ? (t.cash / total) * 100 : 0}%` }} /></div>
      </div>
      <div className="gx-kpis">
        <div className="gx-kpi"><b>{t.sessions}</b><span>Sessions done</span></div>
        <div className="gx-kpi"><b>{hoursLabel(t.minutes)}</b><span>Played</span></div>
        <div className="gx-kpi"><b>{rs(t.fnb)}</b><span>F&amp;B</span></div>
        <div className="gx-kpi"><b className={t.owed ? 'neg' : ''}>{rs(t.owed)}</b><span>Owed</span></div>
      </div>
      {overdue.length > 0 && (
        <div className="card gx-attn">
          <h3>Time up</h3>
          {overdue.map((s) => (
            <div key={s.id} className="line"><span>{s.system_name} · {s.customer_name}</span><button className="btn small" onClick={() => onOpen('floor')}>Floor</button></div>
          ))}
        </div>
      )}
      <div className="card">
        <div className="card-head"><h3>Hours played by system</h3><span className="muted small amt">{hoursLabel(t.minutes)}</span></div>
        <div className="gx-bars">
          {byKind.map((b) => (
            <div key={b.name}>
              <span className="amt small">{(b.mins / 60).toFixed(1)}</span>
              <i className={b.ps ? 'ps' : ''} style={{ height: `${Math.max(2, (b.mins / max) * 70)}px` }} />
              <span className="muted small">{b.name}</span>
            </div>
          ))}
        </div>
      </div>
      <Sessions sessions={shop.sessions} />
      {back === 0 && <div className="card">
        <h3>On shift now</h3>
        {shop.shifts.length === 0 ? <div className="muted small">Nobody is clocked in.</div> : (
          <div className="chips">{shop.shifts.map((s) => <span key={s.id} className="pill gx-pill free">{staff[s.user_id] || 'Staff'} · since {timeLabel(s.clock_in)}</span>)}</div>
        )}
      </div>}
      <DrawerCard shop={shop} from={day || dayStart()} />
    </section>
  )
}

// The day's sessions, newest first — the old sheet's rows.
function Sessions({ sessions }) {
  const [all, setAll] = useState(false)
  const rows = sessions.filter((s) => s.status === 'closed')
  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, 8)
  const mode = (s) => Number(s.owed) > 0 ? `owes ${rs(s.owed)}` : Number(s.paid_cash) && Number(s.paid_online) ? 'cash + online' : Number(s.paid_online) ? 'online' : 'cash'
  return (
    <div className="card">
      <div className="card-head"><h3>Sessions</h3><span className="muted small">{rows.length}</span></div>
      {shown.map((s) => (
        <div key={s.id} className="line">
          <span className={`gx-badge sm ${s.system_name.startsWith('PS') ? 'ps' : ''}`}>{s.system_name}</span>
          <div className="grow">
            <div className="gx-ellipsis">{s.customer_name}</div>
            <div className="muted small">{timeLabel(s.started_at)} · {durLabel(s.minutes)}{Number(s.fnb_before) + Number(s.fnb_while) ? ` · F&B ${rs(Number(s.fnb_before) + Number(s.fnb_while))}` : ''} · {mode(s)}</div>
          </div>
          <b className={Number(s.owed) > 0 ? 'neg' : ''}>{rs(sessionTotal(s))}</b>
        </div>
      ))}
      {rows.length > 8 && <button className="btn link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
    </div>
  )
}

function useStaffNames(householdId) {
  const [names, setNames] = useState({})
  useEffect(() => {
    supabase.from('household_members').select('user_id, username, display_name').eq('household_id', householdId)
      .then(({ data }) => setNames(Object.fromEntries((data || []).map((m) => [m.user_id, m.display_name || m.username]))))
  }, [householdId])
  return names
}
