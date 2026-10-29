import { useMemo, useState } from 'react'
import { rs } from '../../lib/shop'
import { dailyRows } from '../../lib/reports'
import { useRange } from '../../lib/adminData'
import { Chips } from '../shop/ui'
import Today from '../shop/Today'
import Cash from '../shop/Cash'
import { downloadCsv, MonthPicker, useMonthRange, ymd } from './MonthPicker'

// Portal → Sales: a day (the counter's Today: sessions, drawer, dues, Daily check, ‹ › days), the cash book
// (cash in / out, deposits, dues, UPI received from the bank SMS) and the month, day by day.
export default function Sales({ shop, householdId, toast }) {
  const [view, setView] = useState('day')
  return (
    <section className="admin-sec">
      <Chips options={[['day', 'Day'], ['cash', 'Cash, deposits & dues'], ['month', 'Month']]} value={view} onChange={setView} />
      {view === 'day' && <div className="gx admin-embed"><Today shop={shop} householdId={householdId} toast={toast} onOpen={() => {}} /></div>}
      {view === 'cash' && <div className="gx admin-embed"><Cash shop={shop} householdId={householdId} toast={toast} admin /></div>}
      {view === 'month' && <MonthSales householdId={householdId} />}
    </section>
  )
}

const COLS = [
  [(r) => ymd(r.day), 'Date'], ['sessions', 'Sessions'], [(r) => Math.round(r.minutes / 6) / 10, 'Hours'], ['cash', 'Cash ₹'], ['online', 'Online ₹'],
  ['total', 'Money in ₹'], ['fnb', 'F&B ₹'], ['deposits', 'Deposits in ₹'], ['refunds', 'Deposits returned ₹'], ['duesIn', 'Dues collected ₹'], ['owed', 'New dues ₹'], ['out', 'Cash out ₹'],
]

function MonthSales({ householdId }) {
  const [offset, setOffset] = useState(0)
  const { from, to, label } = useMonthRange(offset)
  const { data, error } = useRange(householdId, from, to)
  const rep = useMemo(() => data && dailyRows(data, from, to), [data]) // eslint-disable-line react-hooks/exhaustive-deps
  return (<>
    <div className="admin-row">
      <MonthPicker offset={offset} setOffset={setOffset} label={label} />
      <button className="btn small" disabled={!rep} onClick={() => downloadCsv(`grandxgamer-sales-${ymd(from).slice(0, 7)}`, COLS, rep.rows)}>Export to Excel</button>
    </div>
    {error && <div className="alert error">{error}</div>}
    {!rep ? <div className="card muted">Loading…</div> : (<>
      <div className="gx-kpis admin-kpis">
        <div className="gx-kpi"><b>{rs(rep.totals.total)}</b><span>Money in</span></div>
        <div className="gx-kpi"><b>{rs(rep.totals.cash)}</b><span>Cash</span></div>
        <div className="gx-kpi"><b>{rs(rep.totals.online)}</b><span>Online</span></div>
        <div className="gx-kpi"><b>{rep.totals.sessions}</b><span>Sessions · {Math.round(rep.totals.minutes / 60)} h</span></div>
      </div>
      <div className="card admin-table-card">
        <table className="admin-table">
          <thead><tr><th>Date</th><th>Sessions</th><th>Cash</th><th>Online</th><th>Money in</th><th className="wide">F&amp;B</th><th className="wide">Deposits in</th><th className="wide">Dues collected</th><th className="wide">New dues</th><th className="wide">Cash out</th></tr></thead>
          <tbody>{[...rep.rows].reverse().map((r) => (
            <tr key={r.day.toISOString()} className={r.total ? '' : 'muted'}>
              <td>{r.day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</td>
              <td>{r.sessions}</td><td>{rs(r.cash)}</td><td>{rs(r.online)}</td><td><b>{rs(r.total)}</b></td>
              <td className="wide">{rs(r.fnb)}</td><td className="wide">{rs(r.deposits)}</td><td className="wide">{rs(r.duesIn)}</td><td className="wide">{rs(r.owed)}</td><td className="wide">{rs(r.out)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td>Total</td><td>{rep.totals.sessions}</td><td>{rs(rep.totals.cash)}</td><td>{rs(rep.totals.online)}</td><td><b>{rs(rep.totals.total)}</b></td>
            <td className="wide">{rs(rep.totals.fnb)}</td><td className="wide">{rs(rep.totals.deposits)}</td><td className="wide">{rs(rep.totals.duesIn)}</td><td className="wide">{rs(rep.totals.owed)}</td><td className="wide">{rs(rep.totals.out)}</td></tr></tfoot>
        </table>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Money in = what was paid that day (sessions, deposits paid in, dues collected; deposits returned taken off), the same as the counter's Today.</p>
    </>)}
  </>)
}
