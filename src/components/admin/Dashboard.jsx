import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { addDays, dayStart, dayTotals, depositBalances, duesByCustomer, minutesLeft, rs, timeLabel, useNow } from '../../lib/shop'
import { dailyRows } from '../../lib/reports'
import { useRange } from '../../lib/adminData'

// Portal → Dashboard: "how is the shop doing right now, and what needs me?" in one look. Each tile opens its section.
export default function Dashboard({ shop, householdId, onOpen, onCounter }) {
  const now = useNow(30_000)
  const today = dayStart()
  const t = dayTotals(shop)
  const running = shop.sessions.filter((s) => s.status === 'running')
  const playing = running.filter((s) => !s.waiting)
  const seats = shop.systems.reduce((a, x) => a + (x.seats || 1) - (x.off_seats || []).filter((n) => n <= (x.seats || 1)).length, 0)
  const busy = running.reduce((a, s) => a + Math.max(1, Number(s.players) || 1), 0)
  const ending = playing.filter((s) => !s.paused_at && minutesLeft(s, now) <= 10).sort((a, b) => minutesLeft(a, now) - minutesLeft(b, now))

  // Staff on duty (one at a time) and when the 6-hour auto log-out ends their shift.
  const [names, setNames] = useState({})
  useEffect(() => {
    supabase.from('household_members').select('user_id, display_name, username').eq('household_id', householdId)
      .then(({ data }) => setNames(Object.fromEntries((data || []).map((m) => [m.user_id, m.display_name || m.username]))))
  }, [householdId])
  const duty = shop.shifts[0]

  // Today's Daily check, for the "Needs you" list.
  const [health, setHealth] = useState(null)
  useEffect(() => {
    supabase.rpc('shop_health', { p_household: householdId, p_day: today.toLocaleDateString('en-CA') }).then(({ data }) => setHealth(data))
  }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps

  // This month so far vs the same days last month.
  const monthFrom = new Date(today.getFullYear(), today.getMonth(), 1)
  const tomorrow = addDays(today, 1)
  const days = Math.round((tomorrow - monthFrom) / 86_400_000)
  const lastFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastTo = addDays(lastFrom, days)
  const cur = useRange(householdId, monthFrom, tomorrow)
  const prev = useRange(householdId, lastFrom, lastTo)
  const curT = useMemo(() => cur.data && dailyRows(cur.data, monthFrom, tomorrow).totals, [cur.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const prevT = useMemo(() => prev.data && dailyRows(prev.data, lastFrom, lastTo).totals, [prev.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const change = curT && prevT && prevT.total ? Math.round(((curT.total - prevT.total) / prevT.total) * 100) : null

  const toCheck = shop.bookings.filter((b) => b.status === 'requested').length + shop.eventChecks.length + shop.entryChecks.length
  const unmatched = (shop.paymentsIn || []).filter((p) => p.status === 'new').length
  const dues = duesByCustomer(shop.dues)
  const oldDues = dues.filter((d) => d.sessions.some((s) => new Date(s.started_at) < addDays(today, -7)))
  const deposits = depositBalances(shop.deposits)
  const bad = (health?.checks || []).filter((c) => !c.ok)
  const needs = [
    bad.length > 0 && { label: `Daily check: ${bad.map((c) => c.label.toLowerCase()).join(', ')}`, to: 'sales' },
    toCheck > 0 && { label: `${toCheck} online payment${toCheck === 1 ? '' : 's'} to confirm`, to: 'bookings' },
    unmatched > 0 && { label: `${unmatched} UPI payment${unmatched === 1 ? '' : 's'} from the bank not matched`, to: 'sales' },
    oldDues.length > 0 && { label: `${oldDues.length} customer${oldDues.length === 1 ? ' owes' : 's owe'} for more than 7 days · ${rs(oldDues.reduce((a, d) => a + d.total, 0))}`, to: 'customers' },
  ].filter(Boolean)

  return (
    <section className="admin-dash">
      <div className="admin-tiles">
        <button className="card gx-tile" onClick={() => onOpen('sales')}>
          <span className="muted small">Money in today</span><b>{rs(t.cash + t.online)}</b>
          <span className="small muted gx-tile-sub">cash {rs(t.cash)} · online {rs(t.online)}</span>
        </button>
        <button className="card gx-tile" onClick={onCounter}>
          <span className="muted small">Playing now</span><b>{busy} / {seats}</b>
          <span className="small muted gx-tile-sub">{seats - busy} free · open the counter ›</span>
        </button>
        <button className="card gx-tile" onClick={() => onOpen('staff')}>
          <span className="muted small">On duty</span><b>{duty ? names[duty.user_id] || duty.staff_name || 'Staff' : 'Nobody'}</b>
          <span className="small muted gx-tile-sub">{duty ? `since ${timeLabel(duty.clock_in)} · auto log-out ${timeLabel(new Date(new Date(duty.clock_in).getTime() + 6 * 3600_000))}` : 'no shift open'}</span>
        </button>
        <button className={`card gx-tile ${needs.length ? 'ending' : ''}`} onClick={() => needs[0] && onOpen(needs[0].to)}>
          <span className="muted small">Needs you</span><b className={needs.length ? 'neg' : 'pos'}>{needs.length || '✓'}</b>
          <span className="small muted gx-tile-sub">{needs.length ? 'see below' : 'all clear'}</span>
        </button>
      </div>

      <div className="gx-split even">
        <div className="gx-col">
          <div className="card">
            <div className="card-head"><h3>Needs you</h3></div>
            {needs.length === 0 ? <div className="muted small">Nothing waiting. The Daily check is all ✓, payments are confirmed and matched.</div>
              : needs.map((n) => <button key={n.label} type="button" className="line gx-linebtn" onClick={() => onOpen(n.to)}><span>{n.label}</span><b>›</b></button>)}
          </div>
          <div className="card">
            <div className="card-head"><h3>Ending in 10 minutes</h3><button className="btn small" onClick={onCounter}>Counter</button></div>
            {ending.length === 0 ? <div className="muted small">Nobody is about to finish.</div> : ending.map((s) => (
              <div key={s.id} className="line"><span>{s.system_name}{s.system_name.startsWith('PS') ? ` · C${s.seat || 1}` : ''} · {s.customer_name}</span><b>{Math.max(0, Math.ceil(minutesLeft(s, now)))} min</b></div>
            ))}
          </div>
        </div>
        <div className="gx-col">
          <div className="card">
            <div className="card-head"><h3>This month so far</h3><button className="btn small" onClick={() => onOpen('reports')}>Reports</button></div>
            {!curT ? <div className="muted small">Loading…</div> : (<>
              <div className="gx-big">{rs(curT.total)}</div>
              <div className="small muted">{change === null ? 'No takings in the same days last month to compare.' : <>{change >= 0 ? <b className="pos">+{change}%</b> : <b className="neg">{change}%</b>} vs the first {days} days of last month ({rs(prevT.total)})</>}</div>
              <div className="gx-skpis" style={{ marginTop: 10 }}>
                <div><span>Cash</span><b>{rs(curT.cash)}</b></div>
                <div><span>Online</span><b>{rs(curT.online)}</b></div>
                <div><span>Sessions</span><b>{curT.sessions}</b></div>
              </div>
            </>)}
          </div>
          <div className="card">
            <div className="card-head"><h3>Money held for customers</h3><button className="btn small" onClick={() => onOpen('customers')}>Customers</button></div>
            <div className="line"><span>Deposits left · {deposits.length} customer{deposits.length === 1 ? '' : 's'}</span><b>{rs(deposits.reduce((a, d) => a + d.balance, 0))}</b></div>
            <div className="line"><span>Dues to collect · {dues.length} customer{dues.length === 1 ? '' : 's'}</span><b className={dues.length ? 'neg' : ''}>{rs(dues.reduce((a, d) => a + d.total, 0))}</b></div>
          </div>
        </div>
      </div>
    </section>
  )
}
