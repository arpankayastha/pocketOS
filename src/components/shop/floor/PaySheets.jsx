import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { collectSplit, durLabel, endBill, inr, priceFor, rs, sessionEnd, timeLabel, useNow } from '../../../lib/shop'
import { Chips, Sheet, SheetActions, SumRow } from '../ui'
import { UpiQrButton } from '../UpiQr'
import { depositOf, dueOf, FNB, payAdd, payNote, payOptions, saveSession, SplitPay, useDepositPick } from './common'

// Owner, 14 Oct: the customer paid while still playing (staff forgot to pick a payment) — record it now;
// End & collect then only asks for what's left.
export function CollectSheet({ session, settings, onClose, onDone }) {
  // Also takes what was put in their dues while playing (owner, 15 Oct: tejas paid but showed Paid ₹0).
  const [amount, setAmount] = useState(() => String(Math.round(dueOf(session) + Number(session.owed || 0))))
  const [mode, setMode] = useState('cash')
  const [busy, setBusy] = useState(false)
  const { due, value, fromDues } = collectSplit(session, amount)
  async function save() {
    if (!value) return
    setBusy(true)
    const { error } = await saveSession(session.id, { add: { [mode === 'cash' ? 'paid_cash' : 'paid_online']: value, owed: -fromDues } })
    setBusy(false)
    onDone(error ? error.message : `${rs(value)} ${mode} collected from ${session.customer_name}${due - value > 0 ? ` · ${rs(due - value)} still to collect` : ''}`)
  }
  return (
    <Sheet title={`Collect · ${session.customer_name}`} sub={`${session.system_name} · ${rs(due)} to collect so far · keeps playing`} onClose={onClose} onSubmit={save}>
      <label>Amount (₹)<input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <Chips options={[['cash', 'Cash'], ['online', 'Online']]} value={mode} onChange={setMode} />
      {mode === 'online' && <UpiQrButton settings={settings} amount={value} note={`${session.system_name} · ${session.customer_name}`} />}
      <SheetActions onClose={onClose} busy={busy} disabled={!value} label={`Collect ${rs(value)}`} />
    </Sheet>
  )
}

export function FnbSheet({ session, settings, deposits = [], onClose, onDone }) {
  const d = useDepositPick(deposits, session.customer_name, session.customer_phone), dep = d.dep
  const [amt, setAmt] = useState(20)
  const [custom, setCustom] = useState('')
  const [pay, setPay] = useState('end')
  const [cashPart, setCashPart] = useState('')
  const [busy, setBusy] = useState(false)
  const value = custom ? Number(custom) : amt
  async function save() {
    if (pay === 'due' && session.customer_name === 'Walk-in') { onDone('Add the customer’s name first to keep it as dues.'); return }
    setBusy(true)
    const fromDep = pay === 'deposit' && dep ? Math.min(dep.balance, value) : 0
    const { error } = await saveSession(session.id, {
      add: { fnb_while: value, ...(fromDep ? { paid_deposit: fromDep } : payAdd(pay, value, cashPart)) },
      note: pay === 'due' ? `Due: F&B ${inr(value)}` : fromDep && d.friend ? `From ${dep.name}’s deposit ${inr(fromDep)}` : null,
      deposit: depositOf(dep, fromDep),
    })
    setBusy(false)
    if (error) { onDone(error.message); return }
    onDone(`${rs(value)} F&B added to ${session.system_name}${payNote(pay)}`)
  }
  return (
    <Sheet title={`F&B · ${session.system_name}`} sub={`${session.customer_name} · added to the bill`} onClose={onClose} onSubmit={save}>
      <Chips scroll options={FNB.slice(1)} value={custom ? null : amt} onChange={(v) => { setAmt(v); setCustom('') }} />
      <label>Other amount<input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} placeholder="₹" /></label>
      <div className="caps muted">Payment</div>
      <Chips options={payOptions(d)} value={pay} onChange={setPay} />
      {pay === 'deposit' && d.picker}
      {pay === 'deposit' && dep && value > dep.balance && <p className="muted small" style={{ margin: 0 }}>{rs(dep.balance)} from the deposit, {rs(value - dep.balance)} with the bill at the end.</p>}
      {pay === 'online' && value > 0 && <UpiQrButton settings={settings} amount={value} note={`${session.system_name} F&B · ${session.customer_name}`} />}
      {pay === 'split' && value > 0 && <SplitPay value={value} cashPart={cashPart} setCashPart={setCashPart} settings={settings} note={`${session.system_name} F&B · ${session.customer_name}`} />}
      <SheetActions onClose={onClose} busy={busy} disabled={!(value > 0)} label={`Add ${rs(value || 0)}`} />
    </Sheet>
  )
}

