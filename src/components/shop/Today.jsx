import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { dayLabel, dayTotals, hoursLabel, minutesLeft, timeLabel, useNow, rs } from '../../lib/shop'
import { DrawerCard } from './Cash'

// Admin's first screen: today's money, sessions, hours by system, who is on shift, and the drawer.
export default function Today({ shop, householdId, onOpen }) {
  const now = useNow(30_000)
  const t = dayTotals(shop)
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
      <div className="card">
        <div className="muted small">Collected today · {dayLabel(now)}</div>
        <div className="gx-big">{rs(total)}</div>
        <div className="small"><span className="pos">Cash {rs(t.cash)}</span> · <span className="gx-ps">Online {rs(t.online)}</span></div>
        <div className="gx-bar cash"><i style={{ width: `${total ? (t.cash / total) * 100 : 0}%` }} /></div>
      </div>
      <div className="gx-kpis">
        <div className="gx-kpi"><b>{t.sessions}</b><span>Sessions done</span></div>
        <div className="gx-kpi"><b>{hoursLabel(t.minutes)}</b><span>Played</span></div>
        <div className="gx-kpi"><b>{rs(t.fnb)}</b><span>F&amp;B</span></div>
        <div className="gx-kpi"><b className={t.owed ? 'neg' : ''}>{rs(t.owed)}</b><span>Owed today</span></div>
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
      <div className="card">
        <h3>On shift now</h3>
        {shop.shifts.length === 0 ? <div className="muted small">Nobody is clocked in.</div> : (
          <div className="chips">{shop.shifts.map((s) => <span key={s.id} className="pill gx-pill free">{staff[s.user_id] || 'Staff'} · since {timeLabel(s.clock_in)}</span>)}</div>
        )}
      </div>
      <DrawerCard shop={shop} />
    </section>
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
