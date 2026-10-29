import { useEffect, useMemo, useState } from 'react'
import { customerKey, durLabel, rs, sessionTotal } from '../../lib/shop'
import { customerSummary } from '../../lib/reports'
import { loadCustomers } from '../../lib/adminData'
import { telLink, waLink } from '../../lib/products'
import { ActionSheet, Chips } from '../shop/ui'
import { downloadCsv, ymd } from './MonthPicker'

// Portal → Customers (new, 29 Oct): everyone who has played — visits, money spent, last visit, deposit left and
// dues — from the sessions themselves (same customer = same mobile, else same name). Tap one for their visits.
const SORTS = [['recent', 'Recent'], ['spent', 'Top spenders'], ['visits', 'Most visits'], ['deposit', 'With deposit'], ['dues', 'With dues']]
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—')

export default function Customers({ householdId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('recent')
  const [open, setOpen] = useState(null)
  const [limit, setLimit] = useState(60)
  useEffect(() => { loadCustomers(householdId).then(setData, (e) => setError(e.message)) }, [householdId])
  const all = useMemo(() => data && customerSummary(data.sessions, data.deposits, data.dues), [data])
  const list = useMemo(() => {
    if (!all) return []
    const t = q.trim().toLowerCase(), d = q.replace(/\D/g, '')
    let r = all.filter((c) => !t || c.name.toLowerCase().includes(t) || (d.length >= 3 && (c.phone || '').includes(d)))
    if (sort === 'spent') r = [...r].sort((a, b) => b.spent - a.spent)
    if (sort === 'visits') r = [...r].sort((a, b) => b.visits - a.visits)
    if (sort === 'deposit') r = r.filter((c) => c.deposit > 0.5).sort((a, b) => b.deposit - a.deposit)
    if (sort === 'dues') r = r.filter((c) => c.dues > 0.5).sort((a, b) => b.dues - a.dues)
    return r
  }, [all, q, sort])
  if (error) return <div className="alert error">{error}</div>
  if (!all) return <div className="card muted">Loading customers…</div>
  const exportCsv = () => downloadCsv(`grandxgamer-customers-${ymd(new Date())}`, [['name', 'Name'], ['phone', 'Mobile'], ['visits', 'Visits'], ['spent', 'Spent ₹'],
    [(c) => Math.round(c.minutes / 6) / 10, 'Hours played'], [(c) => c.first && ymd(c.first), 'First visit'], [(c) => c.last && ymd(c.last), 'Last visit'], ['deposit', 'Deposit left ₹'], ['dues', 'Dues ₹']], list)
  const visits = open ? data.sessions.filter((s) => customerKey(s.customer_name?.replace(/ \(\d+\/\d+\)$/, ''), s.customer_phone) === open.key).reverse() : []

  return (
    <section className="admin-sec">
      <div className="gx-kpis admin-kpis">
        <div className="gx-kpi"><b>{all.length}</b><span>Customers</span></div>
        <div className="gx-kpi"><b>{all.filter((c) => c.visits > 1).length}</b><span>Came back</span></div>
        <div className="gx-kpi"><b>{rs(all.reduce((a, c) => a + Math.max(0, c.deposit), 0))}</b><span>Deposits held</span></div>
        <div className="gx-kpi"><b>{rs(all.reduce((a, c) => a + c.dues, 0))}</b><span>Dues to collect</span></div>
      </div>
      <div className="admin-row">
        <input className="admin-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or mobile" />
        <button className="btn small" onClick={exportCsv}>Export to Excel</button>
      </div>
      <Chips scroll options={SORTS} value={sort} onChange={setSort} />
      <div className="card admin-table-card">
        <table className="admin-table click">
          <thead><tr><th>Customer</th><th>Visits</th><th>Spent</th><th className="wide">Last visit</th><th className="wide">Deposit</th><th className="wide">Dues</th></tr></thead>
          <tbody>{list.slice(0, limit).map((c) => (
            <tr key={c.key} onClick={() => setOpen(c)}>
              <td><b>{c.name}</b><div className="muted small">{c.phone || 'no mobile'}<span className="narrow"> · {day(c.last)}</span></div></td>
              <td>{c.visits}</td><td>{rs(c.spent)}</td><td className="wide">{day(c.last)}</td>
              <td className="wide">{c.deposit > 0.5 ? <span className="pos">{rs(c.deposit)}</span> : '—'}</td>
              <td className="wide">{c.dues > 0.5 ? <span className="neg">{rs(c.dues)}</span> : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        {list.length === 0 && <div className="muted small" style={{ padding: 12 }}>No customers match.</div>}
      </div>
      {list.length > limit && <button className="btn block" onClick={() => setLimit(limit + 100)}>Show more ({list.length - limit} left)</button>}
      {open && (
        <ActionSheet title={open.name} sub={`${open.phone || 'No mobile'} · first came ${day(open.first)}`} onClose={() => setOpen(null)}>
          <div className="gx-skpis">
            <div><span>Visits</span><b>{open.visits}</b></div>
            <div><span>Spent</span><b>{rs(open.spent)}</b></div>
            <div><span>Played</span><b>{durLabel(open.minutes)}</b></div>
          </div>
          <div className="gx-details">
            <div><span>Deposit left</span><b className={open.deposit > 0.5 ? 'pos' : ''}>{rs(Math.max(0, open.deposit))}</b></div>
            <div><span>Dues</span><b className={open.dues > 0.5 ? 'neg' : ''}>{rs(open.dues)}</b></div>
          </div>
          {open.phone && <div className="gx-btns"><a className="btn small" href={telLink(open.phone)}>Call</a><a className="btn small" href={waLink(open.phone, `Hi ${open.name}, `)} target="_blank" rel="noreferrer">WhatsApp</a></div>}
          <div className="caps muted">Visits</div>
          <div className="gx-details">{visits.slice(0, 30).map((s) => (
            <div key={s.id}><span>{day(s.started_at)} · {s.system_name} · {durLabel(s.minutes)}{s.entered_by ? ` · ${s.entered_by}` : ''}</span><b>{rs(sessionTotal(s))}</b></div>
          ))}</div>
          {visits.length > 30 && <div className="muted small">and {visits.length - 30} older visits</div>}
        </ActionSheet>
      )}
    </section>
  )
}
