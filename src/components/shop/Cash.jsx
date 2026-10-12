import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { customerKey, dayLabel, dayStart, dayTotals, depositBalances, duesByCustomer, durLabel, timeLabel, rs } from '../../lib/shop'
import { Chips, Sheet, SheetActions, SumRow } from './ui'
import { UpiQrButton } from './UpiQr'
import CustomerFields from './CustomerFields'
import { useDialog } from '../../lib/dialog'

// The counter drawer for today: opening cash + cash collected (sessions, event advances, cash in)
// − cash paid out = what should be in the drawer. Online money is shown but isn't in the drawer.
export function DrawerCard({ shop, from, order }) {
  const t = dayTotals(shop, from)
  const diff = t.count ? Number(t.count.amount) - t.drawer : null
  return (
    <div className="card" style={{ order }}>
      <div className="card-head"><h3>Drawer</h3>{t.open ? null : <span className="pill">Opening cash not set</span>}</div>
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

// Cashbook out-categories (for the Cash out sheet) and the Plan items a cash out can be claimed against
// (Money → Plan, e.g. "Wafers ₹12,000 monthly"; claimed / expected only for the admin).
function useRpc(name, householdId, version) {
  const [rows, setRows] = useState(null)
  const load = useCallback(() => supabase.rpc(name, { p_household: householdId }).then(({ data }) => setRows(data || [])), [name, householdId])
  useEffect(() => { load() }, [load, version])
  return [rows, load]
}

export default function Cash({ shop, householdId, toast, admin }) {
  const [spend] = useRpc('shop_spend', householdId, shop.cash.length)
  const [plan] = useRpc('shop_plan_items', householdId, shop.cash.length)
  const [sheet, setSheet] = useState(null) // 'open' | 'in' | 'out' | 'count'
  const dialog = useDialog()
  // Owner: "admin can do any actions" — delete any of today's lines, write off dues, clear a deposit.
  async function remove(e) {
    const what = { shop_sessions: 'This removes the whole session (its bill and payments).', shop_cash: 'The drawer and the Cashbook update.', shop_deposits: 'Their deposit balance goes down by this amount.', shop_dues_paid: 'The amount goes back to their dues.' }[e.table]
    if (!await dialog.confirm({ title: `Delete “${e.title}”?`, message: `${rs(e.amount)} · ${what}`, confirmLabel: 'Delete', danger: true })) return
    const { error } = await supabase.from(e.table).delete().eq('id', e.id)
    if (error) toast(error.message); else { toast('Deleted'); shop.reload() }
  }
  async function writeOff(r) {
    if (!await dialog.confirm({ title: `Clear ${r.name}’s dues?`, message: `${rs(r.total)} won't be collected. The sessions stay in the records with nothing owed.`, confirmLabel: 'Clear dues', danger: true })) return
    const results = await Promise.all(r.sessions.map((x) => supabase.from('shop_sessions').update({ owed: 0, note: `Dues ${rs(x.owed)} written off` }).eq('id', x.id)))
    const err = results.find((x) => x.error)?.error
    if (err) toast(err.message); else { toast(`${r.name}’s dues cleared`); shop.reload() }
  }
  async function clearDeposit(r) {
    if (!await dialog.confirm({ title: `Clear ${r.name}’s deposit?`, message: `All of this month's deposit entries for them are deleted (${rs(r.balance)} left now).`, confirmLabel: 'Clear deposit', danger: true })) return
    const ids = (shop.deposits || []).filter((d) => customerKey(d.customer_name, d.customer_phone) === r.key).map((d) => d.id)
    const { error } = await supabase.from('shop_deposits').delete().in('id', ids)
    if (error) toast(error.message); else { toast('Deposit cleared'); shop.reload() }
  }
  const entries = [
    ...shop.sessions.filter((s) => s.status === 'closed' || sessionHasPay(s)).map((s) => ({
      id: s.id, table: 'shop_sessions', at: s.ended_at || s.started_at, title: `${s.system_name} · ${s.customer_name} · ${durLabel(s.minutes)}`,
      sub: payLabel(s), amount: Number(s.paid_cash) + Number(s.paid_online), sign: 1, by: s.handled_by || s.entered_by,
    })),
    ...shop.advances.map((b) => ({ id: b.id, at: b.created_at, title: `Event advance · ${b.customer_name}`, sub: b.advance_mode === 'online' ? 'Online' : 'Cash', amount: Number(b.advance_paid), sign: 1, by: b.entered_by })),
    ...shop.cash.map((c) => ({ id: c.id, table: 'shop_cash', at: c.at, title: [c.category, c.note].filter(Boolean).join(' · ') || KINDS[c.kind], sub: KINDS[c.kind], amount: Number(c.amount), sign: c.kind === 'out' ? -1 : c.kind === 'in' ? 1 : 0, by: c.entered_by })),
    ...(shop.deposits || []).filter((d) => d.kind === 'add' && new Date(d.created_at) >= dayStart()).map((d) => ({ id: d.id, table: 'shop_deposits', at: d.created_at, title: `Deposit · ${d.customer_name}`, sub: d.mode === 'online' ? 'Online' : 'Cash', amount: Number(d.amount), sign: 1, by: d.entered_by })),
    ...(shop.duesPaid || []).map((p) => ({ id: p.id, table: 'shop_dues_paid', at: p.created_at, title: `Dues paid · ${p.customer_name}`, sub: p.mode === 'online' ? 'Online' : 'Cash', amount: Number(p.amount), sign: 1, by: p.entered_by })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at))

  return (
    <section className="gx-split">
      <div className="gx-col">
      <DrawerCard shop={shop} />
      <div className="gx-btns">
        <button className="btn primary" style={{ flex: 1 }} onClick={() => setSheet('out')}>− Cash out</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => setSheet('in')}>+ Cash in</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => setSheet(dayTotals(shop).open ? 'count' : 'open')}>{dayTotals(shop).open ? 'Count' : 'Opening'}</button>
      </div>
      {admin && <PlanClaims rows={plan} />}
      <CustomerDues shop={shop} onCollect={(row) => setSheet({ dues: row })} onClear={admin ? writeOff : null} />
      <Deposits shop={shop} onAdd={() => setSheet('deposit')} onClear={admin ? clearDeposit : null} />
      </div>
      <div className="gx-col">
      <div className="card">
        <h3>Today</h3>
        {entries.length === 0 ? <div className="muted small">Nothing yet today.</div> : entries.map((e) => (
          <div key={e.id} className="line">
            <div className="grow"><div className="gx-ellipsis">{e.title}</div><div className="muted small">{timeLabel(e.at)} · {e.sub}{e.by ? ` · by ${e.by}` : ''}</div></div>
            <b className={e.sign > 0 ? 'pos' : e.sign < 0 ? 'neg' : 'muted'}>{e.sign > 0 ? '+' : e.sign < 0 ? '−' : ''}{rs(e.amount)}</b>
            {admin && e.table && <button className="btn icon gx-del" aria-label={`Delete ${e.title}`} title="Delete" onClick={() => remove(e)}>✕</button>}
          </div>
        ))}
      </div>
      </div>
      {sheet === 'deposit' && <DepositSheet settings={shop.settings} householdId={householdId} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); shop.reload() }} />}
      {sheet?.dues && <DuesSheet row={sheet.dues} settings={shop.settings} householdId={householdId} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); shop.reload() }} />}
      {typeof sheet === 'string' && sheet !== 'deposit' && <CashSheet kind={sheet} categories={spend} plan={plan} householdId={householdId} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); shop.reload() }} />}
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


