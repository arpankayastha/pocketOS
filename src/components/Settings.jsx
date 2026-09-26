import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'

export default function Settings({ accounts, categories, refresh }) {
  return (
    <section className="grid2">
      <Accounts accounts={accounts} refresh={refresh} />
      <Categories categories={categories} refresh={refresh} />
    </section>
  )
}

function Accounts({ accounts, refresh }) {
  const [form, setForm] = useState({ name: '', type: 'bank', opening_balance: '' })
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    const { error } = await supabase.from('accounts').insert({ ...form, opening_balance: Number(form.opening_balance) || 0 })
    if (error) return setError(error.message)
    setForm({ name: '', type: 'bank', opening_balance: '' })
    setError(null)
    refresh()
  }

  async function remove(a) {
    if (!confirm(`Delete account "${a.name}"? Its transactions will be kept but unlinked.`)) return
    const { error } = await supabase.from('accounts').delete().eq('id', a.id)
    if (error) return setError(error.message)
    refresh()
  }

  return (
    <div className="card">
      <h3>Accounts</h3>
      {accounts.map((a) => (
        <div className="line" key={a.id}>
          <span>{a.name} <span className="muted small">{a.type} · opening {money(a.opening_balance)}</span></span>
          <button className="btn icon" onClick={() => remove(a)}>✕</button>
        </div>
      ))}
      <form className="inline-form" onSubmit={add}>
        <input required placeholder="Account name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {['bank', 'cash', 'card', 'wallet', 'investment'].map((t) => <option key={t}>{t}</option>)}
        </select>
        <input type="number" step="0.01" placeholder="Opening balance" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
        <button className="btn primary">Add</button>
      </form>
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}

function Categories({ categories, refresh }) {
  const [form, setForm] = useState({ name: '', kind: 'expense', color: '#6366f1' })
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    const { error } = await supabase.from('categories').insert(form)
    if (error) return setError(error.message)
    setForm({ ...form, name: '' })
    setError(null)
    refresh()
  }

  async function remove(c) {
    if (!confirm(`Delete category "${c.name}"? Transactions become uncategorised and its budgets are removed.`)) return
    const { error } = await supabase.from('categories').delete().eq('id', c.id)
    if (error) return setError(error.message)
    refresh()
  }

  return (
    <div className="card">
      <h3>Categories</h3>
      {['expense', 'income'].map((k) => (
        <div key={k}>
          <div className="muted small caps">{k}</div>
          <div className="chips">
            {categories.filter((c) => c.kind === k).map((c) => (
              <span className="chip" key={c.id}>
                <span className="dot" style={{ background: c.color }} />{c.name}
                <button type="button" onClick={() => remove(c)} title="Delete">×</button>
              </span>
            ))}
          </div>
        </div>
      ))}
      <form className="inline-form" onSubmit={add}>
        <input required placeholder="Category name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          <option value="expense">expense</option><option value="income">income</option>
        </select>
        <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        <button className="btn primary">Add</button>
      </form>
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}
