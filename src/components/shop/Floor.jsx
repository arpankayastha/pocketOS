import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { DURATIONS, balanceFor, durLabel, isHappyDay, minutesLeft, priceFor, sessionEnd, sessionPaid, sessionTotal, timeLabel, useNow, rs } from '../../lib/shop'
import { Chips, Sheet, SheetActions, SumRow } from './ui'

// The Floor: every system with its live state. Free → Start; playing → + F&B, Extend, End & collect.
// Replaces the sheet's rows (Name, System, Time in/out, F&B, Extend, Total, Payment mode).
export default function Floor({ shop, householdId, toast }) {
  const now = useNow(10_000)
  const [sheet, setSheet] = useState(null) // { kind: 'start'|'fnb'|'extend'|'end', system, session }
  const running = new Map(shop.sessions.filter((s) => s.status === 'running').map((s) => [s.system_id, s]))
  const busy = shop.systems.filter((s) => running.has(s.id)).length
  const close = () => setSheet(null)
  const done = (msg) => { setSheet(null); toast(msg); shop.reload() }

  if (!shop.systems.length) return <div className="card muted">No systems yet. The admin adds them in ⚙ → Systems & rates.</div>

  return (
    <section className="gx-floor">
      <div className="chips">
        <span className="pill gx-pill busy">{busy} playing</span>
        <span className="pill gx-pill free">{shop.systems.length - busy} free</span>
        {isHappyDay(shop.settings) && <span className="pill gx-pill happy">Happy hours today</span>}
      </div>
      {shop.systems.map((sys) => {
        const s = running.get(sys.id)
        if (!s) {
          return (
            <div key={sys.id} className="card gx-sys free">
              <div className="gx-sys-top">
                <span className={`gx-badge ${sys.kind === 'PS' ? 'ps' : ''}`}>{sys.name}</span>
                <div className="grow"><div className="gx-free">Free</div><div className="muted small">{sys.kind === 'PS' ? 'PlayStation' : 'PC'}</div></div>
                <button className="btn small gx-ok" onClick={() => setSheet({ kind: 'start', system: sys })}>Start</button>
              </div>
            </div>
          )
        }
        const left = minutesLeft(s, now)
        const state = left <= 0 ? 'over' : left <= 5 ? 'ending' : 'busy'
        const pct = Math.min(100, Math.max(0, 100 - (left / s.minutes) * 100))
        const fnb = Number(s.fnb_before) + Number(s.fnb_while)
        return (
          <div key={sys.id} className={`card gx-sys ${state}`}>
            <div className="gx-sys-top">
              <span className={`gx-badge ${sys.kind === 'PS' ? 'ps' : ''}`}>{sys.name}</span>
              <div className="grow">
                <div className="gx-name">{s.customer_name}{s.players > 1 ? ` · ${s.players} players` : ''}</div>
                <div className="muted small">{timeLabel(s.started_at)} – {timeLabel(sessionEnd(s))}{fnb ? ` · F&B ${rs(fnb)}` : ''}</div>
              </div>
              <span className={`pill gx-pill ${state}`}>{left <= 0 ? `Time up ${durLabel(-left)} ago` : `${durLabel(left)} left`}</span>
            </div>
            <div className="gx-bar"><i style={{ width: `${pct}%` }} /></div>
            <div className="gx-btns">
              <button className="btn small" onClick={() => setSheet({ kind: 'fnb', system: sys, session: s })}>+ F&amp;B</button>
              <button className="btn small" onClick={() => setSheet({ kind: 'extend', system: sys, session: s })}>Extend</button>
              <button className="btn small primary" style={{ marginLeft: 'auto' }} onClick={() => setSheet({ kind: 'end', system: sys, session: s })}>End &amp; collect</button>
            </div>
          </div>
        )
      })}
      {sheet?.kind === 'start' && <StartSheet system={sheet.system} rates={shop.rates} happy={isHappyDay(shop.settings)} householdId={householdId} onClose={close} onDone={done} />}
      {sheet?.kind === 'fnb' && <FnbSheet session={sheet.session} onClose={close} onDone={done} />}
      {sheet?.kind === 'extend' && <ExtendSheet system={sheet.system} session={sheet.session} rates={shop.rates} onClose={close} onDone={done} />}
      {sheet?.kind === 'end' && <EndSheet session={sheet.session} deposits={shop.deposits} householdId={householdId} onClose={close} onDone={done} />}
    </section>
  )
}