// Owner (13 Oct): each extension is charged on its own from the rate card — +30 min is ₹50 every time
// (before, the 2nd +30 min came to ₹30 because it was "2 h price − 1 h 30 m price").
export function ExtendSheet({ system, session, rates, settings, deposits = [], onClose, onDone }) {
  const d = useDepositPick(deposits, session.customer_name, session.customer_phone), dep = d.dep
  const [add, setAdd] = useState(30)
  const [pay, setPay] = useState('end')
  const [cashPart, setCashPart] = useState('')
  const [busy, setBusy] = useState(false)
  const minutes = session.minutes + add
  const extra = priceFor(rates, system.kind, add, session.happy) * (session.players || 1)
  const newEnd = sessionEnd({ ...session, minutes })
  async function save() {
    if (pay === 'due' && session.customer_name === 'Walk-in') { onDone('Add the customer’s name first to keep it as dues.'); return }
    setBusy(true)
    const fromDep = pay === 'deposit' && dep ? Math.min(dep.balance, extra) : 0
    const { error } = await saveSession(session.id, {
      add: { minutes: add, extend_amount: extra, ...(fromDep ? { paid_deposit: fromDep } : payAdd(pay, extra, cashPart)) },
      note: pay === 'due' ? `Due: extend ${durLabel(add)} ${inr(extra)}` : fromDep && d.friend ? `From ${dep.name}’s deposit ${inr(fromDep)}` : null,
      deposit: depositOf(dep, fromDep),
    })
    setBusy(false)
    if (error) { onDone(error.message); return }
    onDone(`${session.system_name} now ends ${timeLabel(newEnd)} · +${rs(extra)}${payNote(pay)}`)
  }
  return (
    <Sheet title={`Extend ${session.system_name}`} sub={`${session.customer_name} · now ends ${timeLabel(sessionEnd(session))}`} onClose={onClose} onSubmit={save}>
      <Chips options={[[30, '+30 min'], [60, '+1 hr'], [90, '+1h 30m'], [120, '+2 hr'], [180, '+3 hr'], [240, '+4 hr']]} value={add} onChange={setAdd} />
      <div className="gx-box">
        <SumRow label="New end" value={timeLabel(newEnd)} />
        <SumRow strong label="Extend amount" value={`+${rs(extra)}`} />
      </div>
      <div className="caps muted">Payment</div>
      <Chips options={payOptions(d)} value={pay} onChange={setPay} />
      {pay === 'deposit' && d.picker}
      {pay === 'deposit' && dep && extra > dep.balance && <p className="muted small" style={{ margin: 0 }}>{rs(dep.balance)} from the deposit, {rs(extra - dep.balance)} with the bill at the end.</p>}
      {pay === 'online' && <UpiQrButton settings={settings} amount={extra} note={`${session.system_name} extend · ${session.customer_name}`} />}
      {pay === 'split' && <SplitPay value={extra} cashPart={cashPart} setCashPart={setCashPart} settings={settings} note={`${session.system_name} extend · ${session.customer_name}`} />}
      <SheetActions onClose={onClose} busy={busy} label="Extend" />
    </Sheet>
  )
}

