import { useMemo, useState } from 'react'
import { rs, sessionTotal } from '../../lib/shop'
import { byKind, byStaff, bySystem, dailyRows } from '../../lib/reports'
import { useRange } from '../../lib/adminData'
import { downloadCsv, MonthPicker, useMonthRange, ymd } from './MonthPicker'

// Portal → Reports: a month at a glance — money in, bills by PC / PS5, by system and by staff, F&B, events —
// each exportable to Excel (CSV). Bills = what customers were charged; money in = what was paid that month.
const GROUP_COLS = [['key', 'Name'], ['sessions', 'Sessions'], [(r) => Math.round(r.minutes / 6) / 10, 'Hours'], ['bill', 'Billed ₹'], ['paid', 'Paid ₹'], ['fnb', 'F&B ₹']]

export default function Reports({ householdId }) {
  const [offset, setOffset] = useState(0)
  const { from, to, label } = useMonthRange(offset)
  const { data, error } = useRange(householdId, from, to)
  const rep = useMemo(() => {
    if (!data) return null
    const s = data.sessions
    return {
      days: dailyRows(data, from, to), kind: byKind(s), system: bySystem(s), staff: byStaff(s),
      bill: s.reduce((a, x) => a + sessionTotal(x), 0), discount: s.reduce((a, x) => a + Number(x.discount || 0), 0),
      advances: data.advances.reduce((a, x) => a + Number(x.advance_paid), 0), fees: data.entries.reduce((a, x) => a + Number(x.fee), 0),
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const month = ymd(from).slice(0, 7)
  const exportSessions = () => downloadCsv(`grandxgamer-sessions-${month}`, [
    [(s) => ymd(s.started_at), 'Date'], [(s) => new Date(s.started_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }), 'Start'], ['system_name', 'System'],
    ['customer_name', 'Customer'], ['customer_phone', 'Mobile'], ['minutes', 'Minutes'], ['gaming_amount', 'Gaming ₹'], ['extend_amount', 'Extend ₹'],
    [(s) => Number(s.fnb_before) + Number(s.fnb_while), 'F&B ₹'], ['discount', 'Discount ₹'], [(s) => sessionTotal(s), 'Bill ₹'], ['paid_cash', 'Cash ₹'],
    ['paid_online', 'Online ₹'], ['paid_deposit', 'From deposit ₹'], ['owed', 'Dues ₹'], ['entered_by', 'Taken by'], ['status', 'Status']], data.sessions)

  return (
    <section className="admin-sec">
      <div className="admin-row">
        <MonthPicker offset={offset} setOffset={setOffset} label={label} />
        <button className="btn small" disabled={!rep} onClick={exportSessions}>Export all sessions</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {!rep ? <div className="card muted">Loading…</div> : (<>
        <div className="gx-kpis admin-kpis">
          <div className="gx-kpi"><b>{rs(rep.days.totals.total)}</b><span>Money in</span></div>
          <div className="gx-kpi"><b>{rs(rep.bill)}</b><span>Billed{rep.discount ? ` · ${rs(rep.discount)} discount` : ''}</span></div>
          <div className="gx-kpi"><b>{rep.days.totals.sessions}</b><span>Sessions · {Math.round(rep.days.totals.minutes / 60)} h</span></div>
          <div className="gx-kpi"><b>{rs(rep.days.totals.fnb)}</b><span>F&amp;B sold</span></div>
        </div>
        <div className="gx-split even">
          <div className="gx-col">
            <Group title="PC vs PS5" rows={rep.kind} total={rep.bill} onExport={() => downloadCsv(`grandxgamer-pc-ps5-${month}`, GROUP_COLS, rep.kind)} />
            <Group title="By system" rows={rep.system} total={rep.bill} onExport={() => downloadCsv(`grandxgamer-systems-${month}`, GROUP_COLS, rep.system)} />
          </div>
          <div className="gx-col">
            <Group title="By staff (who took the customer)" rows={rep.staff} total={rep.bill} onExport={() => downloadCsv(`grandxgamer-staff-${month}`, GROUP_COLS, rep.staff)} />
            <div className="card">
              <div className="card-head"><h3>Other money</h3></div>
              <div className="line"><span>Event advances</span><b>{rs(rep.advances)}</b></div>
              <div className="line"><span>Tournament entry fees (confirmed)</span><b>{rs(rep.fees)}</b></div>
              <div className="line"><span>Deposits paid in</span><b>{rs(rep.days.totals.deposits)}</b></div>
              <div className="line"><span>Deposits returned</span><b>{rs(rep.days.totals.refunds)}</b></div>
              <div className="line"><span>Dues collected</span><b>{rs(rep.days.totals.duesIn)}</b></div>
              <div className="line"><span>New dues (still owed from this month)</span><b className="neg">{rs(rep.days.totals.owed)}</b></div>
              <div className="line"><span>Cash paid out from the drawer</span><b>{rs(rep.days.totals.out)}</b></div>
            </div>
          </div>
        </div>
      </>)}
    </section>
  )
}

function Group({ title, rows, total, onExport }) {
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3><button className="btn small" onClick={onExport}>Excel</button></div>
      {rows.length === 0 ? <div className="muted small">No sessions.</div> : rows.map((r) => (
        <div key={r.key} className="admin-bar">
          <div className="admin-bar-top"><span>{r.key} · {r.sessions} session{r.sessions === 1 ? '' : 's'} · {Math.round(r.minutes / 60)} h</span><b>{rs(r.bill)}</b></div>
          <div className="admin-bar-track"><i style={{ width: `${total ? Math.max(2, (r.bill / total) * 100) : 0}%` }} /></div>
        </div>
      ))}
    </div>
  )
}
