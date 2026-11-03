import { useCallback, useEffect, useState } from 'react'
import { useDialog } from '../../lib/dialog'
import { supabase } from '../../lib/supabase'
import { hoursLabel2, rs } from '../../lib/shop'
import { telLink, waLink } from '../../lib/products'
import { ActionSheet, Chips, Sheet, SheetActions } from '../shop/ui'
import CustomerFields from '../shop/CustomerFields'
import { UpiQrButton } from '../shop/UpiQr'
import { downloadCsv, ymd } from './MonthPicker'

// Admin → Customers → Members (owner, 3 Nov): everyone on a membership plan. Online ones arrive "to check" (Slots →
// Bookings: Received / Not received); a plan paid at the counter is added here and starts at once.
const today = () => new Date().toLocaleDateString('en-CA')
const day = (d) => (d ? new Date(`${d}T00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—')
// Owner, 3 Nov: a plan ends by itself after its days (7 / 15 / 30 — ends_on) or when every hour is played; ended ones
// wait under Ended with the hours and ₹ left and the end date until the admin taps Clear (cleared_at, kept).
const expired = (x) => x.ends_on && x.ends_on < today()
const stateOf = (x) => (x.status === 'requested' ? 'To check' : expired(x) || !x.left_minutes ? (x.cleared_at ? 'Cleared' : 'Ended') : 'Active')
const endedOn = (x) => (expired(x) ? day(x.ends_on) : x.last_played ? day(x.last_played.slice(0, 10)) : '—')
const endedWhy = (x) => (expired(x) ? `validity ended (${Number(x.days) || ''} days)` : 'all hours played')

export default function Members({ shop, householdId, toast }) {
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('Active')
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)
  const dialog = useDialog()
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('shop_membership_status').select('*').eq('household_id', householdId).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1000)
    if (error) toast(error.message); else setRows(data)
  }, [householdId, toast])
  useEffect(() => { load() }, [load])
  async function clear(x, undo) {
    if (!undo && !await dialog.confirm({ title: `Clear ${x.name}’s ${x.plan_name}?`, message: `${hoursLabel2(x.left_minutes)} · ${rs(x.left_amount)} left unused, ended ${endedOn(x)}. It moves to Cleared (kept in the records).`, confirmLabel: 'Clear' })) return
    const { error } = await supabase.from('shop_memberships').update({ cleared_at: undo ? null : new Date().toISOString() }).eq('id', x.id)
    if (error) { toast(error.message); return }
    toast(undo ? 'Back under Ended' : 'Cleared'); setOpen(null); load()
  }
  if (!rows) return <div className="card muted">Loading members…</div>
  const list = rows.filter((x) => filter === 'All' || stateOf(x) === filter)
  const count = (s) => rows.filter((x) => stateOf(x) === s).length
  return (<>
    <div className="admin-row">
      <Chips options={[['Active', `Active ${count('Active')}`], ['To check', `To check ${count('To check')}`], ['Ended', `Ended ${count('Ended')}`], ['Cleared', 'Cleared'], ['All', 'All']]} value={filter} onChange={setFilter} />
      <div className="gx-btns">
        <button className="btn small" onClick={() => downloadCsv(`grandxgamer-members-${ymd(new Date())}`, [['name', 'Name'], ['phone', 'Mobile'], ['plan_name', 'Plan'], [(x) => (x.kind === 'PS' ? 'PS5' : 'PC'), 'For'], ['hours', 'Hours'], [(x) => Math.round(x.used_minutes / 6) / 10, 'Hours played'], [(x) => Math.round(x.left_minutes / 6) / 10, 'Hours left'], ['amount', 'Paid ₹'], ['left_amount', 'Left ₹'], ['pay_mode', 'Paid by'], ['starts_on', 'Starts'], ['ends_on', 'Ends'], [(x) => (stateOf(x) === 'Active' || stateOf(x) === 'To check' ? '' : endedOn(x)), 'Ended on'], [(x) => stateOf(x), 'Status']], list)}>Excel</button>
        <button className="btn small primary" onClick={() => setAdding(true)}>+ Add member</button>
      </div>
    </div>
    <div className="card admin-table-card">
      <table className="admin-table click">
        <thead><tr><th>Member</th><th>Plan</th><th>Played</th><th>Left</th><th className="wide">{filter === 'Ended' || filter === 'Cleared' ? 'Ended' : 'Ends'}</th><th className="wide">Status</th></tr></thead>
        <tbody>{list.map((x) => (
          <tr key={x.id} onClick={() => setOpen(x)}>
            <td><b>{x.name}</b><div className="muted small">{x.phone || 'no mobile'}</div></td>
            <td>{x.plan_name}<div className="muted small">{x.kind === 'PS' ? 'PS5' : 'PC'} · {Number(x.hours)} h</div></td>
            <td>{hoursLabel2(x.used_minutes)}</td>
            <td><b className={x.left_minutes ? 'pos' : 'muted'}>{hoursLabel2(x.left_minutes)}</b><div className="muted small">{rs(x.left_amount)} of {rs(x.amount)}</div></td>
            <td className="wide">{x.status === 'requested' ? <span className="pill gx-pill ending">check</span> : stateOf(x) === 'Active' ? day(x.ends_on) : `ended ${endedOn(x)}`}</td><td className="wide">{stateOf(x)}</td>
          </tr>
        ))}</tbody>
      </table>
      {list.length === 0 && <div className="muted small" style={{ padding: 12 }}>No members here yet. Online ones appear in Slots → Bookings to check; counter ones with + Add member.</div>}
    </div>
    {open && (
      <ActionSheet title={open.name} sub={`${open.plan_name} · ${open.kind === 'PS' ? 'PS5' : 'PC'} · ${Number(open.hours)} hours · ${stateOf(open)}`} onClose={() => setOpen(null)}>
        <div className="gx-details">
          <div><span>Played</span><b>{hoursLabel2(open.used_minutes)} of {Number(open.hours)} h</b></div>
          <div><span>{stateOf(open) === 'Active' ? 'Left' : 'Left unused'}</span><b className={stateOf(open) === 'Active' ? 'pos' : ''}>{hoursLabel2(open.left_minutes)} · {rs(open.left_amount)}</b></div>
          <div><span>Paid</span><b>{rs(open.amount)} · {open.pay_mode}{open.upi_ref ? ` · ref ${open.upi_ref}` : ''}</b></div>
          {(stateOf(open) === 'Ended' || stateOf(open) === 'Cleared') && <div><span>Ended</span><b className="neg">{endedOn(open)} · {endedWhy(open)}</b></div>}
          {open.cleared_at && <div><span>Cleared</span><b>{new Date(open.cleared_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{open.cleared_by ? ` · by ${open.cleared_by}` : ''}</b></div>}
          <div><span>Valid</span><b>{open.starts_on ? `${day(open.starts_on)} – ${day(open.ends_on)}` : 'starts when the payment is confirmed'}</b></div>
          <div><span>Joined</span><b>{new Date(open.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {open.source === 'online' ? 'online' : `by ${open.entered_by || '—'}`}{open.handled_by ? ` · ✓ ${open.handled_by}` : ''}</b></div>
        </div>
        {stateOf(open) === 'Ended' && <button className="btn primary block" onClick={() => clear(open)}>Clear · ended {endedOn(open)}</button>}
        {stateOf(open) === 'Cleared' && <button className="btn block" onClick={() => clear(open, true)}>Undo clear</button>}
        {open.phone && <div className="gx-btns"><a className="btn small" href={telLink(open.phone)}>Call</a><a className="btn small" href={waLink(open.phone, `Hi ${open.name}, `)} target="_blank" rel="noreferrer">WhatsApp</a></div>}
      </ActionSheet>
    )}
    {adding && <AddMember shop={shop} householdId={householdId} onClose={() => setAdding(false)} onDone={(msg) => { setAdding(false); toast(msg); load(); shop.reload() }} />}
  </>)
}

export function AddMember({ shop, householdId, onClose, onDone }) {
  const plans = shop.settings?.membership?.plans || []
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [i, setI] = useState(0)
  const [kind, setKind] = useState('PC')
  const [mode, setMode] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const p = plans[i]
  const price = p ? (kind === 'PS' ? p.ps5 : p.pc) : 0
  async function save() {
    if (name.trim().length < 2) { setError('Add the customer’s name.'); return }
    if (!price) { setError('This plan has no price for that.'); return }
    setBusy(true); setError(null)
    const t = new Date(), days = Number(p.days) || 30
    const { error } = await supabase.from('shop_memberships').insert({ household_id: householdId, name: name.trim(), phone: phone.replace(/\D/g, '').slice(-10) || null,
      plan_name: p.name, pass: p.pass || null, kind, hours: p.hours, days, amount: price, pay_mode: mode, status: 'active', source: 'counter',
      starts_on: t.toLocaleDateString('en-CA'), ends_on: new Date(t.getTime() + (days - 1) * 86_400_000).toLocaleDateString('en-CA') })
    setBusy(false)
    if (error) setError(error.message); else onDone(`${name.trim()} joined ${p.name} · ${rs(price)} ${mode}`)
  }
  if (!plans.length) return <Sheet title="Add member" onClose={onClose} onSubmit={onClose}><p className="muted">Set up the plans first in Website → Membership plans.</p><SheetActions onClose={onClose} label="OK" /></Sheet>
  return (
    <Sheet title="Add member" sub="Paid at the counter · starts today" onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <CustomerFields householdId={householdId} name={name} setName={setName} phone={phone} setPhone={setPhone} />
      <div className="caps muted">Plan</div>
      <Chips options={plans.map((x, j) => [j, x.name])} value={i} onChange={setI} />
      <Chips options={[['PC', `PC · ${rs(p?.pc)}`], ['PS', `PS5 · ${rs(p?.ps5)}`]]} value={kind} onChange={setKind} />
      <div className="caps muted">Paid by</div>
      <Chips options={[['cash', 'Cash'], ['online', 'Online']]} value={mode} onChange={setMode} />
      {mode === 'online' && <UpiQrButton settings={shop.settings} amount={price} note={`Membership ${p?.name} · ${name.trim() || 'member'}`} />}
      <SheetActions onClose={onClose} busy={busy} label={`Add · ${rs(price)}`} />
    </Sheet>
  )
}
