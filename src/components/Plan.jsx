import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { currentMonth, money, monthEnd, monthStart, shiftMonth } from '../lib/format'
import { MonthPicker } from './Transactions'
import { useMonthSwipe } from '../lib/useSwipe'
import { TrashIcon } from '../lib/icons'
import { SkeletonRows } from './Skeleton'
import { useDialog } from '../lib/dialog'

export default function Plan({ categories, accounts, activeHouseholdId }) {
  const [month, setMonth] = useState(() => shiftMonth(currentMonth(), 1))
  const [items, setItems] = useState([])
  const [actuals, setActuals] = useState({})
  const [logging, setLogging] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState(null)
  const dialog = useDialog()
  const [loaded, setLoaded] = useState(false) // avoids flashing "no commitments yet" before the first load

  const load = useCallback(async () => {
    if (!activeHouseholdId) return
    const [ri, tx] = await Promise.all([
      supabase.from('recurring_items').select('*').eq('household_id', activeHouseholdId).eq('active', true).order('created_at'),
      supabase.from('transactions').select('id, amount, occurred_on, recurring_item_id')
        .eq('household_id', activeHouseholdId).not('recurring_item_id', 'is', null)
        .gte('occurred_on', monthStart(month)).lte('occurred_on', monthEnd(month)),
    ])
    if (ri.error || tx.error) return setError((ri.error || tx.error).message)
    setError(null)
    setItems(ri.data || [])
    setActuals(Object.fromEntries((tx.data || []).map((t) => [t.recurring_item_id, t])))
    setLoaded(true)
  }, [activeHouseholdId, month])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => {
    let income = 0, expense = 0
    items.forEach((it) => {
      const amt = actuals[it.id] ? Number(actuals[it.id].amount) : Number(it.expected_amount)
      if (it.kind === 'income') income += amt; else expense += amt
    })
    return { income, expense, net: income - expense }
  }, [items, actuals])

  async function removeItem(it) {
    if (!await dialog.confirm({ title: `Remove "${it.name}"?`, message: 'It leaves your recurring commitments. Transactions already logged against it are kept.', confirmLabel: 'Remove' })) return
    const { error } = await supabase.from('recurring_items').delete().eq('id', it.id)
    if (error) return setError(error.message)
    load()
  }

  const swipe = useMonthSwipe(month, setMonth)

  return (
    <section {...swipe}>
      <div className="toolbar">
        <MonthPicker month={month} setMonth={setMonth} />
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="tiles">
        <Tile label="Expected income" value={loaded ? money(totals.income) : null} tone="pos" />
        <Tile label="Expected expense" value={loaded ? money(totals.expense) : null} tone="neg" />
        <Tile label="Expected net" value={loaded ? money(totals.net) : null} />
      </div>

      <div className="card">
        <div className="line" style={{ border: 'none', padding: 0, marginBottom: showForm ? 14 : 0 }}>
          <h3 style={{ margin: 0 }}>Recurring commitments</h3>
          <button type="button" className="btn small ghost" onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ Add'}</button>
        </div>
        {showForm && (
          <ItemForm categories={categories} accounts={accounts} activeHouseholdId={activeHouseholdId}
            onSaved={() => { setShowForm(false); load() }} />
        )}
      </div>

      <div className="card list">
        {!loaded ? <SkeletonRows rows={4} /> : items.length === 0 ? (
          <div className="muted pad">No recurring commitments yet. Add your credit cards, SIPs, bills and salary to see next month's trend.</div>
        ) : items.map((it) => {
          const actual = actuals[it.id]
          const cat = categories.find((c) => c.id === it.category_id)
          return (
            <Fragment key={it.id}>
              <div className="txn">
                <span className="dot" style={{ background: cat?.color || '#94a3b8' }} />
                <div className="grow">
                  <div>{it.name}</div>
                  <div className="muted small">{cat?.name || 'Uncategorised'}{it.day_of_month ? ` · due ${it.day_of_month}` : ''}</div>
                </div>
                <div className={`amt ${it.kind === 'income' ? 'pos' : 'neg'} ${actual ? '' : 'expected'}`}>
                  {it.kind === 'income' ? '+' : '−'}{money(actual ? actual.amount : it.expected_amount)}
                </div>
                {actual ? <span className="chip">Logged</span> : (
                  <button type="button" className="btn small ghost" onClick={() => setLogging(logging === it.id ? null : it.id)}>Log</button>
                )}
                <button type="button" className="btn icon" title="Remove" onClick={() => removeItem(it)}><TrashIcon /></button>
              </div>
              {logging === it.id && <LogForm item={it} month={month} onDone={() => { setLogging(null); load() }} />}
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className="card tile">
      <div className="muted small">{label}</div>
      {value === null ? <div className="skel" style={{ width: '75%', height: 22 }} /> : <div className={`big-num ${tone || ''}`}>{value}</div>}
      {sub && <div className="muted small">{sub}</div>}
    </div>
  )
}

function ItemForm({ categories, accounts, activeHouseholdId, onSaved }) {
  const [form, setForm] = useState({ name: '', kind: 'expense', category_id: '', account_id: '', expected_amount: '', day_of_month: '' })
  const [error, setError] = useState(null)
  const cats = categories.filter((c) => c.kind === form.kind)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    const { error } = await supabase.from('recurring_items').insert({
      household_id: activeHouseholdId,
      name: form.name,
      kind: form.kind,
      category_id: form.category_id || null,
      account_id: form.account_id || null,
      expected_amount: Number(form.expected_amount) || 0,
      day_of_month: form.day_of_month ? Number(form.day_of_month) : null,
    })
    if (error) return setError(error.message)
    onSaved()
  }

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 10 }}>
      <div className="row2">
        <label>Name
          <input required placeholder="e.g. Amazon ICICI" value={form.name} onChange={set('name')} />
        </label>
        <label>Kind
          <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, category_id: '' }))}>
            <option value="expense">Expense</option><option value="income">Income</option>
          </select>
        </label>
      </div>
      <div className="row2">
        <label>Category
          <select value={form.category_id} onChange={set('category_id')}>
            <option value="">Uncategorised</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Account
          <select value={form.account_id} onChange={set('account_id')}>
            <option value="">—</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      <div className="row2">
        <label>Expected amount
          <input type="number" inputMode="decimal" step="0.01" min="0" required value={form.expected_amount} onChange={set('expected_amount')} />
        </label>
        <label>Due day <span className="muted">(optional)</span>
          <input type="number" inputMode="numeric" min="1" max="31" placeholder="e.g. 1" value={form.day_of_month} onChange={set('day_of_month')} />
        </label>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="actions"><button className="btn primary">Add commitment</button></div>
    </form>
  )
}

function LogForm({ item, month, onDone }) {
  const [amount, setAmount] = useState(String(item.expected_amount))
  const [date, setDate] = useState(() => {
    const day = item.day_of_month || 1
    const [y, m] = month.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    return `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('transactions').insert({
      household_id: item.household_id, kind: item.kind, amount: Number(amount),
      category_id: item.category_id, account_id: item.account_id,
      occurred_on: date, note: item.name, recurring_item_id: item.id,
    })
    if (!error) await supabase.from('recurring_items').update({ expected_amount: Number(amount) }).eq('id', item.id)
    setBusy(false)
    if (error) return setError(error.message)
    onDone()
  }

  return (
    <form className="inline-form" onSubmit={save}>
      <input type="number" inputMode="decimal" step="0.01" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="btn primary small" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      {error && <div className="alert error">{error}</div>}
    </form>
  )
}
