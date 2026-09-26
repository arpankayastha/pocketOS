import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { today } from '../lib/format'

export default function TransactionForm({ accounts, categories, initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial ? {
    kind: initial.kind,
    amount: String(initial.amount),
    category_id: initial.category_id || '',
    account_id: initial.account_id || '',
    occurred_on: initial.occurred_on,
    note: initial.note || '',
  } : {
    kind: 'expense',
    amount: '',
    category_id: '',
    account_id: accounts[0]?.id || '',
    occurred_on: today(),
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const cats = categories.filter((c) => c.kind === form.kind)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const row = {
      kind: form.kind,
      amount: Number(form.amount),
      category_id: form.category_id || null,
      account_id: form.account_id || null,
      occurred_on: form.occurred_on,
      note: form.note.trim() || null,
    }
    const { error } = initial
      ? await supabase.from('transactions').update(row).eq('id', initial.id)
      : await supabase.from('transactions').insert(row)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved()
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{initial ? 'Edit transaction' : 'Add transaction'}</h3>
        <div className="seg">
          {['expense', 'income'].map((k) => (
            <button type="button" key={k} className={form.kind === k ? `on ${k}` : ''}
              onClick={() => setForm((f) => ({ ...f, kind: k, category_id: '' }))}>
              {k === 'expense' ? 'Expense' : 'Income'}
            </button>
          ))}
        </div>
        <label>Amount
          <input type="number" inputMode="decimal" step="0.01" min="0.01" required autoFocus value={form.amount} onChange={set('amount')} />
        </label>
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
        <label>Date
          <input type="date" required value={form.occurred_on} onChange={set('occurred_on')} />
        </label>
        <label>Note
          <input type="text" placeholder="e.g. BigBasket order" value={form.note} onChange={set('note')} />
        </label>
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
