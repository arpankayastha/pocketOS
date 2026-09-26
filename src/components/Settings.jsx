import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'
import { TrashIcon } from '../lib/icons'

export default function Settings({ accounts, categories, refresh, households, activeHouseholdId, setActiveHouseholdId, createHousehold, email }) {
  return (
    <section className="grid2">
      <div style={{ gridColumn: '1 / -1' }}>
        <Households households={households} activeHouseholdId={activeHouseholdId} setActiveHouseholdId={setActiveHouseholdId} createHousehold={createHousehold} refresh={refresh} />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <Passkeys />
      </div>
      <Accounts accounts={accounts} activeHouseholdId={activeHouseholdId} refresh={refresh} />
      <Categories categories={categories} activeHouseholdId={activeHouseholdId} refresh={refresh} />
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h3>Account</h3>
        <div className="line">
          <span className="muted small">Signed in as {email}</span>
          <button className="btn small ghost" onClick={() => confirm('Sign out of PocketOS on this device?') && supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    </section>
  )
}

function Passkeys() {
  const [passkeys, setPasskeys] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.auth.passkey.list()
    if (error) return setError(error.message)
    setPasskeys(data || [])
  }, [])

  useEffect(() => { load() }, [load])

  async function add() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.registerPasskey()
    setBusy(false)
    if (error) return setError(error.message)
    load()
  }

  async function rename(p) {
    const next = prompt('Rename passkey', p.friendly_name || '')
    if (!next || !next.trim()) return
    const { error } = await supabase.auth.passkey.update({ passkeyId: p.id, friendlyName: next.trim() })
    if (error) return setError(error.message)
    load()
  }

  async function remove(p) {
    if (!confirm(`Remove passkey "${p.friendly_name || 'Passkey'}"? You'll need another way to sign in on that device.`)) return
    const { error } = await supabase.auth.passkey.delete({ passkeyId: p.id })
    if (error) return setError(error.message)
    load()
  }

  return (
    <div className="card">
      <h3>Passkeys</h3>
      <p className="muted small">Sign in faster next time with Face ID, Touch ID, or your device PIN — no password needed.</p>
      {passkeys.map((p) => (
        <div className="line" key={p.id}>
          <span>{p.friendly_name || 'Passkey'} <span className="muted small">added {new Date(p.created_at).toLocaleDateString()}</span></span>
          <span>
            <button className="btn small ghost" onClick={() => rename(p)}>Rename</button>{' '}
            <button className="btn icon" onClick={() => remove(p)}><TrashIcon /></button>
          </span>
        </div>
      ))}
      {passkeys.length === 0 && <p className="muted small">No passkeys added yet.</p>}
      <button className="btn primary" disabled={busy} onClick={add} style={{ marginTop: 10 }}>
        {busy ? 'Adding…' : '+ Add a passkey for this device'}
      </button>
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}

function Households({ households, activeHouseholdId, setActiveHouseholdId, createHousehold, refresh }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    try {
      await createHousehold(name.trim())
      setName('')
      setError(null)
    } catch (err) { setError(err.message) }
  }

  async function rename(h) {
    const next = prompt('Rename household', h.name)
    if (!next || next.trim() === h.name) return
    const { error } = await supabase.from('households').update({ name: next.trim() }).eq('id', h.id)
    if (error) return setError(error.message)
    refresh()
  }

  async function remove(h) {
    if (households.length < 2) return alert('You need at least one household.')
    if (!confirm(`Delete household "${h.name}"? All its accounts, categories, transactions and budgets are deleted too.`)) return
    const { error } = await supabase.from('households').delete().eq('id', h.id)
    if (error) return setError(error.message)
    if (h.id === activeHouseholdId) setActiveHouseholdId(households.find((x) => x.id !== h.id)?.id)
    refresh()
  }

  return (
    <div className="card">
      <h3>Households</h3>
      {households.map((h) => (
        <div className="line" key={h.id}>
          <span>
            <button type="button" className="btn link" style={{ fontWeight: h.id === activeHouseholdId ? 700 : 400 }} onClick={() => setActiveHouseholdId(h.id)}>
              {h.id === activeHouseholdId ? '● ' : '○ '}{h.name}
            </button>
          </span>
          <span>
            <button className="btn small ghost" onClick={() => rename(h)}>Rename</button>{' '}
            <button className="btn icon" onClick={() => remove(h)}><TrashIcon /></button>
          </span>
        </div>
      ))}
      <form className="inline-form" onSubmit={add}>
        <input required placeholder="New household name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary">Add</button>
      </form>
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}

function Accounts({ accounts, activeHouseholdId, refresh }) {
  const [form, setForm] = useState({ name: '', type: 'bank', opening_balance: '' })
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    const { error } = await supabase.from('accounts').insert({ ...form, household_id: activeHouseholdId, opening_balance: Number(form.opening_balance) || 0 })
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
        <input type="number" inputMode="decimal" step="0.01" placeholder="Opening balance" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
        <button className="btn primary">Add</button>
      </form>
      {error && <div className="alert error">{error}</div>}
    </div>
  )
}

function Categories({ categories, activeHouseholdId, refresh }) {
  const [form, setForm] = useState({ name: '', kind: 'expense', color: '#6366f1' })
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    const { error } = await supabase.from('categories').insert({ ...form, household_id: activeHouseholdId })
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
