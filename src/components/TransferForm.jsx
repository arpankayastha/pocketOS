import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { today } from '../lib/format'
import { loadTransfer, saveTransfer } from '../lib/transfers'

// Move money from the active household to another one. Creates an expense here and an
// income there (both "Home transfer"), linked so edits and deletes apply to both.
// `transferId` edits an existing transfer; the two households are fixed once created.
export default function TransferForm({ households, fromHouseholdId, transferId, onClose, onSaved }) {
  const [form, setForm] = useState({
    from: fromHouseholdId, to: '', fromAccount: '', toAccount: '', amount: '', date: today(), note: '',
  })
  const [accountsBy, setAccountsBy] = useState({}) // household id → accounts
  const [loading, setLoading] = useState(!!transferId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const nameOf = (id) => households.find((h) => h.id === id)?.name || 'Unknown'

  // Editing: load both halves.
  useEffect(() => {
    if (!transferId) return
    loadTransfer(transferId).then(({ sender, receiver }) => {
      setForm({
        from: sender.household_id, to: receiver.household_id, fromAccount: sender.account_id || '', toAccount: receiver.account_id || '',
        amount: String(sender.amount), date: sender.occurred_on, note: sender.note || '',
      })
      setLoading(false)
    }).catch((err) => { setError(err.message); setLoading(false) })
  }, [transferId])

  // Accounts for both sides (fetched per household as it's chosen).
  useEffect(() => {
    const need = [form.from, form.to].filter((id) => id && !accountsBy[id])
    if (!need.length) return
    supabase.from('accounts').select('id, name, household_id').in('household_id', need).order('created_at').then(({ data }) => {
      setAccountsBy((m) => ({ ...m, ...Object.fromEntries(need.map((id) => [id, (data || []).filter((a) => a.household_id === id)])) }))
    })
  }, [form.from, form.to, accountsBy])

  async function save(e) {
    e.preventDefault()
    if (!form.to) return setError('Choose where the money goes.')
    setBusy(true)
    setError(null)
    try {
      await saveTransfer({
        transferId, fromHouseholdId: form.from, toHouseholdId: form.to, fromAccountId: form.fromAccount, toAccountId: form.toAccount,
        amount: Number(form.amount), occurredOn: form.date, note: form.note.trim(),
      })
      onSaved()
    } catch (err) { setError(err.message); setBusy(false) }
  }

  const others = households.filter((h) => h.id !== form.from)
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="kind-title transfer">⇄ {transferId ? 'Edit transfer' : 'Transfer between households'}</h3>
        {loading ? <div className="muted">Loading…</div> : (
          <>
            <label>Amount
              <input type="number" inputMode="decimal" step="0.01" min="0.01" required autoFocus={!transferId} value={form.amount} onChange={set('amount')} />
            </label>
            <div className="row2">
              <label>From
                <input value={nameOf(form.from)} disabled />
              </label>
              <label>To
                {transferId ? <input value={nameOf(form.to)} disabled /> : (
                  <select required value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value, toAccount: '' }))}>
                    <option value="">Choose…</option>
                    {others.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                )}
              </label>
            </div>
            <div className="row2">
              <label>From account
                <select value={form.fromAccount} onChange={set('fromAccount')}>
                  <option value="">—</option>
                  {(accountsBy[form.from] || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>To account
                <select value={form.toAccount} onChange={set('toAccount')} disabled={!form.to}>
                  <option value="">—</option>
                  {(accountsBy[form.to] || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            </div>
            <label>Date
              <input type="date" required value={form.date} onChange={set('date')} />
            </label>
            <label>Note
              <input type="text" placeholder="e.g. Monthly household money" value={form.note} onChange={set('note')} />
            </label>
            <p className="muted small" style={{ margin: 0 }}>
              Recorded as an expense in <b>{nameOf(form.from)}</b> and income in <b>{form.to ? nameOf(form.to) : 'the other household'}</b>, both under "Home transfer".
            </p>
          </>
        )}
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || loading}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
