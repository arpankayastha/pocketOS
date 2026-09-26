import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchTransactions } from '../lib/useFinanceData'
import { currentMonth, monthEnd, monthLabel, monthStart, money, shiftMonth } from '../lib/format'
import TransactionForm from './TransactionForm'

export default function Transactions({ accounts, categories }) {
  const [month, setMonth] = useState(currentMonth())
  const [filters, setFilters] = useState({ kind: '', categoryId: '', accountId: '', search: '' })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | row

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await fetchTransactions({ from: monthStart(month), to: monthEnd(month), ...filters }))
      setError(null)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [month, filters])

  useEffect(() => {
    const t = setTimeout(load, filters.search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, filters.search])

  const totals = useMemo(() => rows.reduce((acc, r) => {
    acc[r.kind] += Number(r.amount); return acc
  }, { income: 0, expense: 0 }), [rows])

  async function remove(row) {
    if (!confirm(`Delete this ${row.kind} of ${money(row.amount)}?`)) return
    const { error } = await supabase.from('transactions').delete().eq('id', row.id)
    if (error) return alert(error.message)
    load()
  }

  function exportCsv() {
    const head = ['Date', 'Type', 'Amount', 'Category', 'Account', 'Note']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = rows.map((r) => [r.occurred_on, r.kind, r.amount, r.category?.name, r.account?.name, r.note].map(esc).join(','))
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `transactions-${month}.csv` })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))

  return (
    <section>
      <div className="toolbar">
        <MonthPicker month={month} setMonth={setMonth} />
        <div className="spacer" />
        <button className="btn ghost" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        <button className="btn primary" onClick={() => setEditing('new')}>+ Add</button>
      </div>

      <div className="filters">
        <input placeholder="Search notes…" value={filters.search} onChange={setF('search')} />
        <select value={filters.kind} onChange={setF('kind')}>
          <option value="">All types</option><option value="expense">Expense</option><option value="income">Income</option>
        </select>
        <select value={filters.categoryId} onChange={setF('categoryId')}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
        </select>
        <select value={filters.accountId} onChange={setF('accountId')}>
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="summary">
        <span>In <b className="pos">{money(totals.income)}</b></span>
        <span>Out <b className="neg">{money(totals.expense)}</b></span>
        <span>Net <b>{money(totals.income - totals.expense)}</b></span>
      </div>

      {error && <div className="alert error">{error}</div>}
      <div className="card list">
        {loading ? <div className="muted pad">Loading…</div> : rows.length === 0 ? (
          <div className="muted pad">No transactions in {monthLabel(month)}.</div>
        ) : rows.map((r) => (
          <div className="txn" key={r.id}>
            <span className="dot" style={{ background: r.category?.color || '#94a3b8' }} />
            <div className="grow">
              <div>{r.note || r.category?.name || 'Uncategorised'}</div>
              <div className="muted small">{r.occurred_on} · {r.category?.name || 'Uncategorised'}{r.account ? ` · ${r.account.name}` : ''}</div>
            </div>
            <div className={`amt ${r.kind === 'income' ? 'pos' : 'neg'}`}>{r.kind === 'income' ? '+' : '−'}{money(r.amount)}</div>
            <button className="btn icon" title="Edit" onClick={() => setEditing(r)}>✎</button>
            <button className="btn icon" title="Delete" onClick={() => remove(r)}>✕</button>
          </div>
        ))}
      </div>

      {editing && (
        <TransactionForm accounts={accounts} categories={categories}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }} />
      )}
    </section>
  )
}

export function MonthPicker({ month, setMonth }) {
  return (
    <div className="month">
      <button className="btn icon" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
      <strong>{monthLabel(month)}</strong>
      <button className="btn icon" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
    </div>
  )
}
