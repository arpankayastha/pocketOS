import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { currentMonth, money, shiftMonth } from '../lib/format'
import { loadMonthMoney } from '../lib/runway'
import { MonthPicker } from './Transactions'
import { useMonthSwipe } from '../lib/useSwipe'
import { TrashIcon } from '../lib/icons'
import { SkeletonRows } from './Skeleton'
import { useDialog } from '../lib/dialog'
import { addEntry } from '../lib/dues'

export default function Plan({ categories, accounts, activeHouseholdId }) {
  const [month, setMonth] = useState(() => shiftMonth(currentMonth(), 1))
  const [money_, setMoney] = useState(null) // loadMonthMoney result
  const [logging, setLogging] = useState(null)
  const [open, setOpen] = useState(null) // card bill showing its spends
  const [showForm, setShowForm] = useState(false)
  const [showLeft, setShowLeft] = useState(false)
  const [error, setError] = useState(null)
  const dialog = useDialog()
  const isNow = month === currentMonth()

  const load = useCallback(async () => {
    if (!activeHouseholdId) return
    try { setMoney(await loadMonthMoney(activeHouseholdId, month, accounts)); setError(null) } catch (err) { setError(err.message) }
  }, [activeHouseholdId, month, accounts])

  useEffect(() => { load() }, [load])
  const items = money_?.items || []
  const loaded = !!money_

  async function removeItem(it) {
    if (!await dialog.confirm({ title: `Remove "${it.name}"?`, message: 'It leaves your recurring commitments. Transactions already logged against it are kept.', confirmLabel: 'Remove' })) return
    const { error } = await supabase.from('recurring_items').delete().eq('id', it.id)
    if (error) return setError(error.message)
    load()
  }

  const swipe = useMonthSwipe(month, setMonth)
  const accName = (id) => accounts.find((a) => a.id === id)?.name?.trim()

  return (
    <section {...swipe}>
      <div className="toolbar">
        <MonthPicker month={month} setMonth={setMonth} />
      </div>
      {error && <div className="alert error">{error}</div>}

      {isNow && (
        <button type="button" className="card plan-left" onClick={() => setShowLeft(true)}>
          <div className="muted small">Left to spend this month</div>
          {loaded ? <div className={`plan-left-num ${money_.left < 0 ? 'neg' : 'pos'}`}>{money(money_.left)}</div> : <div className="skel" style={{ height: 30, width: '55%' }} />}
          {loaded && <div className="muted small">Income {money(money_.income)} − plan {money(money_.commitments)} − spends {money(money_.spends + money_.oneOffs)} · card spends go to their bill ›</div>}
        </button>
      )}

      <div className="tiles">
        <Tile label="Expected income" value={loaded ? money(money_.income) : null} tone="pos" />
        <Tile label="Expected expense" value={loaded ? money(money_.commitments) : null} tone="neg" />
        <Tile label="Expected net" value={loaded ? money(money_.income - money_.commitments) : null} />
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
          <div className="muted pad">No recurring commitments yet. Add your SIPs, bills and salary — and give your credit cards a bill day in ⚙ Accounts to get their bills here automatically.</div>
        ) : items.map((it) => {
          const actual = it.actual
          const cat = categories.find((c) => c.id === it.category_id)
          const bill = it.bill
          const sub = it.auto_card
            ? (bill?.statement
              ? `${bill.open ? `${bill.count} spend${bill.count === 1 ? '' : 's'} so far · closes ${shortDate(bill.statement)}` : `Statement ${shortDate(bill.statement)} · ${bill.count} spend${bill.count === 1 ? '' : 's'}`} · due ${shortDate(bill.due)}`
              : 'No bill due this month')
            : `${cat?.name || 'Uncategorised'}${it.day_of_month ? ` · due ${it.day_of_month}` : ''}${actual?.fromHisab ? ` · paid${it.onCard ? ' by card' : ''} (Hisab)` : ''}`
          return (
            <Fragment key={it.id}>
              <div className={`txn ${it.auto_card ? 'plan-card' : ''}`} onClick={it.auto_card && bill?.count ? () => setOpen(open === it.id ? null : it.id) : undefined}>
                <span className="dot" style={{ background: it.auto_card ? (accounts.find((a) => a.id === it.account_id)?.color || '#8b5cf6') : cat?.color || '#94a3b8' }} />
                <div className="grow">
                  <div>{it.auto_card ? '💳 ' : ''}{it.name}</div>
                  <div className="muted small">{sub}</div>
                </div>
                <div className={`amt ${it.kind === 'income' ? 'pos' : 'neg'} ${actual ? '' : 'expected'}`}>
                  {it.kind === 'income' ? '+' : '−'}{money(it.amount)}
                </div>
                {actual ? <span className="chip">{it.kind === 'income' ? 'Received' : 'Paid'}</span> : (
                  <button type="button" className="btn small ghost" onClick={(e) => { e.stopPropagation(); setLogging(logging === it.id ? null : it.id) }}>Log</button>
                )}
                {!it.auto_card && <button type="button" className="btn icon" title="Remove" onClick={(e) => { e.stopPropagation(); removeItem(it) }}><TrashIcon /></button>}
              </div>
              {open === it.id && bill && (
                <div className="plan-spends">
                  {bill.spends.map((s) => (
                    <div key={`${s.from}-${s.id}`} className="plan-spend">
                      <span className="muted small">{shortDate(s.occurred_on)}</span>
                      <span className="grow">{s.note || s.category || 'Spend'}</span>
                      <span className={s.sign < 0 ? 'pos' : ''}>{s.sign < 0 ? '+' : ''}{money(s.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {logging === it.id && <LogForm item={it} month={month} onDone={() => { setLogging(null); load() }} />}
            </Fragment>
          )
        })}
      </div>

      {showLeft && loaded && <LeftSheet m={money_} accName={accName} onClose={() => setShowLeft(false)} />}
    </section>
  )
}

const shortDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '')

// How "left to spend" is worked out, line by line.
function LeftSheet({ m, accName, onClose }) {
  const lines = (kind) => m.items.filter((i) => i.kind === kind)
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal left-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Left to spend: <span className={m.left < 0 ? 'neg' : 'pos'}>{money(m.left)}</span></h3>
        <div className="left-sec">Income</div>
        {lines('income').map((i) => <Row key={i.id} label={i.name} value={i.counted} tone="pos" note={i.actual ? 'received' : 'expected'} />)}
        <div className="left-sec">Plan this month</div>
        {lines('expense').map((i) => <Row key={i.id} label={`${i.auto_card ? '💳 ' : ''}${i.name}`} value={-i.counted}
          note={i.onCard ? 'on a card bill' : i.actual ? 'paid' : i.auto_card ? 'card bill' : 'expected'} />)}
        <div className="left-sec">Spent from bank / cash (Hisab)</div>
        {Object.entries(m.byAccount).map(([id, v]) => <Row key={id} label={id === 'none' ? 'Not linked to an account' : accName(id) || 'Account'} value={-v} />)}
        {!Object.keys(m.byAccount).length && <div className="muted small">Nothing yet</div>}
        {m.oneOffs > 0 && <><div className="left-sec">Other Budget expenses</div><Row label="One-off entries" value={-m.oneOffs} /></>}
        <p className="muted small">Card spends aren't taken off here — they make up that card's bill in the month it's due.</p>
        <div className="actions"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Done</button></div>
      </div>
    </div>
  )
}

function Row({ label, value, note, tone }) {
  return (
    <div className="left-row">
      <span className="grow">{label}{note && <span className="muted small"> · {note}</span>}</span>
      <span className={tone || (value < 0 ? 'neg' : '')}>{value < 0 ? '−' : ''}{money(Math.abs(value))}</span>
    </div>
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
  const [amount, setAmount] = useState(String(Math.round((item.amount ?? item.expected_amount) * 100) / 100))
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
    let error = null
    if (item.due_id) {
      // A due's EMI: record the repayment on the due too (which adds the Budget entry).
      try {
        const { data: due, error: err } = await supabase.from('dues').select('*').eq('id', item.due_id).single()
        if (err) throw err
        await addEntry(due, { direction: item.kind === 'expense' ? 'out' : 'in', amount: Number(amount), occurredOn: date, note: 'EMI', toBudget: true, accountId: item.account_id, recurringItemId: item.id })
      } catch (err) { error = err }
    } else {
      ({ error } = await supabase.from('transactions').insert({
        household_id: item.household_id, kind: item.kind, amount: Number(amount),
        category_id: item.category_id, account_id: item.account_id,
        occurred_on: date, note: item.name, recurring_item_id: item.id,
      }))
    }
    if (!error && !item.auto_card) await supabase.from('recurring_items').update({ expected_amount: Number(amount) }).eq('id', item.id)
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
