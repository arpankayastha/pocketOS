import { useCallback, useEffect, useMemo, useState } from 'react'
import { TrendChart, DonutChart } from './LazyCharts'
import { supabase } from '../lib/supabase'
import { currentMonth, monthEnd, monthKey, monthLabel, monthStart, money, shiftMonth } from '../lib/format'
import { MonthPicker } from './Transactions'
import { DashboardSkeleton } from './Skeleton'
import { useMonthSwipe } from '../lib/useSwipe'

// Forward-looking report: only last month, this month and next month. Next month is the
// plan (recurring commitments at their expected amounts, or the actual once logged).
// Accounts are used as sub-category buckets (e.g. "Bills", "Mutual Fund"), not bank balances,
// so they're shown as money spent / received through each in the month — never as balances.
export default function Dashboard({ categories, accounts, activeHouseholdId }) {
  const thisMonth = currentMonth()
  const range = { min: shiftMonth(thisMonth, -1), max: shiftMonth(thisMonth, 1) }
  const [month, setMonth] = useState(thisMonth)
  const [all, setAll] = useState([])
  const [recurring, setRecurring] = useState([])
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false) // first load done — until then show a skeleton, not ₹0.00

  const load = useCallback(async () => {
    if (!activeHouseholdId) return
    const [t, ri] = await Promise.all([
      supabase.from('transactions')
        .select('id, kind, amount, occurred_on, note, category_id, account_id, recurring_item_id')
        .eq('household_id', activeHouseholdId)
        .gte('occurred_on', monthStart(range.min))
        .lte('occurred_on', monthEnd(range.max))
        .order('occurred_on', { ascending: false })
        .limit(10000),
      supabase.from('recurring_items').select('*').eq('household_id', activeHouseholdId).eq('active', true),
    ])
    const err = t.error || ri.error
    setError(err ? err.message : null)
    setAll(t.data || [])
    setRecurring(ri.data || [])
    setLoaded(true)
  }, [activeHouseholdId, range.min, range.max])

  useEffect(() => { load() }, [load])

  const catById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])

  // Rows for a month: actual transactions, and for next month also each recurring
  // commitment not yet logged, at its expected amount (flagged `planned`).
  const rowsFor = useCallback((ym) => {
    const txs = all.filter((t) => monthKey(t.occurred_on) === ym)
    if (ym !== range.max) return txs
    const logged = new Set(txs.map((t) => t.recurring_item_id).filter(Boolean))
    const planned = recurring.filter((r) => !logged.has(r.id)).map((r) => ({
      id: `plan-${r.id}`, kind: r.kind, amount: r.expected_amount, category_id: r.category_id, account_id: r.account_id, note: r.name, day: r.day_of_month, planned: true,
    }))
    return [...txs, ...planned]
  }, [all, recurring, range.max])

  const stats = useMemo(() => {
    const rows = rowsFor(month)
    const income = sum(rows.filter((t) => t.kind === 'income'))
    const expense = sum(rows.filter((t) => t.kind === 'expense'))
    // Money through each account bucket this month (positive amounts).
    const accById = Object.fromEntries(accounts.map((a) => [a.id, a]))
    const byAcc = {}
    for (const t of rows) {
      if (!t.account_id) continue
      const e = byAcc[t.account_id] || (byAcc[t.account_id] = { spent: 0, received: 0 })
      if (t.kind === 'expense') e.spent += Number(t.amount); else e.received += Number(t.amount)
    }
    const accountFlow = Object.entries(byAcc)
      .map(([id, v]) => ({ id, ...v, name: accById[id]?.name?.trim() || 'Unknown account', type: accById[id]?.type, color: accById[id]?.color }))
      .sort((a, b) => b.spent - a.spent || b.received - a.received)
    const topSpend = accountFlow.find((a) => a.spent > 0)

    const trend = [range.min, thisMonth, range.max].map((ym) => {
      const r = rowsFor(ym)
      return {
        month: ym === range.max ? `${shortMonth(ym)} (plan)` : shortMonth(ym),
        plan: ym === range.max,
        Income: sum(r.filter((t) => t.kind === 'income')),
        Expense: sum(r.filter((t) => t.kind === 'expense')),
      }
    })

    const byCat = {}
    rows.filter((t) => t.kind === 'expense').forEach((t) => {
      const k = t.category_id || 'none'
      byCat[k] = (byCat[k] || 0) + Number(t.amount)
    })
    const breakdown = Object.entries(byCat)
      .map(([id, value]) => ({ id, name: catById[id]?.name.trim() || 'Uncategorised', color: catById[id]?.color || '#94a3b8', value }))
      .sort((a, b) => b.value - a.value)

    // Everything in the planned month, day by day: entries already logged (✓) and plan items still expected.
    const dayOf = (t) => (t.planned ? t.day || 99 : Number(String(t.occurred_on).slice(8, 10)))
    // Only Plan commitments: expected items plus the ones already logged against them.
    const upcoming = rows.filter((t) => t.planned || t.recurring_item_id).sort((a, b) => dayOf(a) - dayOf(b))
    return { income, expense, accountFlow, topSpend, trend, breakdown, recent: rows.filter((t) => !t.planned).slice(0, 6), upcoming }
  }, [rowsFor, accounts, month, catById, thisMonth, range.min, range.max])

  const isPlan = month === range.max
  const savingsRate = stats.income > 0 ? Math.round(((stats.income - stats.expense) / stats.income) * 100) : null
  const hasTrend = stats.trend.some((t) => t.Income > 0 || t.Expense > 0)
  const swipe = useMonthSwipe(month, setMonth, range)

  if (!loaded) return <DashboardSkeleton />
  return (
    <section {...swipe} className="fade-in">
      <div className="toolbar">
        <MonthPicker month={month} setMonth={setMonth} {...range} />
        <span className="muted small">{month === thisMonth ? 'this month' : isPlan ? 'next month · planned' : 'last month'}</span>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="tiles">
        <Tile label={isPlan ? 'Expected income' : 'Income'} value={money(stats.income)} tone="pos" />
        <Tile label={isPlan ? 'Expected expenses' : 'Expenses'} value={money(stats.expense)} tone="neg" />
        <Tile label={isPlan ? 'Expected savings' : 'Net savings'} value={money(stats.income - stats.expense)} sub={savingsRate !== null ? `${savingsRate}% savings rate` : null} />
        <Tile label={isPlan ? 'Most planned from' : 'Most spent from'} value={stats.topSpend ? money(stats.topSpend.spent) : '—'} sub={stats.topSpend ? stats.topSpend.name : 'no account used'} />
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Last · this · next month</h3>
          {hasTrend ? (
            <TrendChart data={stats.trend} />
          ) : (
            <div className="empty-chart muted">
              Nothing logged or planned yet.<br />
              <span className="small">Add a transaction, or your commitments in Plan.</span>
            </div>
          )}
        </div>

        <div className="card">
          <h3>{isPlan ? 'Where the money will go' : 'Where the money went'}</h3>
          {stats.breakdown.length === 0 ? <div className="empty-chart muted" style={{ height: 220 }}>{isPlan ? 'No planned expenses yet.' : 'No expenses this month.'}</div> : (
            <div className="pie-wrap">
              <DonutChart data={stats.breakdown.map((d) => ({ ...d, key: d.id }))} />
              <ul className="legend">
                {stats.breakdown.slice(0, 6).map((d) => (
                  <li key={d.id}><span className="dot" style={{ background: d.color }} />{d.name}<b>{money(d.value)}</b></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>By account <span className="muted small">({isPlan ? 'planned' : 'this month'})</span></h3>
          {stats.accountFlow.length === 0 && <div className="muted">No account used {isPlan ? 'in the plan' : 'this month'}.</div>}
          {stats.accountFlow.map((a) => (
            <div className="line" key={a.id}>
              <span><span className="dot" style={{ background: a.color || '#94a3b8' }} />{a.name}</span>
              <span className="acc-flow">
                {a.spent > 0 && <b>{money(a.spent)} <span className="muted small">{isPlan ? 'out' : 'spent'}</span></b>}
                {a.received > 0 && <b className="pos">{money(a.received)} <span className="muted small">in</span></b>}
              </span>
            </div>
          ))}
        </div>
        <div className="card">
          {isPlan ? (
            <>
              <ComingUp rows={stats.upcoming} month={month} catById={catById} accounts={accounts} />
            </>
          ) : (
            <>
              <h3>Recent</h3>
              {stats.recent.length === 0 ? <div className="muted">Nothing yet this month.</div> : stats.recent.map((t) => (
                <div className="line" key={t.id}>
                  <span>{t.note || catById[t.category_id]?.name || 'Uncategorised'} <span className="muted small">{t.occurred_on}</span></span>
                  <b className={t.kind === 'income' ? 'pos' : 'neg'}>{t.kind === 'income' ? '+' : '−'}{money(t.amount)}</b>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

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

const shortMonth = (ym) => monthLabel(ym).split(' ')[0]
const sum = (arr) => arr.reduce((s, t) => s + Number(t.amount), 0)

// Next month's Plan commitments by day: logged ones (✓) and those still expected.
function ComingUp({ rows, month, catById, accounts }) {
  const accById = Object.fromEntries(accounts.map((a) => [a.id, a]))
  const done = rows.filter((t) => !t.planned)
  const toPay = rows.filter((t) => t.planned && t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const mon = shortMonth(month)
  return (
    <>
      <div className="cu-head">
        <h3>Coming up</h3>
        {rows.length > 0 && <span className="muted small">{done.length} of {rows.length} done</span>}
      </div>
      {rows.length > 0 && (
        <div className="cu-progress">
          <div className="bar"><div className="fill ok" style={{ width: `${(done.length / rows.length) * 100}%` }} /></div>
          <span className="muted small">{toPay ? `${money(toPay)} still to pay` : 'all paid'}</span>
        </div>
      )}
      {rows.length === 0 ? <div className="muted">Nothing planned. Add commitments in the Plan tab.</div> : (
        <div className="cu-list">
          {rows.map((t) => {
            const day = t.planned ? t.day : Number(String(t.occurred_on).slice(8, 10))
            const sub = [catById[t.category_id]?.name, accById[t.account_id]?.name].filter(Boolean).join(' · ')
            const income = t.kind === 'income'
            return (
              <div className={`cu-row ${t.planned ? 'planned' : 'done'}`} key={t.id}>
                <div className="cu-date"><b>{day || '—'}</b><span>{mon}</span></div>
                <div className="grow">
                  <div className="cu-name">{t.note?.trim() || catById[t.category_id]?.name || 'Uncategorised'}</div>
                  {sub && <div className="muted small cu-sub">{sub}</div>}
                </div>
                <div className="cu-right">
                  <b className={`amt ${income ? 'pos' : 'neg'}`}>{income ? '+' : '−'}{money(t.amount)}</b>
                  <span className={`cu-status ${t.planned ? '' : 'ok'}`}>{t.planned ? 'Expected' : income ? '✓ Received' : '✓ Paid'}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
