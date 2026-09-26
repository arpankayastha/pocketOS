import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchTransactions } from '../lib/useFinanceData'
import { useMonthSwipe } from '../lib/useSwipe'
import { currentMonth, monthEnd, monthLabel, monthStart, money, shiftMonth } from '../lib/format'
import TransactionForm from './TransactionForm'
import TransferForm from './TransferForm'
import { deleteTransfer, transferCounterparts } from '../lib/transfers'
import { useDialog } from '../lib/dialog'
import { SkeletonRows } from './Skeleton'
import { PencilIcon, TrashIcon } from '../lib/icons'

export default function Transactions({ accounts, categories, activeHouseholdId, households }) {
  const [month, setMonth] = useState(currentMonth())
  const [filters, setFilters] = useState({ kind: '', categoryId: '', accountId: '', search: '' })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // null | row being edited
  const [counterparts, setCounterparts] = useState({}) // transfer_id → other household id
  const dialog = useDialog()

  const load = useCallback(async () => {
    if (!activeHouseholdId) return
    setLoading(true)
    try {
      const data = await fetchTransactions({ householdId: activeHouseholdId, from: monthStart(month), to: monthEnd(month), ...filters })
      setRows(data)
      setCounterparts(await transferCounterparts(data.filter((r) => r.transfer_id).map((r) => r.transfer_id), activeHouseholdId))
      setError(null)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [month, filters, activeHouseholdId])

  useEffect(() => {
    const t = setTimeout(load, filters.search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, filters.search])

  const totals = useMemo(() => rows.reduce((acc, r) => {
    acc[r.kind] += Number(r.amount); return acc
  }, { income: 0, expense: 0 }), [rows])

  async function remove(row) {
    if (row.transfer_id) {
      if (!await dialog.confirm({ title: 'Delete transfer?', message: `This transfer of ${money(row.amount)} is removed from both households.` })) return
      try { await deleteTransfer(row.transfer_id) } catch (err) { return dialog.alert(err.message) }
      return load()
    }
    const what = row.note || row.category?.name || row.kind
    if (!await dialog.confirm({ title: `Delete ${row.kind}?`, message: `"${what}" · ${money(row.amount)} on ${row.occurred_on}. This can't be undone.` })) return
    const { error } = await supabase.from('transactions').delete().eq('id', row.id)
    if (error) return dialog.alert(error.message)
    load()
  }

  const householdName = (id) => households?.find((h) => h.id === id)?.name || 'another household'
  const transferLabel = (r) => `⇄ ${r.kind === 'expense' ? 'to' : 'from'} ${householdName(counterparts[r.transfer_id])}`

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
  const swipe = useMonthSwipe(month, setMonth)

  return (
    <section {...swipe}>
      <div className="toolbar">
        <MonthPicker month={month} setMonth={setMonth} />
        <div className="spacer" />
        <button className="btn ghost" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
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
        {loading ? <SkeletonRows rows={5} /> : rows.length === 0 ? (
          <div className="muted pad">No transactions in {monthLabel(month)}.</div>
        ) : rows.map((r) => (
          <div className="txn" key={r.id}>
            <span className="dot" style={{ background: r.category?.color || '#94a3b8' }} />
            <div className="grow">
              <div>{r.note || (r.transfer_id ? 'Home transfer' : r.category?.name || 'Uncategorised')}</div>
              <div className="muted small">{r.occurred_on} · {r.transfer_id ? <span className="transfer-tag">{transferLabel(r)}</span> : (r.category?.name || 'Uncategorised')}{r.account ? ` · ${r.account.name}` : ''}</div>
            </div>
            <div className={`amt ${r.kind === 'income' ? 'pos' : 'neg'}`}>{r.kind === 'income' ? '+' : '−'}{money(r.amount)}</div>
            <button className="btn icon" title="Edit" onClick={() => setEditing(r)}><PencilIcon /></button>
            <button className="btn icon" title="Delete" onClick={() => remove(r)}><TrashIcon /></button>
          </div>
        ))}
      </div>

      {editing?.transfer_id && (
        <TransferForm households={households} fromHouseholdId={activeHouseholdId} transferId={editing.transfer_id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }} />
      )}
      {editing && !editing.transfer_id && (
        <TransactionForm accounts={accounts} categories={categories} householdId={activeHouseholdId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }} />
      )}
    </section>
  )
}

// Optional `min`/`max` ('YYYY-MM') bound the range. Pair with `useMonthSwipe` (lib/useSwipe) for swiping.
export function MonthPicker({ month, setMonth, min, max }) {
  return (
    <div className="month">
      <button className="btn icon" aria-label="Previous month" disabled={!!min && month <= min} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
      <strong key={month} className="month-label">{monthLabel(month)}</strong>
      <button className="btn icon" aria-label="Next month" disabled={!!max && month >= max} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
    </div>
  )
}

