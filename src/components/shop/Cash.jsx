import { dueReason } from '../../lib/money'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { sessionTotal, customerKey, dayLabel, dayStart, dayTotals, depositBalances, duesByCustomer, durLabel, inr, timeLabel, rs } from '../../lib/shop'
import { ActionGrid, ActionSheet, Chips, SessionBreakdown, Sheet, SheetActions, SumRow, inOut } from './ui'
import { CashIcon, XIcon } from '../../lib/icons'
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
  const [open, setOpen] = useState(null) // a Today line, dues row or deposit row shown in its sheet
  const dialog = useDialog()
  // Owner: "admin can do any actions" — delete any of today's lines (staff too since 13 Oct; the database only
  // lets staff remove today's), write off dues, clear a deposit.
  async function remove(e) {
    const what = { shop_sessions: 'This removes the whole session (its bill and payments).', shop_cash: 'The drawer and the Cashbook update.', shop_deposits: 'Their deposit balance goes down by this amount.', shop_dues_paid: 'The amount goes back to their dues.' }[e.table]
    if (!await dialog.confirm({ title: `Delete “${e.title}”?`, message: `${rs(e.amount)} · ${what}`, confirmLabel: 'Delete', danger: true })) return
    const { error } = await supabase.from(e.table).delete().eq('id', e.id)
    if (error) toast(error.message); else { setOpen(null); toast('Deleted'); shop.reload() }
  }
  async function writeOff(r) {
    if (!await dialog.confirm({ title: `Clear ${r.name}’s dues?`, message: `${rs(r.total)} won't be collected. The sessions stay in the records with nothing owed.`, confirmLabel: 'Clear dues', danger: true })) return
    const results = await Promise.all(r.sessions.map((x) => supabase.from('shop_sessions').update({ owed: 0, note: `Dues ${inr(x.owed)} written off` }).eq('id', x.id)))
    const err = results.find((x) => x.error)?.error
    if (err) toast(err.message); else { setOpen(null); toast(`${r.name}’s dues cleared`); shop.reload() }
  }

  const bankSeen = new Set((shop.paymentsIn || []).filter((x) => x.match_kind === 'session').map((x) => x.match_id))
  const entries = [
    ...shop.sessions.filter((s) => s.status === 'closed' || s.status === 'running').map((s) => ({ // owner, 14 Oct: every entry, paid or not
      id: s.id, table: 'shop_sessions', at: s.ended_at || s.started_at, title: `${s.system_name} · ${s.customer_name} · ${durLabel(s.minutes)}`,
      sub: payLabel(s) + (bankSeen.has(s.id) ? ' · ✓ bank' : ''), time: inOut(s), session: s, amount: Number(s.paid_cash) + Number(s.paid_online), sign: 1, by: s.handled_by || s.entered_by,
    })),
    ...shop.advances.map((b) => ({ id: b.id, at: b.created_at, title: `Event advance · ${b.customer_name}`, sub: b.advance_mode === 'online' ? 'Online' : 'Cash', amount: Number(b.advance_paid), sign: 1, by: b.entered_by })),
    ...shop.cash.map((c) => ({ id: c.id, table: 'shop_cash', at: c.at, title: [c.category, c.note].filter(Boolean).join(' · ') || KINDS[c.kind], sub: KINDS[c.kind], amount: Number(c.amount), sign: c.kind === 'out' ? -1 : c.kind === 'in' ? 1 : 0, by: c.entered_by })),
    ...(shop.deposits || []).filter((d) => (d.kind === 'add' || d.kind === 'refund') && new Date(d.created_at) >= dayStart()).map((d) => ({ id: d.id, table: 'shop_deposits', at: d.created_at, title: `${d.kind === 'refund' ? 'Deposit returned' : 'Deposit'} · ${d.customer_name}`, sub: [d.mode === 'online' ? 'Online' : 'Cash', d.note].filter(Boolean).join(' · '), amount: Number(d.amount), sign: d.kind === 'refund' ? -1 : 1, by: d.entered_by })),
    ...(shop.duesPaid || []).map((p) => ({ id: p.id, table: 'shop_dues_paid', at: p.created_at, title: `Dues paid · ${p.customer_name}`, sub: p.mode === 'online' ? 'Online' : 'Cash', amount: Number(p.amount), sign: 1, by: p.entered_by })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at))

  return (
    <section className="gx-split">
      <div className="gx-col">
      <DrawerCard shop={shop} order={1} />
      <div className="gx-btns" style={{ order: 2 }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => setSheet('out')}>− Cash out</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => setSheet('in')}>+ Cash in</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => setSheet(dayTotals(shop).open ? 'count' : 'open')}>{dayTotals(shop).open ? 'Count' : 'Opening'}</button>
      </div>
      {admin && <PlanClaims rows={plan} order={6} />}
      <CustomerDues shop={shop} onCollect={(row) => setSheet({ dues: row })} onOpen={(r) => setOpen({ dues: r })} order={4} />
      <Deposits shop={shop} onAdd={() => setSheet('deposit')} onOpen={(r) => setOpen({ deposit: r })} order={5} />
      <UpiReceived shop={shop} toast={toast} order={4} />
      </div>
      <div className="gx-col">
      <div className="card" style={{ order: 3 }}>
        <h3>Today</h3>
        {entries.length === 0 ? <div className="muted small">Nothing yet today.</div> : entries.map((e) => (
          <div key={e.id} className="line gx-tap" role="button" tabIndex={0} onClick={() => setOpen({ entry: e })} onKeyDown={(ev) => { if (ev.key === 'Enter') setOpen({ entry: e }) }}>
            <div className="grow"><div className="gx-ellipsis">{e.title}</div>
              <div className="muted small gx-ellipsis">{e.time || timeLabel(e.at)} · {e.sub}{e.by ? ` · ${e.by}` : ''}</div></div>
            <b className={e.sign > 0 ? 'pos' : e.sign < 0 ? 'neg' : 'muted'}>{e.sign > 0 ? '+' : e.sign < 0 ? '−' : ''}{rs(e.amount)}</b>
          </div>
        ))}
      </div>
      </div>
      {open?.entry && (
        <ActionSheet title={open.entry.title} sub={`${open.entry.time || timeLabel(open.entry.at)} · ${open.entry.sub}${open.entry.by ? ` · by ${open.entry.by}` : ''}`} onClose={() => setOpen(null)}>
          {open.entry.session ? <SessionBreakdown s={open.entry.session} /> : <SumRow strong label="Amount" value={`${open.entry.sign < 0 ? '−' : ''}${rs(open.entry.amount)}`} />}
          {open.entry.table && <ActionGrid items={[{ label: 'Delete', icon: <XIcon />, onClick: () => remove(open.entry), danger: true }]} />}
        </ActionSheet>
      )}
      {open?.dues && (
        <ActionSheet title={open.dues.name} sub={`${open.dues.phone ? `${open.dues.phone} · ` : ''}owes ${rs(open.dues.total)}`} onClose={() => setOpen(null)}
          primary={<button type="button" className="btn primary" onClick={() => { setSheet({ dues: open.dues }); setOpen(null) }}>Collect</button>}>
          <div className="gx-details">{open.dues.sessions.map((x) => <div key={x.id}><span>{dayLabel(x.started_at)} · {x.system_name}{x.handled_by ? ` · ${x.handled_by}` : ''}<br /><small className="muted">{dueReason(x)}</small></span><b className="neg">{rs(x.owed)}</b></div>)}</div>
          {admin && <ActionGrid items={[{ label: 'Write off', icon: <XIcon />, onClick: () => writeOff(open.dues), danger: true }]} />}
        </ActionSheet>
      )}
      {open?.deposit && (
        <ActionSheet title={open.deposit.name} sub={`${open.deposit.phone ? `${open.deposit.phone} · ` : ''}${rs(open.deposit.balance)} left`} onClose={() => setOpen(null)}>
          <div className="gx-details">{depositEntries(shop.deposits, open.deposit.key).map((d) => (
            <div key={d.id}><span>{d.kind === 'use' && (d.note || '').startsWith('Deleted') ? 'Deleted' : DEP_KIND[d.kind] || d.kind} · {whenAt(d.created_at)}{d.kind !== 'use' && d.mode ? ` · ${d.mode}` : ''}{d.entered_by ? ` · by ${d.entered_by}` : ''}{d.note && !d.note.startsWith('Deleted') ? ` · ${d.note}` : ''}</span>
              <b className={d.kind === 'add' ? 'pos' : ''}>{d.kind === 'add' ? '+' : '−'}{rs(d.amount)}</b></div>
          ))}</div>
          <ActionGrid items={[
            { label: `Return ${rs(open.deposit.balance)}`, icon: <CashIcon />, onClick: () => { setSheet({ refund: open.deposit }); setOpen(null) } },
            { label: 'Delete', icon: <XIcon />, onClick: () => { setSheet({ deduct: open.deposit }); setOpen(null) }, danger: true },
          ]} />
        </ActionSheet>
      )}
      {sheet?.deduct && <DeleteDepositSheet row={sheet.deduct} householdId={householdId} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); shop.reload() }} />}
      {sheet?.refund && <RefundSheet row={sheet.refund} householdId={householdId} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); shop.reload() }} />}
      {sheet === 'deposit' && <DepositSheet settings={shop.settings} householdId={householdId} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); shop.reload() }} />}
      {sheet?.dues && <DuesSheet row={sheet.dues} settings={shop.settings} householdId={householdId} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); shop.reload() }} />}
      {typeof sheet === 'string' && sheet !== 'deposit' && <CashSheet kind={sheet} categories={spend} plan={plan} householdId={householdId} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); toast(msg); shop.reload() }} />}
    </section>
  )
}