const FNB = [[0, 'None'], [10, '₹10'], [20, '₹20'], [30, '₹30'], [40, '₹40'], [60, '₹60']]

const MAX_PLAYERS = { PS: 3 } // one PS5, three controllers; PCs are one per head

function StartSheet({ system, rates, happy, householdId, onClose, onDone }) {
  const now = useNow(30_000)
  const [players, setPlayers] = useState(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [mins, setMins] = useState(60)
  const [fnb, setFnb] = useState(0)
  const [pay, setPay] = useState('end')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const each = priceFor(rates, system.kind, mins, happy)
  const gaming = each * players
  const total = gaming + fnb
  const maxPlayers = MAX_PLAYERS[system.kind] || 1

  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').insert({
      household_id: householdId, system_id: system.id, system_name: system.name,
      customer_name: name.trim() || 'Walk-in', customer_phone: phone.trim() || null,
      base_minutes: mins, minutes: mins, gaming_amount: gaming, fnb_before: fnb, players, happy,
      paid_cash: pay === 'cash' ? total : 0, paid_online: pay === 'online' ? total : 0,
    })
    setBusy(false)
    if (error) { setError(error.code === '23505' ? `${system.name} is already running.` : error.message); return }
    onDone(`${system.name} started for ${name.trim() || 'walk-in'} · ends ${timeLabel(new Date(new Date().getTime() + mins * 60_000))}`)
  }

  return (
    <Sheet title={`Start ${system.name}`} sub={`${timeLabel(now)} – ${timeLabel(now + mins * 60_000)}${happy ? ' · happy hours' : ''}`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <div className="grid2">
        <label>Customer<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoComplete="off" /></label>
        <label>Mobile<input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))} placeholder="Optional" inputMode="tel" autoComplete="off" /></label>
      </div>
      {maxPlayers > 1 && (<>
        <div className="caps muted">Players · charged per head</div>
        <Chips options={Array.from({ length: maxPlayers }, (_, i) => [i + 1, String(i + 1)])} value={players} onChange={setPlayers} />
      </>)}
      <div className="caps muted">Time</div>
      <Chips scroll options={DURATIONS.map((m) => [m, durLabel(m)])} value={mins} onChange={setMins} />
      <div className="caps muted">F&amp;B before gaming</div>
      <Chips scroll options={FNB} value={fnb} onChange={setFnb} />
      <div className="caps muted">Payment</div>
      <Chips options={[['end', 'At the end'], ['cash', 'Paid now · cash'], ['online', 'Paid now · online']]} value={pay} onChange={setPay} />
      <div className="gx-box">
        <SumRow label={`Gaming · ${durLabel(mins)}${players > 1 ? ` × ${players}` : ''}${happy ? ' · happy hours' : ''}`} value={rs(gaming)} />
        {fnb > 0 && <SumRow label="F&B" value={rs(fnb)} />}
        <SumRow strong label={pay === 'end' ? 'Total so far' : 'Paid now'} value={rs(total)} />
      </div>
      <SheetActions onClose={onClose} busy={busy} label="Start timer" />
    </Sheet>
  )
}

function FnbSheet({ session, onClose, onDone }) {
  const [amt, setAmt] = useState(20)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const value = custom ? Number(custom) : amt
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').update({ fnb_while: Number(session.fnb_while) + value }).eq('id', session.id)
    setBusy(false)
    if (error) { onDone(error.message); return }
    onDone(`${rs(value)} F&B added to ${session.system_name}`)
  }
  return (
    <Sheet title={`F&B · ${session.system_name}`} sub={`${session.customer_name} · added to the bill, paid at the end`} onClose={onClose} onSubmit={save}>
      <Chips scroll options={FNB.slice(1)} value={custom ? null : amt} onChange={(v) => { setAmt(v); setCustom('') }} />
      <label>Other amount<input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} placeholder="₹" /></label>
      <SheetActions onClose={onClose} busy={busy} disabled={!(value > 0)} label={`Add ${rs(value || 0)}`} />
    </Sheet>
  )
}