// Cash out = a Cashbook entry too (Shop book, its category, paid from the drawer, "paid by" whoever saved it),
// and it can be claimed against a Plan item (owner: "while marking an expense I should claim it against the plan").
function CashSheet({ kind, categories, plan, householdId, onClose, onDone }) {
  const [category, setCategory] = useState(kind === 'out' ? 'Snacks stock' : null)
  const [claim, setClaim] = useState(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_cash').insert({ household_id: householdId, kind, amount: Number(amount), note: note.trim() || null, category: kind === 'out' ? category : null, recurring_item_id: kind === 'out' ? claim : null })
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${KINDS[kind]} ${rs(amount)} saved`)
  }
  return (
    <Sheet title={KINDS[kind]} sub={{ open: 'Cash in the drawer when the shop opens.', in: 'Cash put into the drawer that isn’t a session.', out: 'Money taken from the drawer.', count: 'Count the notes and enter the total.' }[kind]} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      {kind === 'out' && (<>
        <div className="caps muted">What for · goes into the Cashbook</div>
        <Chips options={(categories || []).map((c) => [c.name, `${c.icon || ''} ${c.name}`.trim()])} value={category} onChange={setCategory} />
        <div className="caps muted">Claim against Plan</div>
        {(plan || []).length === 0 ? <div className="muted small">No Plan items yet — the owner adds them in Money → Plan (e.g. Wafers, any amount a month).</div>
          : <Chips options={[[null, 'Not in Plan'], ...plan.map((p) => [p.id, p.expected != null ? `${p.name} · ${rs(Math.max(0, Number(p.expected) - Number(p.claimed)))} left` : p.name])]} value={claim} onChange={setClaim} />}
      </>)}
      <label>Amount<input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="₹" /></label>
      {kind !== 'count' && kind !== 'open' && <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'out' ? 'e.g. wafers supplier, bill no.' : 'What for'} /></label>}
      <SheetActions onClose={onClose} busy={busy} disabled={!amount} label="Save" />
    </Sheet>
  )
}

// Customer deposits (owner's rule): paid ahead, used on later visits within the same month, then they lapse.
// Not refundable. Used from the End sheet on the Floor.
function Deposits({ shop, onAdd, onClear }) {
  const rows = depositBalances(shop.deposits || [])
  const month = new Date().toLocaleDateString('en-IN', { month: 'long' })
  return (
    <div className="card">
      <div className="card-head"><h3>Deposits · {month}</h3><button className="btn small" onClick={onAdd}>+ Deposit</button></div>
      {rows.length === 0 ? <div className="muted small">No deposits left this month. A deposit can be used on any visit until the month ends.</div> : rows.map((r) => (
        <div key={r.key} className="line">
          <div className="grow"><div className="gx-ellipsis">{r.name}</div>{r.phone && <div className="muted small">{r.phone}</div>}</div>
          <b className="pos">{rs(r.balance)}</b>
          {onClear && <button className="btn icon gx-del" aria-label={`Clear ${r.name}'s deposit`} title="Clear" onClick={() => onClear(r)}>✕</button>}
        </div>
      ))}
    </div>
  )
}