const sessionHasPay = (s) => Number(s.paid_cash) + Number(s.paid_online) > 0
function payLabel(s) {
  if (s.status === 'running') {
    const due = Math.max(0, sessionTotal(s) - Number(s.paid_cash) - Number(s.paid_online) - Number(s.paid_deposit || 0) - Number(s.owed || 0))
    return `${s.waiting ? 'Waiting' : 'Playing'}${sessionHasPay(s) ? ' · part paid' : ''}${Number(s.owed) ? ` · ${rs(s.owed)} in dues` : ''}${due ? ` · ${rs(due)} to collect` : Number(s.owed) ? '' : ' · paid'}`
  }
  if (Number(s.owed) > 0) return `Owes ${rs(s.owed)}`
  if (Number(s.paid_cash) && Number(s.paid_online)) return 'Cash + Online'
  return Number(s.paid_online) ? 'Online' : 'Cash'
}


// UPI received (owner, 19 Oct): every "money received" SMS the shop phone read (bank-sms). Auto-matched ones show
// what they paid for; the rest — and anything to fix — are linked here by tap: a counter session paid online, an
// online booking / event advance / tournament fee to confirm, or "Not a shop payment".
function UpiReceived({ shop, toast, order }) {
  const dialog = useDialog()
  const [open, setOpen] = useState(null)
  const rows = shop.paymentsIn || []
  if (!rows.length) return null
  const today = rows.filter((x) => new Date(x.received_at) >= dayStart())
  const total = today.filter((x) => x.status !== 'ignored').reduce((a, x) => a + Number(x.amount), 0)
  const linked = new Set(rows.filter((x) => x.match_kind === 'session').map((x) => x.match_id))
  const candidates = !open ? [] : [
    ...(shop.bookings || []).filter((b) => b.status === 'requested' && b.source === 'online').map((b) => ({ kind: 'booking', id: b.id, label: `${b.customer_name} · online booking ${timeLabel(b.starts_at)}`, amount: Number(b.amount), group: b.group_id })),
    ...(shop.eventChecks || []).map((b) => ({ kind: 'event', id: b.id, label: `${b.customer_name} · event advance`, amount: Number(b.advance_paid) })),
    ...(shop.entryChecks || []).filter((x) => Number(x.fee)).map((x) => ({ kind: 'entry', id: x.id, label: `${x.name} · tournament entry`, amount: Number(x.fee) })),
    ...shop.sessions.filter((x) => Number(x.paid_online) > 0 && !linked.has(x.id)).map((x) => ({ kind: 'session', id: x.id, label: `${x.system_name} · ${x.customer_name}`, amount: Number(x.paid_online) })),
  ].sort((a, b) => Math.abs(a.amount - Number(open.amount)) - Math.abs(b.amount - Number(open.amount)))
  async function link(c) {
    const { error } = await supabase.from('shop_payments_in').update({ status: 'matched', match_kind: c.kind, match_id: c.id, match_label: c.label, matched_by: 'staff' }).eq('id', open.id)
    if (error) { toast(error.message); return }
    // Linking a request also confirms it, like tapping Received.
    if (c.kind === 'booking') await supabase.from('shop_bookings').update({ status: 'confirmed' }).eq('status', 'requested').or(c.group ? `id.eq.${c.id},group_id.eq.${c.group}` : `id.eq.${c.id}`)
    if (c.kind === 'event') await supabase.from('shop_event_bookings').update({ payment_ok: true }).eq('id', c.id)
    if (c.kind === 'entry') await supabase.from('shop_entries').update({ status: 'confirmed' }).eq('id', c.id)
    toast(`${rs(open.amount)} linked to ${c.label}`); setOpen(null); shop.reload()
  }
  async function setStatus(status) {
    if (status === 'ignored' && !await dialog.confirm({ title: 'Not a shop payment?', message: `${rs(open.amount)}${open.payer ? ` from ${open.payer}` : ''} is left out of the shop's checks.`, confirmLabel: 'Not a shop payment' })) return
    const { error } = await supabase.from('shop_payments_in').update({ status, match_kind: null, match_id: null, match_label: null, matched_by: null }).eq('id', open.id)
    if (error) toast(error.message); else { setOpen(null); shop.reload() }
  }
  return (
    <div className="card" style={{ order }}>
      <div className="card-head"><h3>UPI received</h3><b className="pos">{rs(total)}</b></div>
      {rows.map((x) => (
        <div key={x.id} className="line gx-tap" role="button" tabIndex={0} onClick={() => setOpen(x)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(x) }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="gx-ellipsis">{x.payer || 'UPI'} <span className="muted small">· {new Date(x.received_at) >= dayStart() ? timeLabel(x.received_at) : dayLabel(x.received_at)}</span></div>
            <div className={`small gx-ellipsis ${x.status === 'new' ? 'neg' : 'muted'}`}>{x.status === 'matched' ? `✓ ${x.match_label}` : x.status === 'ignored' ? 'Not a shop payment' : 'Not matched — tap to link'}</div>
          </div>
          <b className={x.status === 'ignored' ? 'muted' : 'pos'}>{rs(x.amount)}</b>
        </div>
      ))}
      {open && (
        <ActionSheet title={`${rs(open.amount)}${open.payer ? ` · ${open.payer}` : ''}`} sub={`${dayLabel(open.received_at)} ${timeLabel(open.received_at)}${open.bank ? ` · ${open.bank}` : ''}${open.ref ? ` · ref ${open.ref}` : ''}`} onClose={() => setOpen(null)}>
          {open.status === 'matched' ? <div className="muted small">✓ {open.match_label}{open.matched_by === 'auto' ? ' · matched by itself' : ' · linked by staff'}</div> : <>
            <div className="caps muted">Link to</div>
            <div className="gx-details">{candidates.length === 0 ? <div><span className="muted">Nothing waiting for online money right now.</span></div> : candidates.slice(0, 12).map((c) => (
              <div key={c.kind + c.id} className="gx-tap" role="button" tabIndex={0} onClick={() => link(c)}><span>{c.label}</span><b className={Math.abs(c.amount - Number(open.amount)) < 0.5 ? 'pos' : ''}>{rs(c.amount)}</b></div>
            ))}</div>
          </>}
          <ActionGrid items={[
            open.status !== 'new' && { label: 'Unlink', icon: <XIcon />, onClick: () => setStatus('new') },
            open.status !== 'ignored' && { label: 'Not a shop payment', icon: <XIcon />, onClick: () => setStatus('ignored'), danger: true },
          ]} />
        </ActionSheet>
      )}
    </div>
  )
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

// Customer deposits: paid ahead, used on later visits — kept from month to month until used (owner, 13 Oct;
// they used to lapse at month end).
// Used from the End sheet on the Floor; what's left can be given back (Return, owner 19 Oct).
const whenAt = (t) => `${new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${timeLabel(t)}`
// Every entry of one customer's deposit, newest first (owner, 19 Oct: "date and time it was added").
const depositEntries = (deposits, key) => (deposits || []).filter((d) => customerKey(d.customer_name, d.customer_phone) === key).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
const DEP_KIND = { add: 'Added', use: 'Used', refund: 'Returned' }

function Deposits({ shop, onAdd, onOpen, order }) {
  const rows = depositBalances(shop.deposits || [])
  const lastAdd = (key) => depositEntries(shop.deposits, key).find((d) => d.kind === 'add')
  return (
    <div className="card" style={{ order }}>
      <div className="card-head"><h3>Deposits</h3><button className="btn small" onClick={onAdd}>+ Deposit</button></div>
      {rows.length === 0 ? <div className="muted small">No deposits with money left. A deposit stays until it's used, even into next month.</div> : rows.map((r) => (
        <div key={r.key} className="line gx-tap" role="button" tabIndex={0} onClick={() => onOpen(r)}>
          <div className="grow"><div className="gx-ellipsis">{r.name}</div><div className="muted small">{[r.phone, lastAdd(r.key) && `added ${whenAt(lastAdd(r.key).created_at)}`].filter(Boolean).join(' · ')}</div></div>
          <b className="pos">{rs(r.balance)}</b>
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
    <Sheet title="Customer deposit" sub="Paid in advance, used on their next visits; whatever is left carries over to next month (or is returned)." onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <CustomerFields householdId={householdId} name={name} setName={setName} phone={phone} setPhone={setPhone} autoFocus required phonePlaceholder="To match them later" />
      <label>Amount (₹)<input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <Chips options={[['cash', 'Cash'], ['online', 'Online / scanner']]} value={mode} onChange={setMode} />
      {mode === 'online' && <UpiQrButton settings={settings} amount={Number(amount)} note={`Deposit · ${name.trim() || 'customer'}`} />}
      <SheetActions onClose={onClose} busy={busy} disabled={!name.trim() || !Number(amount)} label="Save deposit" />
    </Sheet>
  )
}

// Owner, 19 Oct: Delete = money added to a deposit by mistake comes off it (just an amount + a red confirm; no
// cash / online, no money moves). Saved as a 'use' with the note "Deleted (added by mistake)".
function DeleteDepositSheet({ row, householdId, onClose, onDone }) {
  const dialog = useDialog()
  const [amount, setAmount] = useState(String(Math.round(row.balance)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const value = Math.min(Number(amount) || 0, row.balance)
  async function save() {
    if (!value) return
    if (!await dialog.confirm({ title: `Delete ${rs(value)} from ${row.name}’s deposit?`, message: `Only for money added by mistake. ${rs(row.balance - value)} will be left. No cash or online money moves.`, confirmLabel: `Delete ${rs(value)}`, danger: true })) return
    setBusy(true)
    const { error } = await supabase.from('shop_deposits').insert({ household_id: householdId, customer_name: row.name, customer_phone: row.phone || null, kind: 'use', amount: value, note: 'Deleted (added by mistake)' })
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${rs(value)} deleted from ${row.name}’s deposit · ${rs(row.balance - value)} left`)
  }
  return (
    <Sheet title={`Delete from deposit · ${row.name}`} sub={`${rs(row.balance)} in their deposit · for money added by mistake`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <label>Amount to delete (₹)<input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <SheetActions onClose={onClose} busy={busy} disabled={!value} label={`Delete ${rs(value)}`} />
    </Sheet>
  )
}

// Owner, 19 Oct: "puts in ₹100, uses ₹50, asks for the ₹50 back when leaving" — give back what's left (or part of
// it). Saved as a deposit 'refund' (cash from the drawer, or sent online): the balance drops and it's money out today.
function RefundSheet({ row, householdId, onClose, onDone }) {
  const [amount, setAmount] = useState(String(Math.round(row.balance)))
  const [mode, setMode] = useState('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const value = Math.min(Number(amount) || 0, row.balance)
  async function save() {
    if (!value) return
    setBusy(true)
    const { error } = await supabase.from('shop_deposits').insert({ household_id: householdId, customer_name: row.name, customer_phone: row.phone || null, kind: 'refund', amount: value, mode, note: note.trim() || null })
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(`${rs(value)} returned to ${row.name}${row.balance - value > 0.5 ? ` · ${rs(row.balance - value)} still in their deposit` : ''}`)
  }
  return (
    <Sheet title={`Return deposit · ${row.name}`} sub={`${rs(row.balance)} left in their deposit`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <label>Amount to give back (₹)<input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <Chips options={[['cash', 'Cash from drawer'], ['online', 'Sent online']]} value={mode} onChange={setMode} />
      <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. leaving early" /></label>
      <SheetActions onClose={onClose} busy={busy} disabled={!value} label={`Return ${rs(value)}`} />
    </Sheet>
  )
}

// Customer dues (owner: staff must see them too): sessions ended as "Owes", any day, until paid back.
function CustomerDues({ shop, onCollect, onOpen, order }) {
  const rows = duesByCustomer(shop.dues)
  const total = rows.reduce((a, r) => a + r.total, 0)
  return (
    <div className="card" style={{ order }}>
      <div className="card-head"><h3>Customer dues</h3>{total > 0 && <b className="neg">{rs(total)}</b>}</div>
      {rows.length === 0 ? <div className="muted small">Nobody owes the shop anything.</div> : rows.map((r) => (
        <div key={r.key} className="line gx-tap" role="button" tabIndex={0} onClick={() => onOpen(r)}>
          <div className="grow">
            <div className="gx-ellipsis">{r.name}</div>
            <div className="muted small gx-ellipsis">{r.sessions.length} visit{r.sessions.length === 1 ? '' : 's'} · last {dayLabel(r.sessions[r.sessions.length - 1].started_at)}</div>
          </div>
          <b className="neg">{rs(r.total)}</b>
          <button className="btn small" onClick={(e) => { e.stopPropagation(); onCollect(r) }}>Collect</button>
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
function PlanClaims({ rows, order }) {
  const month = new Date().toLocaleDateString('en-IN', { month: 'long' })
  const list = rows || []
  return (
    <div className="card" style={{ order }}>
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



export { dueReason }
