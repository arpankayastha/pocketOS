import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { currentMonth, monthEnd, monthLabel, monthStart, money, shiftMonth } from '../lib/format'
import { MonthPicker } from './Transactions'

export default function Budgets({ categories, activeHouseholdId }) {
  const [month, setMonth] = useState(currentMonth())
  const [budgets, setBudgets] = useState({}) // category_id -> amount
  const [spent, setSpent] = useState({})
  const [drafts, setDrafts] = useState({})
  const [error, setError] = useState(null)

  const expenseCats = useMemo(() => categories.filter((c) => c.kind === 'expense'), [categories])

  const load = useCallback(async () => {
    if (!activeHouseholdId) return
    const [b, t] = await Promise.all([
      supabase.from('budgets').select('category_id, amount').eq('household_id', activeHouseholdId).eq('month', monthStart(month)),
      supabase.from('transactions').select('category_id, amount').eq('household_id', activeHouseholdId).eq('kind', 'expense')
        .gte('occurred_on', monthStart(month)).lte('occurred_on', monthEnd(month)),
    ])
    if (b.error || t.error) return setError((b.error || t.error).message)
    setError(null)
    const bm = Object.fromEntries(b.data.map((r) => [r.category_id, Number(r.amount)]))
    const sm = {}
    t.data.forEach((r) => { if (r.category_id) sm[r.category_id] = (sm[r.category_id] || 0) + Number(r.amount) })
    setBudgets(bm)
    setSpent(sm)
    setDrafts(Object.fromEntries(Object.entries(bm).map(([k, v]) => [k, String(v)])))
  }, [month, activeHouseholdId])

  useEffect(() => { load() }, [load])

  async function saveOne(categoryId) {
    const raw = drafts[categoryId]
    if (raw === undefined || Number(raw) === budgets[categoryId]) return
    const q = raw === '' || Number(raw) === 0
      ? supabase.from('budgets').delete().eq('category_id', categoryId).eq('month', monthStart(month))
      : supabase.from('budgets').upsert(
          { category_id: categoryId, household_id: activeHouseholdId, month: monthStart(month), amount: Number(raw) },
          { onConflict: 'household_id,category_id,month' })
    const { error } = await q
    if (error) return setError(error.message)
    load()
  }

  async function copyPrevious() {
    const prev = monthStart(shiftMonth(month, -1))
    const { data, error } = await supabase.from('budgets').select('category_id, amount').eq('household_id', activeHouseholdId).eq('month', prev)
    if (error) return setError(error.message)
    if (!data.length) return alert(`No budgets set for ${monthLabel(shiftMonth(month, -1))}.`)
    const rows = data.map((r) => ({ category_id: r.category_id, household_id: activeHouseholdId, amount: r.amount, month: monthStart(month) }))
    const res = await supabase.from('budgets').upsert(rows, { onConflict: 'household_id,category_id,month' })
    if (res.error) return setError(res.error.message)
    load()
  }

  const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0)
  const totalSpent = expenseCats.reduce((s, c) => s + (spent[c.id] || 0), 0)

  return (
    <section>
      <div className="toolbar">
        <MonthPicker month={month} setMonth={setMonth} />
        <div className="spacer" />
        <button className="btn ghost" onClick={copyPrevious}>Copy last month</button>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <div className="line"><b>Total</b><span>{money(totalSpent)} of {money(totalBudget)}</span></div>
        <Progress spent={totalSpent} budget={totalBudget} />
      </div>

      <div className="card list">
        {expenseCats.map((c) => {
          const b = budgets[c.id] || 0
          const s = spent[c.id] || 0
          return (
            <div className="budget" key={c.id}>
              <div className="budget-head">
                <span><span className="dot" style={{ background: c.color }} />{c.name}</span>
                <span className="muted small">{money(s)} spent{b ? ` · ${money(Math.max(b - s, 0))} left` : ''}</span>
                <input type="number" inputMode="decimal" min="0" step="100" placeholder="Set budget" className="budget-input"
                  value={drafts[c.id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                  onBlur={() => saveOne(c.id)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
              </div>
              {b > 0 && <Progress spent={s} budget={b} />}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Progress({ spent, budget }) {
  if (!budget) return null
  const pct = Math.min((spent / budget) * 100, 100)
  const tone = spent > budget ? 'over' : pct > 80 ? 'warn' : 'ok'
  return <div className="bar"><div className={`fill ${tone}`} style={{ width: `${pct}%` }} /></div>
}
