import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { customerKey, duesByCustomer, DURATIONS, durLabel, inr, priceFor, rs, shareOut, startPayments, timeLabel } from '../../../lib/shop'
import { Chips, Sheet, SumRow } from '../ui'
import { UpiQrButton } from '../UpiQr'
import CustomerFields from '../CustomerFields'
import { depLabel, FNB, useDepositPick } from './common'

// Start one PC, or one or more PS5 controllers together (each controller = one customer, one timer, priced
// per head). A booking's amount is split across its controllers as already paid online.
export function StartSheet({ system: first, seats, freeOf, systems, booking, dues, deposits = [], rates, settings, happy, householdId, onClose, onDone }) {
  // Owner: "booked PC2 but sat at PC4" — any free system of the same kind can be picked here.
  const [system, setSystem] = useState(first)
  const free = freeOf(system)
  const others = systems.filter((x) => x.kind === first.kind && freeOf(x).length > 0)
  const [picked, setPicked] = useState(seats || [free[0]])
  const [cashPart, setCashPart] = useState('')
  const [name, setName] = useState(booking?.customer_name || '')
  const [phone, setPhone] = useState(booking?.customer_phone || '')
  const [mins, setMins] = useState(booking?.minutes || 60)
  const [fnb, setFnb] = useState(0)
  const [fnbOther, setFnbOther] = useState('') // owner: type any F&B amount, not only the chips
  const [names, setNames] = useState({}) // PS5: a name for each extra controller (owner, 14 Oct), keyed by controller
  const online = booking && booking.source !== 'counter' // online bookings are paid in full by UPI
  const [pay, setPay] = useState(online ? 'booked' : 'end')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const multi = (system.seats || 1) > 1
  const count = picked.length
  const each = priceFor(rates, system.kind, mins, happy)
  const bookedSame = booking && mins === booking.minutes && count === (booking.players || 1)
  const gaming = bookedSame ? Number(booking.amount) : each * count
  const total = gaming + fnb
  const key = customerKey(name, phone)
  const owes = key.length > 2 ? duesByCustomer(dues).find((d) => d.key === key) : null
  // Owner, 14 Oct: regulars play on dues (pay days later) or from their deposit.
  const { any: anyDep, own: ownDep, dep, friend, picker: depPicker } = useDepositPick(deposits, name, phone)
  const [part, setPart] = useState('') // owner, 15 Oct: type how much goes to dues / comes from the deposit; the rest at the end
  const partOf = (max) => (part === '' ? max : Math.min(max, Number(part) || 0))
  const fromDep = pay === 'deposit' && dep ? partOf(Math.min(dep.balance, total)) : 0
  const dueNow = pay === 'due' ? partOf(total) : 0
  const toggle = (n) => setPicked((p) => (p.includes(n) ? (p.length > 1 ? p.filter((x) => x !== n) : p) : [...p, n].sort()))

  // later = the owner's "details first": the entry holds the PC, its clock starts from the row's ▶ Start timer.
  async function save(later = false) {
    if (pay === 'due' && name.trim().length < 2) { setError('Add the customer’s name to keep it as dues.'); return }
    setBusy(true); setError(null)
    const t0 = new Date().toISOString()
    // A booking's amount and the cash part are shared across the timers so they add up exactly (money.js).
    const games = bookedSame ? shareOut(Number(booking.amount), count) : picked.map(() => each)
    const pays = startPayments(picked.map((_, i) => ({ g: games[i], f: i === 0 ? fnb : 0 })), { pay, cashPart, fromDep, dueNow, booked: pay === 'booked' ? Number(booking.amount) : 0 })
    const rows = picked.map((seat, i) => {
      const g = games[i], f = i === 0 ? fnb : 0
      const { paid_cash, paid_online, paid_deposit: d, owed: o } = pays[i]
      return {
        household_id: householdId, system_id: system.id, system_name: system.name, seat,
        customer_name: i > 0 && (names[seat] || '').trim() ? names[seat].trim() : (name.trim() || 'Walk-in') + (count > 1 ? ` (${i + 1}/${count})` : ''), customer_phone: phone.trim() || null,
        base_minutes: mins, minutes: mins, gaming_amount: g, fnb_before: f, players: 1, happy, booking_id: booking?.id || null,
        paid_cash, paid_online,
        owed: o, paid_deposit: d, note: [o && `Due: ${f ? `game + F&B` : 'game'} ${inr(o)}`, d && friend && `From ${dep.name}’s deposit ${inr(d)}`].filter(Boolean).join(' · ') || null,
        ...(later ? { waiting: true, paused_at: t0 } : {}),
      }
    })
    // One call: the timers, the deposit each one uses and the booking marked arrived (rpc shop_start_sessions).
    const { error } = await supabase.rpc('shop_start_sessions', { p_rows: rows, p_booking: booking?.id || null, p_deposit: dep ? { name: dep.name, phone: dep.phone || null } : null })
    setBusy(false)
    if (error) { setError(error.code === '23505' ? (multi ? `Another controller on ${system.name} can’t start until the database update for controllers is approved. Start one at a time for now.` : `${system.name} is already running.`) : error.message); return }
    const where = `${system.name}${multi ? ` · controller${count > 1 ? 's' : ''} ${picked.join(', ')}` : ''}`
    onDone(later ? `${where} saved for ${name.trim() || 'walk-in'} · press ▶ Start timer when they sit down`
      : `${where} started for ${name.trim() || 'walk-in'} · ends ${timeLabel(new Date(Date.now() + mins * 60_000))}`)
  }

  return (
    <Sheet title={`${system.name} · new customer`} sub={`${durLabel(mins)}${happy ? ' · happy hours' : ''} · save now, start the clock when they sit down`} onClose={onClose} onSubmit={() => save(true)}>
      {error && <div className="alert error">{error}</div>}
      {others.length > 1 && (<>
        <div className="caps muted">{first.kind === 'PS' ? 'Console' : 'PC'} · where they sit</div>
        <Chips scroll options={others.map((x) => [x.id, x.name])} value={system.id} onChange={(id) => { const x = others.find((o) => o.id === id); setSystem(x); setPicked(freeOf(x).slice(0, Math.max(1, picked.length))) }} />
      </>)}
      {multi && (<>
        <div className="caps muted">Controllers · one customer each, charged per head</div>
        <div className="chips">{free.map((n) => <button type="button" key={n} className={`chip chip-btn ${picked.includes(n) ? 'on' : ''}`} onClick={() => toggle(n)}>🎮 {n}</button>)}</div>
      </>)}
      <CustomerFields householdId={householdId} name={name} setName={setName} phone={phone} setPhone={setPhone} />
      {count > 1 && picked.slice(1).map((seat) => (
        <label key={seat}>Controller {seat} · player name<input value={names[seat] || ''} onChange={(e) => setNames({ ...names, [seat]: e.target.value })} placeholder={`Optional · else ${(name.trim() || 'Walk-in')} (${picked.indexOf(seat) + 1}/${count})`} /></label>
      ))}
      {owes && <div className="alert error" style={{ margin: 0 }}>{owes.name} owes {rs(owes.total)} from before · collect it in Cash → Customer dues</div>}
      <div className="caps muted">Time</div>
      <Chips scroll options={DURATIONS.map((m) => [m, durLabel(m)])} value={mins} onChange={setMins} />
      <div className="caps muted">F&amp;B before gaming</div>
      <Chips scroll options={FNB} value={fnbOther ? null : fnb} onChange={(v) => { setFnb(v); setFnbOther('') }} />
      <input className="gx-other" inputMode="numeric" value={fnbOther} placeholder="Other amount ₹"
        onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 5); setFnbOther(v); setFnb(Number(v) || 0) }} />
      <div className="caps muted">Payment</div>
      {booking && !online && Number(booking.paid) > 0 && <div className="small muted">{rs(booking.paid)} advance was taken when booking — it's offered at the end as {booking.customer_name}’s deposit.</div>}
      <Chips options={[...(online ? [['booked', `Paid online · ${rs(booking.amount)}`]] : []), ['end', 'At the end'], ['cash', 'Paid now · cash'], ['online', 'Paid now · online'], ['split', 'Cash + online'], ['due', 'Due · pays later'], ...(anyDep ? [['deposit', depLabel(ownDep)]] : [])]} value={pay} onChange={(v) => { setPay(v); setPart('') }} />
      {pay === 'deposit' && depPicker}
      {(pay === 'due' || (pay === 'deposit' && dep)) && <label>{pay === 'due' ? 'Amount into dues' : 'Amount from deposit'} (₹)<input inputMode="numeric" value={part} onChange={(e) => setPart(e.target.value.replace(/\D/g, ''))} placeholder={`${rs(pay === 'due' ? total : Math.min(dep.balance, total))} · all`} /></label>}
      {pay === 'due' && <div className="small muted">{rs(dueNow)} goes into Cash → Customer dues under {name.trim() || 'their name'}{total > dueNow ? ` · ${rs(total - dueNow)} to collect at the end` : ''}.</div>}
      {pay === 'deposit' && dep && <div className="small muted">{rs(fromDep)} from {dep.name}’s deposit{total > fromDep ? ` · ${rs(total - fromDep)} to collect at the end` : ''} · {rs(dep.balance - fromDep)} left after.</div>}
      {pay === 'split' && <label>Cash part<input inputMode="numeric" value={cashPart} onChange={(e) => setCashPart(e.target.value.replace(/\D/g, ''))} placeholder={`of ${rs(total)} — rest is online`} /></label>}
      {(pay === 'online' || pay === 'split') && <UpiQrButton settings={settings} amount={pay === 'split' ? Math.max(0, total - (Number(cashPart) || 0)) : total} note={`${system.name} · ${name.trim() || 'Walk-in'}`} />}
      <div className="gx-box">
        <SumRow label={`Gaming · ${durLabel(mins)}${count > 1 ? ` × ${count}` : ''}${happy ? ' · happy hours' : ''}`} value={rs(gaming)} />
        {fnb > 0 && <SumRow label="F&B" value={rs(fnb)} />}
        <SumRow strong label={pay === 'end' ? 'Total so far' : pay === 'booked' ? 'Paid when booking' : pay === 'due' ? 'Into their dues' : pay === 'deposit' ? 'From deposit' : 'Paid now'} value={rs(pay === 'booked' ? Number(booking.amount) : pay === 'deposit' ? fromDep : pay === 'due' ? dueNow : total)} />
        {pay === 'split' && <SumRow label={`Cash ${rs(Math.min(Number(cashPart) || 0, total))} · online`} value={rs(Math.max(0, total - (Number(cashPart) || 0)))} />}
      </div>
      {/* Owner: several customers at once — save each entry first, start the clock when they sit down. */}
      <div className="actions gx-start-actions">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save · start later'}</button>
      </div>
    </Sheet>
  )
}