export function EndSheet({ session, settings, deposits = [], onClose, onDone }) {
  const now = useNow(30_000)
  const d = useDepositPick(deposits, session.customer_name, session.customer_phone), dep = d.dep
  const [useDep, setUseDep] = useState(!!d.own)
  const [mode, setMode] = useState('cash')
  const [discount, setDiscount] = useState('')
  const [cashPart, setCashPart] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const disc = Number(discount) || 0
  // owedBefore = Extend / F&B put as "Due" while playing — already in their dues
  const { paid, owedBefore, fromDep, due, cash, online, owed } = endBill(session, { discount: disc, deposit: dep?.balance || 0, useDeposit: useDep && !!dep, mode, cashPart })

  async function save() {
    if (mode === 'owes' && session.customer_name === 'Walk-in') { setError('Add the customer’s name to keep this as dues.'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    // Owner, 17 Oct: the out time is when play ended (its planned end if End & collect is pressed later, e.g.
    // next morning); when it was collected is kept apart.
    const { error } = await saveSession(session.id, {
      add: { discount: disc, paid_cash: cash, paid_online: online, owed, paid_deposit: fromDep },
      set: { status: 'closed', ended_at: new Date(Math.min(Date.now(), sessionEnd(session).getTime())).toISOString(), collected_at: new Date().toISOString(), closed_by: user?.id || null },
      note: [owed && `Due: bill at the end ${inr(owed)}`, fromDep && d.friend && `From ${dep.name}’s deposit ${inr(fromDep)}`].filter(Boolean).join(' · ') || null,
      deposit: depositOf(dep, fromDep),
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(mode === 'owes' ? `${session.system_name} is free. ${rs(owed)} kept as ${session.customer_name}’s dues.`
      : `${session.system_name} is free. ${rs(due)} collected.`)
  }

  async function cancel() {
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('id', session.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${session.system_name} session removed`)
  }

  return (
    <Sheet title={`End ${session.system_name} · ${session.customer_name}`} sub={`${timeLabel(session.started_at)} – ${timeLabel(now)}`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <div className="gx-box">
        <SumRow label={`Gaming · ${durLabel(session.base_minutes)}${session.players > 1 ? ` × ${session.players}` : ''}${session.happy ? ' · happy hours' : ''}`} value={rs(session.gaming_amount)} />
        {Number(session.extend_amount) > 0 && <SumRow label={`Extended · ${durLabel(session.minutes - session.base_minutes)}`} value={rs(session.extend_amount)} />}
        {Number(session.fnb_before) > 0 && <SumRow label="F&B before" value={rs(session.fnb_before)} />}
        {Number(session.fnb_while) > 0 && <SumRow label="F&B while gaming" value={rs(session.fnb_while)} />}
        {disc > 0 && <SumRow label="Discount" value={`−${rs(disc)}`} />}
        {paid > 0 && <SumRow label="Already paid" value={`−${rs(paid)}`} />}
        {fromDep > 0 && <SumRow label="From deposit" value={`−${rs(fromDep)}`} />}
        {owedBefore > 0 && <SumRow label="Already in their dues" value={`−${rs(owedBefore)}`} />}
        <SumRow strong label="To collect" value={rs(due)} />
      </div>
      {d.any && (
        <label className="gx-check"><input type="checkbox" checked={useDep} onChange={(e) => setUseDep(e.target.checked)} />
          {d.own ? `Use ${d.own.name}’s deposit · ${rs(d.own.balance)} left` : 'Pay from a deposit (a friend’s)'}</label>
      )}
      {useDep && d.picker}
      <div className="caps muted">Paid by</div>
      <Chips options={[['cash', 'Cash'], ['online', 'Online'], ['split', 'Cash + Online'], ['owes', 'Owes (dues)']]} value={mode} onChange={setMode} />
      {(mode === 'online' || mode === 'split') && <UpiQrButton settings={settings} amount={online} note={`${session.system_name} · ${session.customer_name}`} />}
      {mode === 'split' && <label>Cash part<input inputMode="numeric" value={cashPart} onChange={(e) => setCashPart(e.target.value.replace(/\D/g, ''))} placeholder={`of ${rs(due)} — rest is online`} /></label>}
      <label>Discount (optional)<input inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ''))} placeholder="₹" /></label>
      <SheetActions onClose={onClose} busy={busy} label={due === 0 && fromDep > 0 ? 'Paid from deposit · end' : mode === 'owes' ? `Save ${rs(due)} as dues` : `Collect ${rs(due)}`} />
      {paid === 0 && <button type="button" className="btn link" style={{ justifySelf: 'start', color: 'var(--neg)' }} onClick={cancel}>Started by mistake? Remove this session</button>}
    </Sheet>
  )
}
