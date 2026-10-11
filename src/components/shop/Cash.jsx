import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { dayTotals, durLabel, timeLabel, rs } from '../../lib/shop'
import { Chips, Sheet, SheetActions, SumRow } from './ui'

// The counter drawer for today: opening cash + cash collected (sessions, event advances, cash in)
// − cash paid out = what should be in the drawer. Online money is shown but isn't in the drawer.
export function DrawerCard({ shop }) {
  const t = dayTotals(shop)
  const diff = t.count ? Number(t.count.amount) - t.drawer : null
  return (
    <div className="card">
      <div className="card-head"><h3>Drawer today</h3>{t.open ? null : <span className="pill">Opening cash not set</span>}</div>
      <SumRow label="Opening cash" value={rs(t.open?.amount || 0)} />
      <SumRow label="Cash collected" value={`+${rs(t.cash + t.in)}`} tone="pos" />
      <SumRow label="Paid out" value={`−${rs(t.out)}`} tone="neg" />
      <SumRow strong label="Should be in drawer" value={rs(t.drawer)} />
      <SumRow label="Online (not in drawer)" value={rs(t.online)} />
      {t.count && (
        <div className={`alert ${Math.abs(diff) < 1 ? 'ok' : 'error'}`} style={{ margin: '8px 0 0' }}>
          Counted {rs(t.count.amount)} at {timeLabel(t.count.at)} · {Math.abs(diff) < 1 ? 'matches' : `${rs(Math.abs(diff))} ${diff < 0 ? 'short' : 'extra'} now`}
        </div>
      )}
    </div>
  )
}

const KINDS = { open: 'Opening cash', in: 'Cash in', out: 'Cash out', count: 'Drawer count' }

export default function Cash({ shop, householdId, toast }) {
  const [sheet, setSheet] = useState(null) // 'open' | 'in' | 'out' | 'count'
  const entries = [
    ...shop.sessions.filter((s) => s.status === 'closed' || sessionHasPay(s)).map((s) => ({
      id: s.id, at: s.ended_at || s.started_at, title: `${s.system_name} · ${s.customer_name} · ${durLabel(s.minutes)}`,
      sub: payLabel(s), amount: Number(s.paid_cash) + Number(s.paid_online), sign: 1,
    })),
    ...shop.advances.map((b) => ({ id: b.id, at: b.created_at, title: `Event advance · ${b.customer_name}`, sub: b.advance_mode === 'online' ? 'Online' : 'Cash', amount: Number(b.advance_paid), sign: 1 })),
    ...shop.cash.map((c) => ({ id: c.id, at: c.at, title: c.note || KINDS[c.kind], sub: KINDS[c.kind], amount: Number(c.amount), sign: c.kind === 'out' ? -1 : c.kind === 'in' ? 1 : 0 })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at))

  return (
    <section>
      <DrawerCard shop={shop} />
      <div className="gx-btns" style={{ marginBottom: 16 }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => setSheet('out')}>− Cash out</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => setSheet('in')}>+ Cash in</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => setSheet(dayTotals(shop).open ? 'count' : 'open')}>{dayTotals(shop).open ? 'Count' : 'Opening'}</button>
      </div>
      <div className="card">
        <h3>Today</h3>
        {entries.length === 0 ? <div className="muted small">Nothing yet today.</div> : entries.map((e) => (
          <div key={e.id} className="line">
            <div className="grow"><div className="gx-ellipsis">{e.title}</div><div className="muted small">{timeLabel(e.at)} · {e.sub}</div></div>
            <b className={e.sign > 0 ? 'pos' : e.sign < 0 ? 'neg' : 'muted'}>{e.sign > 0 ? '+' : e.sign < 0 ? '−' : ''}{rs(e.amount)}</b>
          </div>
        ))}
      </div>
      {sheet && <CashSheet kind={sheet} householdId={householdId} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); shop.reload() }} />}
    </section>
  )
}

const sessionHasPay = (s) => Number(s.paid_cash) + Number(s.paid_online) > 0
function payLabel(s) {
  if (s.status === 'running') return 'Paid at start'
  if (Number(s.owed) > 0) return `Owes ${rs(s.owed)}`
  if (Number(s.paid_cash) && Number(s.paid_online)) return 'Cash + Online'
  return Number(s.paid_online) ? 'Online' : 'Cash'
}

const OUT_NOTES = [['Snacks restock', 'Snacks'], ['Cold drinks', 'Drinks'], ['Tea and water', 'Tea / water'], ['Repairs', 'Repairs'], ['Other', 'Other']]

function CashSheet({ kind, householdId, onClose, onDone }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState(kind === 'out' ? 'Snacks restock' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_cash').insert({ household_id: householdId, kind, amount: Number(amount), note: note.trim() || null })
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${KINDS[kind]} ${rs(amount)} saved`)
  }
  return (
    <Sheet title={KINDS[kind]} sub={{ open: 'Cash in the drawer when the shop opens.', in: 'Cash put into the drawer that isn’t a session.', out: 'Money taken from the drawer.', count: 'Count the notes and enter the total.' }[kind]} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      {kind === 'out' && <Chips scroll options={OUT_NOTES} value={note} onChange={setNote} />}
      <label>Amount<input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="₹" /></label>
      {kind !== 'count' && kind !== 'open' && <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What for" /></label>}
      <SheetActions onClose={onClose} busy={busy} disabled={!amount} label="Save" />
    </Sheet>
  )
}