function DepositSheet({ settings, householdId, onClose, onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('shop_deposits').insert({ household_id: householdId, customer_name: name.trim(), customer_phone: phone.trim() || null, kind: 'add', amount: Number(amount), mode })
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${rs(amount)} deposit saved for ${name.trim()}`)
  }
  return (
    <Sheet title="Customer deposit" sub="Paid in advance, not refundable. Used on their next visits this month; whatever is left lapses at month end." onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <CustomerFields householdId={householdId} name={name} setName={setName} phone={phone} setPhone={setPhone} autoFocus required phonePlaceholder="To match them later" />
      <label>Amount (₹)<input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <Chips options={[['cash', 'Cash'], ['online', 'Online / scanner']]} value={mode} onChange={setMode} />
      {mode === 'online' && <UpiQrButton settings={settings} amount={Number(amount)} note={`Deposit · ${name.trim() || 'customer'}`} />}
      <SheetActions onClose={onClose} busy={busy} disabled={!name.trim() || !Number(amount)} label="Save deposit" />
    </Sheet>
  )
}

// Customer dues (owner: staff must see them too): sessions ended as "Owes", any day, until paid back.
function CustomerDues({ shop, onCollect, onClear }) {
  const rows = duesByCustomer(shop.dues)
  const total = rows.reduce((a, r) => a + r.total, 0)
  return (
    <div className="card">
      <div className="card-head"><h3>Customer dues</h3>{total > 0 && <b className="neg">{rs(total)}</b>}</div>
      {rows.length === 0 ? <div className="muted small">Nobody owes the shop anything.</div> : rows.map((r) => (
        <div key={r.key} className="line">
          <div className="grow">
            <div className="gx-ellipsis">{r.name}{r.phone ? <span className="muted small"> · {r.phone}</span> : null}</div>
            <div className="muted small">{r.sessions.map((s) => `${dayLabel(s.started_at)} ${s.system_name}${s.handled_by ? ` (${s.handled_by})` : ''}`).join(' · ')}</div>
          </div>
          <b className="neg">{rs(r.total)}</b>
          <button className="btn small" onClick={() => onCollect(r)}>Collect</button>
          {onClear && <button className="btn icon gx-del" aria-label={`Clear ${r.name}'s dues`} title="Clear dues" onClick={() => onClear(r)}>✕</button>}
        </div>
      ))}
    </div>
  )
}

