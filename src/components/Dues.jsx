import { useCallback, useEffect, useMemo, useState } from 'react'
import { money, today } from '../lib/format'
import { loadDues, addEntry, updateEntry, deleteEntry, saveDue, deleteDue, entryLabel, actionsFor } from '../lib/dues'
import { useDialog } from '../lib/dialog'
import { PencilIcon, TrashIcon, DuesIcon } from '../lib/icons'
import { SkeletonRows } from './Skeleton'

const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`

// Budget → Dues: who owes whom, both ways, with repayments as they happen.
export default function Dues({ households, activeHouseholdId, accounts, onChanged }) {
  const [dues, setDues] = useState(null)
  const [error, setError] = useState(null)
  const [show, setShow] = useState('open') // open | settled
  const [openId, setOpenId] = useState(null)
  const [editing, setEditing] = useState(null) // {} new, or a due to edit
  const household = households.find((h) => h.id === activeHouseholdId)

  const load = useCallback(async () => {
    if (!activeHouseholdId) return
    try { setDues(await loadDues(activeHouseholdId)); setError(null) } catch (err) { setError(err.message) }
  }, [activeHouseholdId])
  useEffect(() => { load() }, [load])

  const changed = () => { load(); onChanged?.() }

  const totals = useMemo(() => (dues || []).reduce((t, d) => {
    if (d.balance > 0) t.owedToYou += d.balance; else t.youOwe -= d.balance
    return t
  }, { owedToYou: 0, youOwe: 0 }), [dues])

  const open = (dues || []).filter((d) => d.balance !== 0 || d.entries.length === 0)
  const settled = (dues || []).filter((d) => d.balance === 0 && d.entries.length > 0)
  const list = show === 'open' ? open : settled
  const current = dues?.find((d) => d.id === openId)

  return (
    <section>
      {error && <div className="alert error">{error}</div>}
      <div className="tiles dues-tiles">
        <div className="card tile">
          <div className="muted small">Owed to {household?.name || 'you'}</div>
          {dues ? <div className="big-num pos">{money(totals.owedToYou)}</div> : <div className="skel" style={{ width: '70%', height: 22 }} />}
        </div>
        <div className="card tile">
          <div className="muted small">{household?.name || 'You'} owe{household ? 's' : ''}</div>
          {dues ? <div className="big-num neg">{money(totals.youOwe)}</div> : <div className="skel" style={{ width: '70%', height: 22 }} />}
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          <button className={`chip chip-btn ${show === 'open' ? 'on' : ''}`} onClick={() => setShow('open')}>Open · {open.length}</button>
          <button className={`chip chip-btn ${show === 'settled' ? 'on' : ''}`} onClick={() => setShow('settled')}>Settled · {settled.length}</button>
        </div>
        <div className="spacer" />
        <button className="btn primary small" onClick={() => setEditing({})}>+ New due</button>
      </div>

      {!dues ? <div className="card list"><SkeletonRows rows={3} /></div> : list.length === 0 ? (
        <div className="card empty-module">
          <DuesIcon />
          <b>{show === 'open' ? 'No open dues' : 'Nothing settled yet'}</b>
          <p className="muted small">{show === 'open'
            ? 'Add money someone owes, or money owed to someone — then log each repayment as it happens, in one go or in EMIs.'
            : 'Dues move here once they are fully repaid.'}</p>
        </div>
      ) : (
        <div className="due-list">
          {list.map((d) => <DueCard key={d.id} due={d} onOpen={() => setOpenId(d.id)} />)}
        </div>
      )}

      {current && <DueSheet due={current} households={households} accounts={accounts} onClose={() => setOpenId(null)}
        onEdit={() => setEditing(current)} onChanged={changed} />}
      {editing && <DueForm due={editing.id ? editing : null} households={households} household={household} accounts={accounts}
        onClose={() => setEditing(null)}
        onSaved={(d) => { setEditing(null); changed(); if (!editing.id) setOpenId(d.id) }}
        onDeleted={() => { setEditing(null); setOpenId(null); changed() }} />}
    </section>
  )
}

function progressOf(due) {
  let out = 0, inn = 0
  for (const e of due.entries) if (e.direction === 'out') out += Number(e.amount); else inn += Number(e.amount)
  const big = Math.max(out, inn)
  return big ? Math.min(out, inn) / big : 0
}

function Balance({ balance }) {
  if (balance === 0) return <div className="due-bal settled"><b>Settled</b></div>
  return (
    <div className={`due-bal ${balance > 0 ? 'pos' : 'neg'}`}>
      <b className="amt">{money(Math.abs(balance))}</b>
      <span className="small">{balance > 0 ? 'owes you' : 'you owe'}</span>
    </div>
  )
}

function DueCard({ due, onOpen }) {
  const last = due.entries[due.entries.length - 1]
  const first = due.entries[0]
  const pct = progressOf(due)
  return (
    <button className="card due-card" onClick={onOpen}>
      <div className="due-top">
        <span className="due-avatar">{due.person.slice(0, 1).toUpperCase()}</span>
        <div className="grow">
          <div className="due-name">{due.person}{due.person_household_id && <span className="pill">household</span>}</div>
          <div className="muted small">
            {first ? `since ${fmtDate(first.occurred_on)}` : 'no entries yet'}
            {due.emi && due.balance !== 0 ? ` · EMI ${money(due.emi.expected_amount)}${due.emi.day_of_month ? ` on ${ordinal(due.emi.day_of_month)}` : ''}` : ''}
          </div>
        </div>
        <Balance balance={due.balance} />
      </div>
      {due.entries.length > 1 && (
        <>
          <div className="bar"><div className="fill ok" style={{ width: `${pct * 100}%` }} /></div>
          <div className="muted small due-foot">
            <span>{Math.round(pct * 100)}% repaid</span>
            {last && <span>last: {entryLabel(last, first.direction).toLowerCase()} {money(last.amount)} · {fmtDate(last.occurred_on)}</span>}
          </div>
        </>
      )}
    </button>
  )
}

function DueSheet({ due, households, accounts, onClose, onEdit, onChanged }) {
  const [entryForm, setEntryForm] = useState(null) // { direction } new, or { entry } edit
  const first = due.entries[0]
  const other = households.find((h) => h.id === due.person_household_id)
  const [primary, secondary] = actionsFor(due.balance)
  return (
    <>
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal due-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="due-top">
          <span className="due-avatar big">{due.person.slice(0, 1).toUpperCase()}</span>
          <div className="grow">
            <h3 style={{ margin: 0 }}>{due.person}</h3>
            {due.note && <div className="muted small">{due.note}</div>}
          </div>
          <button className="btn icon" aria-label="Edit due" onClick={onEdit}><PencilIcon /></button>
        </div>
        <Balance balance={due.balance} />
        {due.emi && (
          <div className="muted small">
            {due.balance === 0 ? 'EMI paused — settled.' : `EMI ${money(due.emi.expected_amount)}${due.emi.day_of_month ? ` on the ${ordinal(due.emi.day_of_month)}` : ''} · shows in Plan`}
          </div>
        )}
        {other && <div className="muted small">Entries are logged as ⇄ transfers with {other.name}.</div>}

        <div className="due-history">
          {due.entries.length === 0 && <div className="muted small">No entries yet.</div>}
          {[...due.entries].reverse().map((e) => (
            <button key={e.id} className="due-entry" onClick={() => setEntryForm({ entry: e })}>
              <span className={`due-dir ${e.direction}`}>{e.direction === 'out' ? '↑' : '↓'}</span>
              <div className="grow">
                <div>{entryLabel(e, first.direction)}{(e.transaction_id || e.transfer_id) && <span className="pill">in Budget</span>}</div>
                <div className="muted small">{fmtDate(e.occurred_on)}{e.note ? ` · ${e.note}` : ''}</div>
              </div>
              <b className={`amt ${e.direction === 'out' ? 'neg' : 'pos'}`}>{e.direction === 'out' ? '−' : '+'}{money(e.amount)}</b>
            </button>
          ))}
        </div>

        <div className="actions">
          <button className="btn" onClick={() => setEntryForm({ direction: secondary.direction, label: secondary.label })}>{secondary.label}</button>
          <button className="btn primary" onClick={() => setEntryForm({ direction: primary.direction, label: primary.label })}>{primary.label}</button>
        </div>
      </div>
    </div>
    {entryForm && <EntryForm due={due} accounts={accounts} {...entryForm} onClose={() => setEntryForm(null)}
      onSaved={() => { setEntryForm(null); onChanged() }} />}
    </>
  )
}

function EntryForm({ due, accounts, direction, label, entry, onClose, onSaved }) {
  const dialog = useDialog()
  const [form, setForm] = useState(() => entry
    ? { amount: String(entry.amount), date: entry.occurred_on, note: entry.note || '' }
    : { amount: due.emi && due.balance !== 0 ? String(due.emi.expected_amount) : '', date: today(), note: '', toBudget: true, account: due.emi?.account_id || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const dir = entry ? entry.direction : direction
  const title = entry ? entryLabel(entry, due.entries[0].direction) : label

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const amount = Number(form.amount)
      if (entry) await updateEntry(entry, { amount, occurredOn: form.date, note: form.note.trim() })
      else await addEntry(due, { direction: dir, amount, occurredOn: form.date, note: form.note.trim(), toBudget: form.toBudget, accountId: form.account || null })
      onSaved()
    } catch (err) { setError(err.message); setBusy(false) }
  }

  async function remove() {
    const mirrored = entry.transaction_id || entry.transfer_id
    if (!await dialog.confirm({ title: 'Delete this entry?', message: `The balance with ${due.person} changes back.${mirrored ? ' Its Budget entry is deleted too.' : ''}`, confirmLabel: 'Delete' })) return
    try { await deleteEntry(entry); onSaved() } catch (err) { setError(err.message) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3 className={`kind-title ${dir === 'out' ? 'expense' : 'income'}`}>{title} · {due.person}</h3>
        <label>Amount
          <input type="number" inputMode="decimal" step="0.01" min="0.01" required autoFocus={!entry} value={form.amount} onChange={set('amount')} />
        </label>
        <div className="row2">
          <label>Date<input type="date" required value={form.date} onChange={set('date')} /></label>
          {!entry && !due.person_household_id && accounts.length > 0 && (
            <label>Account
              <select value={form.account} onChange={set('account')} disabled={!form.toBudget}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label>Note <span className="muted">(optional)</span><input value={form.note} onChange={set('note')} placeholder="e.g. paid by UPI" /></label>
        {!entry && (
          <label className="check"><input type="checkbox" checked={form.toBudget} onChange={set('toBudget')} />
            {due.person_household_id ? 'Also log as a ⇄ transfer in Budget' : `Also add to Budget entries (${dir === 'out' ? 'expense' : 'income'})`}
          </label>
        )}
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          {entry && <button type="button" className="btn icon" aria-label="Delete entry" onClick={remove}><TrashIcon /></button>}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

function DueForm({ due, households, household, onClose, onSaved, onDeleted }) {
  const dialog = useDialog()
  const others = households.filter((h) => h.id !== household?.id)
  const [form, setForm] = useState(() => ({
    person: due?.person || '', personHouseholdId: due?.person_household_id || '', note: due?.note || '',
    direction: 'in', amount: '', date: today(), toBudget: false,
    emiOn: !!due?.emi, emiAmount: due?.emi ? String(due.emi.expected_amount) : '', emiDay: due?.emi?.day_of_month ? String(due.emi.day_of_month) : '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const you = household?.name || 'You'

  function pickHousehold(e) {
    const id = e.target.value
    const h = households.find((x) => x.id === id)
    setForm((f) => ({ ...f, personHouseholdId: id, person: h && (!f.person || others.some((o) => o.name === f.person)) ? h.name : f.person }))
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const saved = await saveDue({
        id: due?.id, householdId: household.id, person: form.person, personHouseholdId: form.personHouseholdId, note: form.note.trim(),
        opening: due ? null : { direction: form.direction, amount: Number(form.amount), occurredOn: form.date, toBudget: form.toBudget, note: 'Opening amount' },
        emi: form.emiOn && Number(form.emiAmount) > 0 ? { amount: Number(form.emiAmount), day: form.emiDay ? Number(form.emiDay) : null } : null,
      })
      onSaved(saved)
    } catch (err) { setError(err.message); setBusy(false) }
  }

  async function remove() {
    if (!await dialog.confirm({ title: `Delete the due with ${due.person}?`, message: `Its ${due.entries.length} entr${due.entries.length === 1 ? 'y' : 'ies'} and EMI are removed. Entries already added to Budget stay there.`, confirmLabel: 'Delete' })) return
    try { await deleteDue(due); onDeleted() } catch (err) { setError(err.message) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{due ? 'Edit due' : 'New due'}</h3>
        {!due && (
          <div className="seg">
            <button type="button" className={form.direction === 'in' ? 'on expense' : ''} onClick={() => setForm((f) => ({ ...f, direction: 'in' }))}>{you} owe{household ? 's' : ''} them</button>
            <button type="button" className={form.direction === 'out' ? 'on income' : ''} onClick={() => setForm((f) => ({ ...f, direction: 'out' }))}>They owe {household ? household.name : 'you'}</button>
          </div>
        )}
        <label>Person<input required value={form.person} onChange={set('person')} placeholder="e.g. Mama, Neighbour" autoFocus={!due} /></label>
        {others.length > 0 && (
          <label>Is it one of your households? <span className="muted">(optional)</span>
            <select value={form.personHouseholdId} onChange={pickHousehold}>
              <option value="">No — someone else</option>
              {others.map((h) => <option key={h.id} value={h.id}>{h.name} — log as ⇄ transfers</option>)}
            </select>
          </label>
        )}
        {!due && (
          <>
            <div className="row2">
              <label>Amount<input type="number" inputMode="decimal" step="0.01" min="0.01" required value={form.amount} onChange={set('amount')} /></label>
              <label>Since<input type="date" required value={form.date} onChange={set('date')} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={form.toBudget} onChange={set('toBudget')} /> This money moved now — add it to Budget too</label>
          </>
        )}
        <label>Note <span className="muted">(optional)</span><input value={form.note} onChange={set('note')} placeholder="e.g. for the house repair" /></label>
        <label className="check"><input type="checkbox" checked={form.emiOn} onChange={set('emiOn')} /> Repaid in monthly EMIs (shows in Plan)</label>
        {form.emiOn && (
          <div className="row2">
            <label>EMI amount<input type="number" inputMode="decimal" step="0.01" min="0.01" required value={form.emiAmount} onChange={set('emiAmount')} /></label>
            <label>Day of month <span className="muted">(optional)</span><input type="number" inputMode="numeric" min="1" max="31" value={form.emiDay} onChange={set('emiDay')} placeholder="e.g. 10" /></label>
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          {due && <button type="button" className="btn icon" aria-label="Delete due" onClick={remove}><TrashIcon /></button>}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
