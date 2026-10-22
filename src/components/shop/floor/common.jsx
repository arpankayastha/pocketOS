// Small helpers shared by the Slots screens (Floor.jsx and the sheets in this folder).
import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { balanceFor, cashOnline, depositBalances, minutesLeft, rs, timeLabel } from '../../../lib/shop'
import { UpiQrButton } from '../UpiQr'
export { dueOf } from '../../../lib/money'

export const stateOf = (s, now) => { const left = minutesLeft(s, now); return s.waiting ? 'waiting' : s.paused_at ? 'paused' : left <= 0 ? 'over' : left <= 5 ? 'ending' : 'busy' }

// "32m" / "1h 05m" — the big number on a customer's row.
export const leftLabel = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m` }

export const whereOf = (sys, seat) => (seatsOf1(sys) > 1 ? `${sys.name} · controller ${seat}` : sys.name)

export const seatsOf1 = (sys) => sys.seats || 1

export const FNB = [[0, 'None'], [10, '₹10'], [20, '₹20'], [30, '₹30'], [40, '₹40'], [60, '₹60']]

// Owner, 17 Oct: friends share a deposit (one paid ₹150, both play from it) — pick whose deposit to use.
// Defaults to the customer's own; the use row is booked under the deposit's owner.
export function useDepositPick(deposits, name, phone) {
  const all = depositBalances(deposits)
  const own = (name || '').trim().length > 1 ? balanceFor(deposits, name.trim(), (phone || '').trim()) : null
  const [key, setKey] = useState(null)
  const dep = all.find((r) => r.key === (key ?? own?.key)) || null
  const picker = all.length > 0 && (
    <label>Whose deposit<select value={dep?.key || ''} onChange={(e) => setKey(e.target.value)}>
      {!dep && <option value="">Pick a customer</option>}
      {all.map((r) => <option key={r.key} value={r.key}>{r.name}{r.key === own?.key ? ' (this customer)' : ''} · {rs(r.balance)} left</option>)}
    </select></label>
  )
  return { any: all.length > 0, own, dep, friend: dep && dep.key !== own?.key, picker }
}

export const depLabel = (own) => own ? `From deposit · ${rs(own.balance)}` : 'From a deposit'

// Pay for an add-on now or at the end (owner, 13 Oct: "customer paid online but it showed ₹50 to collect").
// Owner, 14 Oct: 'Due' puts it straight into the customer's dues (Cash → Customer dues), by their name.
export const PAY_NOW = [['end', 'With the bill at the end'], ['cash', 'Paid now · cash'], ['online', 'Paid now · online'], ['split', 'Paid now · cash + online'], ['due', 'Due · customer owes']]

// Amounts an add-on adds to the session (F&B / Extend): paid now cash / online, into their dues, or nothing
// (with the bill at the end). The deposit case is handled by the caller (paid_deposit + the deposit used).
export const payAdd = (pay, value, cashPart) => {
  if (pay === 'split') { const { cash, online } = cashOnline(value, cashPart); return { paid_cash: cash, paid_online: online } }
  return pay === 'due' ? { owed: value } : pay === 'cash' ? { paid_cash: value } : pay === 'online' ? { paid_online: value } : {}
}

// Owner, 22 Oct: "Cash + online" on F&B and Extend — type the cash part, the QR asks for the rest.
export function SplitPay({ value, cashPart, setCashPart, settings, note }) {
  const { cash, online } = cashOnline(value, cashPart)
  return (
    <>
      <label>Cash part<input inputMode="numeric" value={cashPart} onChange={(e) => setCashPart(e.target.value.replace(/\D/g, ''))} placeholder={`of ${rs(value)} — rest is online`} /></label>
      {cashPart !== '' && <p className="muted small" style={{ margin: 0 }}>{rs(cash)} cash + {rs(online)} online</p>}
      {online > 0 && <UpiQrButton settings={settings} amount={online} note={note} />}
    </>
  )
}

// Owner, 17 Oct: a customer with a deposit can have F&B / extend taken from it (up to the balance; any rest is with the bill at the end).
export const payOptions = (d) => d.any ? [...PAY_NOW, ['deposit', depLabel(d.own)]] : PAY_NOW

// One call saves the session change and the deposit used together (rpc shop_session_save, supabase/shop.sql):
// add = amounts added to what's saved now, set = status / times, note = appended, deposit = {name, phone, amount}.
export function saveSession(id, { add = {}, set = {}, note = null, deposit = null } = {}) {
  return supabase.rpc('shop_session_save', { p_session: id, p_add: add, p_set: set, p_note: note, p_deposit: deposit })
}
export const depositOf = (dep, amount) => (dep && amount > 0 ? { name: dep.name, phone: dep.phone || null, amount } : null)

export const payNote = (pay) => pay === 'deposit' ? ' · from their deposit' : pay === 'due' ? ' · added to their dues' : pay === 'cash' ? ' · paid cash' : pay === 'online' ? ' · paid online' : pay === 'split' ? ' · paid cash + online' : ' · to collect at the end'

// The first booked time and each change (owner, 16 Oct: keep the original time in the record after a change).
export const whenLabel = (t) => `${new Date(t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} ${timeLabel(t)}`

export const timeHistory = (b) => (b.first_starts_at ? [['First booked for', whenLabel(b.first_starts_at)],
  ...(b.time_changes || []).map((c, i) => [`Change ${i + 1}`, `${timeLabel(c.from)} → ${whenLabel(c.to)}${c.by ? ` · by ${c.by}` : ''}`])] : [])

export const ymdLocal = (d) => d.toLocaleDateString('en-CA')