function ExtendSheet({ system, session, rates, onClose, onDone }) {
  const [add, setAdd] = useState(30)
  const [busy, setBusy] = useState(false)
  const minutes = session.minutes + add
  const extend = Math.max(0, priceFor(rates, system.kind, minutes, session.happy) * (session.players || 1) - Number(session.gaming_amount))
  const extra = extend - Number(session.extend_amount)
  const newEnd = new Date(new Date(session.started_at).getTime() + minutes * 60_000)
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').update({ minutes, extend_amount: extend }).eq('id', session.id)
    setBusy(false)
    if (error) { onDone(error.message); return }
    onDone(`${session.system_name} now ends ${timeLabel(newEnd)}`)
  }
  return (
    <Sheet title={`Extend ${session.system_name}`} sub={`${session.customer_name} · now ends ${timeLabel(sessionEnd(session))}`} onClose={onClose} onSubmit={save}>
      <Chips options={[[30, '+30 min'], [60, '+1 hr'], [120, '+2 hr']]} value={add} onChange={setAdd} />
      <div className="gx-box">
        <SumRow label="New end" value={timeLabel(newEnd)} />
        <SumRow strong label="Extend amount" value={`+${rs(extra)}`} />
      </div>
      <SheetActions onClose={onClose} busy={busy} label="Extend" />
    </Sheet>
  )
}

function EndSheet({ session, deposits = [], householdId, onClose, onDone }) {
  const now = useNow(30_000)
  const dep = balanceFor(deposits, session.customer_name, session.customer_phone)
  const [useDep, setUseDep] = useState(!!dep)
  const [mode, setMode] = useState('cash')
  const [discount, setDiscount] = useState('')
  const [cashPart, setCashPart] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const disc = Number(discount) || 0
  const total = sessionTotal(session) - disc
  const paid = sessionPaid(session)
  const before = Math.max(0, total - paid)
  const fromDep = useDep && dep ? Math.min(dep.balance, before) : 0
  const due = before - fromDep
  const cash = mode === 'cash' ? due : mode === 'split' ? Math.min(due, Number(cashPart) || 0) : 0
  const online = mode === 'online' ? due : mode === 'split' ? due - cash : 0
  const owed = mode === 'owes' ? due : 0

  async function save() {
    if (mode === 'owes' && session.customer_name === 'Walk-in') { setError('Add the customer’s name to keep this as dues.'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('shop_sessions').update({
      status: 'closed', ended_at: new Date().toISOString(), closed_by: user?.id,
      discount: Number(session.discount) + disc,
      paid_cash: Number(session.paid_cash) + cash, paid_online: Number(session.paid_online) + online, owed,
      paid_deposit: Number(session.paid_deposit || 0) + fromDep,
    }).eq('id', session.id)
    if (!error && fromDep > 0) {
      await supabase.from('shop_deposits').insert({ household_id: householdId, customer_name: dep.name, customer_phone: dep.phone || null, kind: 'use', amount: fromDep, session_id: session.id })
    }
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
        <SumRow strong label="To collect" value={rs(due)} />
      </div>
      {dep && (
        <label className="gx-check"><input type="checkbox" checked={useDep} onChange={(e) => setUseDep(e.target.checked)} />
          Use {dep.name}’s deposit · {rs(dep.balance)} left this month</label>
      )}
      <div className="caps muted">Paid by</div>
      <Chips options={[['cash', 'Cash'], ['online', 'Online'], ['split', 'Cash + Online'], ['owes', 'Owes (dues)']]} value={mode} onChange={setMode} />
      {mode === 'split' && <label>Cash part<input inputMode="numeric" value={cashPart} onChange={(e) => setCashPart(e.target.value.replace(/\D/g, ''))} placeholder={`of ${rs(due)} — rest is online`} /></label>}
      <label>Discount (optional)<input inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ''))} placeholder="₹" /></label>
      <SheetActions onClose={onClose} busy={busy} label={due === 0 && fromDep > 0 ? 'Paid from deposit · end' : mode === 'owes' ? `Save ${rs(due)} as dues` : `Collect ${rs(due)}`} />
      {paid === 0 && <button type="button" className="btn link" style={{ justifySelf: 'start', color: 'var(--neg)' }} onClick={cancel}>Started by mistake? Remove this session</button>}
    </Sheet>
  )
}
