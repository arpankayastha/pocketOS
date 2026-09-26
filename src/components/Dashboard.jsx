import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { currentMonth, monthEnd, monthKey, monthLabel, monthStart, money, moneyShort, shiftMonth } from '../lib/format'
import { MonthPicker } from './Transactions'
import TransactionForm from './TransactionForm'

export default function Dashboard({ accounts, categories }) {
  const [month, setMonth] = useState(currentMonth())
  const [all, setAll] = useState([])
  const [budgets, setBudgets] = useState([])
  const [balances, setBalances] = useState([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const [t, b, ab] = await Promise.all([
      supabase.from('transactions')
        .select('id, kind, amount, occurred_on, note, category_id')
        .gte('occurred_on', monthStart(shiftMonth(month, -5)))
        .lte('occurred_on', monthEnd(month))
        .order('occurred_on', { ascending: false })
        .limit(10000),
      supabase.from('budgets').select('*').eq('month', monthStart(month)),
      supabase.from('account_balances').select('*').order('name'),
    ])
    const err = t.error || b.error || ab.error
    setError(err ? err.message : null)
    setAll(t.data || [])
    setBudgets(b.data || [])
    setBalances((ab.data || []).map((a) => ({ ...a, balance: Number(a.balance) })))
  }, [month])

  useEffect(() => { load() }, [load])

  const catById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])

  const stats = useMemo(() => {
    const inMonth = all.filter((t) => monthKey(t.occurred_on) === month)
    const income = sum(inMonth.filter((t) => t.kind === 'income'))
    const expense = sum(inMonth.filter((t) => t.kind === 'expense'))

    const netWorth = balances.reduce((s, a) => s + a.balance, 0)

    // Last 6 months trend
    const trend = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((ym) => {
      const txs = all.filter((t) => monthKey(t.occurred_on) === ym)
      return { month: monthLabel(ym), Income: sum(txs.filter((t) => t.kind === 'income')), Expense: sum(txs.filter((t) => t.kind === 'expense')) }
    })

    // Expense by category
    const byCat = {}
    inMonth.filter((t) => t.kind === 'expense').forEach((t) => {
      const k = t.category_id || 'none'
      byCat[k] = (byCat[k] || 0) + Number(t.amount)
    })
    const breakdown = Object.entries(byCat)
      .map(([id, value]) => ({ name: catById[id]?.name || 'Uncategorised', color: catById[id]?.color || '#94a3b8', value }))
      .sort((a, b) => b.value - a.value)

    const budgetTotal = budgets.reduce((s, b) => s + Number(b.amount), 0)
    return { income, expense, netWorth, trend, breakdown, recent: inMonth.slice(0, 6), budgetTotal }
  }, [all, balances, month, catById, budgets])

  const savingsRate = stats.income > 0 ? Math.round(((stats.income - stats.expense) / stats.income) * 100) : null

  return (
    <section>
      <div className="toolbar">
        <MonthPicker month={month} setMonth={setMonth} />
        <div className="spacer" />
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add transaction</button>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="tiles">
        <Tile label="Income" value={money(stats.income)} tone="pos" />
        <Tile label="Expenses" value={money(stats.expense)} tone="neg"
          sub={stats.budgetTotal ? `${Math.round((stats.expense / stats.budgetTotal) * 100)}% of ${money(stats.budgetTotal)} budget` : null} />
        <Tile label="Net savings" value={money(stats.income - stats.expense)} sub={savingsRate !== null ? `${savingsRate}% savings rate` : null} />
        <Tile label="Net worth" value={money(stats.netWorth)} sub={`today, across ${balances.length} account${balances.length === 1 ? '' : 's'}`} />
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Last 6 months</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats.trend} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={moneyShort} tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={64} />
              <Tooltip formatter={(v) => money(v)} contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="Income" fill="var(--pos)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expense" fill="var(--neg)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>Where the money went</h3>
          {stats.breakdown.length === 0 ? <div className="muted pad">No expenses this month.</div> : (
            <div className="pie-wrap">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={stats.breakdown} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {stats.breakdown.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => money(v)} contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="legend">
                {stats.breakdown.slice(0, 6).map((d) => (
                  <li key={d.name}><span className="dot" style={{ background: d.color }} />{d.name}<b>{money(d.value)}</b></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Account balances <span className="muted small">(today)</span></h3>
          {balances.map((a) => (
            <div className="line" key={a.id}><span>{a.name} <span className="muted small">{a.type}</span></span><b className={a.balance < 0 ? 'neg' : ''}>{money(a.balance)}</b></div>
          ))}
        </div>
        <div className="card">
          <h3>Recent</h3>
          {stats.recent.length === 0 ? <div className="muted">Nothing yet this month.</div> : stats.recent.map((t) => (
            <div className="line" key={t.id}>
              <span>{t.note || catById[t.category_id]?.name || 'Uncategorised'} <span className="muted small">{t.occurred_on}</span></span>
              <b className={t.kind === 'income' ? 'pos' : 'neg'}>{t.kind === 'income' ? '+' : '−'}{money(t.amount)}</b>
            </div>
          ))}
        </div>
      </div>

      {adding && (
        <TransactionForm accounts={accounts} categories={categories}
          onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />
      )}
    </section>
  )
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className="card tile">
      <div className="muted small">{label}</div>
      <div className={`big-num ${tone || ''}`}>{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  )
}

const sum = (arr) => arr.reduce((s, t) => s + Number(t.amount), 0)