function DuesSheet({ row, settings, householdId, onClose, onDone }) {
  const [amount, setAmount] = useState(String(Math.round(row.total)))
  const [mode, setMode] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    let left = Math.min(Number(amount) || 0, row.total)
    if (!left) return
    setBusy(true)
    // Paid back oldest session first; each payment lowers that session's dues (database trigger).
    const rows = []
    for (const s of row.sessions) {
      if (left <= 0) break
      const part = Math.min(left, Number(s.owed))
      rows.push({ household_id: householdId, session_id: s.id, customer_name: row.name, customer_phone: row.phone || null, amount: part, mode })
      left -= part
    }
    const { error } = await supabase.from('shop_dues_paid').insert(rows)
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${rs(amount)} dues collected from ${row.name}`)
  }
  return (
    <Sheet title={`Collect dues · ${row.name}`} sub={`Owes ${rs(row.total)} from ${row.sessions.length} visit${row.sessions.length === 1 ? '' : 's'}`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <label>Amount (₹)<input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <Chips options={[['cash', 'Cash'], ['online', 'Online / scanner']]} value={mode} onChange={setMode} />
      {mode === 'online' && <UpiQrButton settings={settings} amount={Number(amount)} note={`Dues · ${row.name}`} />}
      <SheetActions onClose={onClose} busy={busy} disabled={!Number(amount)} label={`Collect ${rs(Math.min(Number(amount) || 0, row.total))}`} />
    </Sheet>
  )
}

// Admin: Plan items (Money → Plan) and how much has been claimed against each this month.
function PlanClaims({ rows }) {
  const month = new Date().toLocaleDateString('en-IN', { month: 'long' })
  const list = rows || []
  return (
    <div className="card">
      <div className="card-head"><h3>Plan · {month}</h3><a className="btn small" href="#/money/plan">Edit Plan</a></div>
      {list.length === 0 ? <div className="muted small">No Plan items yet. Add them in Money → Plan with any monthly amount (e.g. Wafers), then claim each cash out against them.</div> : list.map((r) => {
        const limit = Number(r.expected) || 0, spent = Number(r.claimed) || 0
        return (
          <div key={r.id} className="gx-budget">
            <div className="gx-sum"><span>{r.name}</span><span className="amt">{rs(spent)}{limit ? ` of ${rs(limit)}` : ''}</span></div>
            {limit > 0 && (<>
              <div className={`gx-bar ${spent > limit ? 'over' : ''}`}><i style={{ width: `${Math.min(100, (spent / limit) * 100)}%` }} /></div>
              <div className={`small ${spent > limit ? 'neg' : 'muted'}`}>{spent > limit ? `${rs(spent - limit)} over plan` : `${rs(limit - spent)} left this month`}</div>
            </>)}
          </div>
        )
      })}
    </div>
  )
}
