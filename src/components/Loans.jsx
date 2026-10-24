import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { today } from '../lib/format'
import {
  KINDS, kindLabel, summaryOf, prepaySavings, interestUntil, costSplit, coverEvent, fyTable, emiOf, pmt, setLoanEvents, setLoanClosed, saveLoan, deleteLoan,
  loadLoans, loadDeals, saveDeal, deleteDeal, starterChecklist,
} from '../lib/loans'
import { loadDues } from '../lib/dues'
import { useDialog } from '../lib/dialog'
import { LoansIcon, TrashIcon } from '../lib/icons'
import { SkeletonRows } from './Skeleton'
import AmountInput from './AmountInput'
import { ShareChips } from './lists/ListParts'

const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}` // loan amounts read better in whole rupees
const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const months = (n) => `${Math.floor(n / 12) ? `${Math.floor(n / 12)} yr ` : ''}${n % 12 ? `${n % 12} mo` : ''}`.trim() || '0 mo'

// Budget → Loans: home loan, gold loan, any other loan — and, while one is going on, a property deal
// (buy or sell) with a paper checklist. Loans are long-lived; a deal is archived when it closes.
export default function Loans({ activeHouseholdId, households = [], member = false, view = 'loans' }) {
  const [loans, setLoans] = useState(null)
  const [deals, setDeals] = useState([])
  const [dues, setDues] = useState([])
  const [books, setBooks] = useState([])
  const [error, setError] = useState(null)
  const [show, setShow] = useState('open') // open | closed
  const [openLoanId, setOpenLoanId] = useState(null)
  const [editingLoan, setEditingLoan] = useState(null) // {} new, or a loan
  const [dealSheet, setDealSheet] = useState(null) // {} new, or a deal
  const [showArchived, setShowArchived] = useState(false)
  const day = today()

  const load = useCallback(async () => {
    if (!activeHouseholdId) return
    try {
      const [l, d, du, b] = await Promise.all([
        loadLoans(activeHouseholdId, { shared: true }), loadDeals(activeHouseholdId), loadDues(activeHouseholdId),
        supabase.from('hisab_books').select('id, name').eq('household_id', activeHouseholdId).eq('kind', 'occasion').order('created_at', { ascending: false }),
      ])
      if (b.error) throw b.error
      setLoans(l); setDeals(d); setDues(du); setBooks(b.data); setError(null)
    } catch (err) { setError(err.message) }
  }, [activeHouseholdId])
  useEffect(() => { load() }, [load])

  const withSummary = useMemo(() => (loans || []).map((l) => ({ ...l, s: summaryOf(l, day) })), [loans, day])
  // Loans shared with this household by another one are listed apart and stay out of its totals.
  const sharedIn = withSummary.filter((l) => l.shared && !l.closed_on)
  const mine = withSummary.filter((l) => !l.shared)
  const open = mine.filter((l) => !l.closed_on)
  const closed = mine.filter((l) => l.closed_on)
  const fromName = (l) => households.find((h) => h.id === l.household_id)?.name
  const list = show === 'open' ? open : closed
  const totals = open.reduce((t, l) => ({
    outstanding: t.outstanding + l.s.outstanding,
    monthly: t.monthly + (l.s.gold ? 0 : l.s.emiWithCover || l.s.emi || 0),
  }), { outstanding: 0, monthly: 0 })
  const current = withSummary.find((l) => l.id === openLoanId)
  const liveDeals = deals.filter((d) => !d.archived)
  const archivedDeals = deals.filter((d) => d.archived)

  return (
    <section>
      {error && <div className="alert error">{error}</div>}
      {view !== 'deals' && (
        <>
      <div className="tiles dues-tiles">
        <div className="card tile">
          <div className="muted small">Outstanding</div>
          {loans ? <div className="big-num neg">{money(totals.outstanding)}</div> : <div className="skel" style={{ width: '70%', height: 22 }} />}
        </div>
        <div className="card tile">
          <div className="muted small">EMIs every month</div>
          {loans ? <div className="big-num">{money(totals.monthly)}</div> : <div className="skel" style={{ width: '70%', height: 22 }} />}
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          <button className={`chip chip-btn ${show === 'open' ? 'on' : ''}`} onClick={() => setShow('open')}>Active · {open.length}</button>
          <button className={`chip chip-btn ${show === 'closed' ? 'on' : ''}`} onClick={() => setShow('closed')}>Closed · {closed.length}</button>
        </div>
        <div className="spacer" />
        <button className="btn primary small" onClick={() => setEditingLoan({})}>+ New loan</button>
      </div>

      {!loans ? <div className="card list"><SkeletonRows rows={3} /></div> : list.length === 0 ? (
        <div className="card empty-module">
          <LoansIcon />
          <b>{show === 'open' ? 'No active loans' : 'No closed loans yet'}</b>
          <p className="muted small">{show === 'open'
            ? 'Add your home loan or gold loan to see what is outstanding, how much interest you have paid, and what a prepayment would save.'
            : 'Loans move here once you close them.'}</p>
        </div>
      ) : (
        <div className="due-list">
          {list.map((l) => <LoanCard key={l.id} loan={l} onOpen={() => setOpenLoanId(l.id)} />)}
        </div>
      )}
      {show === 'open' && sharedIn.length > 0 && (
        <>
          <h3 className="loans-shared-head">Shared with this household</h3>
          <div className="due-list">
            {sharedIn.map((l) => <LoanCard key={l.id} loan={l} from={fromName(l)} onOpen={() => setOpenLoanId(l.id)} />)}
          </div>
        </>
      )}
        </>
      )}

      {view === 'deals' && (
        <>
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>Property deals</h3>
        <div className="spacer" />
        <button className="btn small" onClick={() => setDealSheet({})}>+ New deal</button>
      </div>
      {liveDeals.length === 0 ? (
        <p className="muted small">Buying or selling a property? A deal keeps the price, what you have spent, what is still due to the builder and a checklist of papers together. Archive it when it closes.</p>
      ) : (
        <div className="due-list">
          {liveDeals.map((d) => <DealCard key={d.id} deal={d} dues={dues} loans={withSummary} onOpen={() => setDealSheet(d)} />)}
        </div>
      )}
      {archivedDeals.length > 0 && (
        <>
          <button className="btn link small" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Hide' : 'Show'} {archivedDeals.length} archived</button>
          {showArchived && <div className="due-list">{archivedDeals.map((d) => <DealCard key={d.id} deal={d} dues={dues} loans={withSummary} onOpen={() => setDealSheet(d)} />)}</div>}
        </>
      )}
        </>
      )}

      {current && <LoanSheet loan={current} from={fromName(current)} onClose={() => setOpenLoanId(null)} onEdit={() => setEditingLoan(current)} onChanged={load} />}
      {editingLoan && <LoanForm loan={editingLoan.id ? editingLoan : null} householdId={activeHouseholdId} households={households} canShare={!member} onClose={() => setEditingLoan(null)}
        onSaved={(l) => { setEditingLoan(null); load(); if (!editingLoan.id) setOpenLoanId(l.id) }}
        onDeleted={() => { setEditingLoan(null); setOpenLoanId(null); load() }} />}
      {dealSheet && <DealSheet deal={dealSheet.id ? dealSheet : null} householdId={activeHouseholdId} books={books} dues={dues} loans={withSummary}
        onClose={() => setDealSheet(null)} onSaved={() => { setDealSheet(null); load() }} />}
    </section>
  )
}

function LoanCard({ loan, from, onOpen }) {
  const s = loan.s
  return (
    <button className="card due-card" onClick={onOpen}>
      <div className="due-top">
        <span className="due-avatar">{loan.kind === 'gold' ? 'Au' : loan.kind === 'home' ? '🏠' : '₹'}</span>
        <div className="grow">
          <div className="due-name">{loan.name}</div>
          <div className="muted small">{[kindLabel(loan.kind), loan.lender, loan.shared ? (from ? `shared by ${from}` : 'shared') : null].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="due-bal neg"><b className="amt">{money(s.outstanding)}</b><span className="small">outstanding</span></div>
      </div>
      {s.gold ? (
        <div className="muted small due-foot">
          <span>{money(s.yearlyInterest)} interest a year</span>
          <span className={s.state === 'overdue' ? 'neg' : s.state === 'soon' ? 'warn' : ''}>
            {loan.closed_on ? `closed ${fmtDate(loan.closed_on)}` : s.daysToDue !== null && s.daysToDue < 0 ? `renewal overdue by ${-s.daysToDue} days` : s.daysToInterest < 0 ? `interest overdue by ${-s.daysToInterest} days` : s.daysToInterest <= 60 ? `interest due in ${s.daysToInterest} days` : `interest on ${fmtDate(s.nextInterestOn)}`}
          </span>
        </div>
      ) : s.incomplete ? <div className="muted small">Add the tenure or EMI to see the schedule.</div> : (
        <>
          <div className="bar"><div className="fill ok" style={{ width: `${s.progress * 100}%` }} /></div>
          <div className="muted small due-foot">
            <span>{Math.round(s.progress * 100)}% repaid · EMI {money(s.emiWithCover || s.emi)}</span>
            <span>{loan.closed_on ? `closed ${fmtDate(loan.closed_on)}` : s.nextDate ? `next ${fmtDate(s.nextDate)}` : 'fully paid'}</span>
          </div>
        </>
      )}
    </button>
  )
}

function Stat({ label, value, tone }) {
  return <div className="loan-stat"><span className="muted small">{label}</span><b className={tone || ''}>{value}</b></div>
}

function LoanSheet({ loan, from, onClose, onEdit, onChanged }) {
  const readOnly = !!loan.shared // shared in from another household: view only
  const dialog = useDialog()
  const s = loan.s
  const day = today()
  const [tab, setTab] = useState('overview') // EMI loans: overview | years | prepay
  const [what, setWhat] = useState('')
  const [ev, setEv] = useState(null) // { type, date, amount, rate }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const savings = !s.gold && Number(what) > 0 ? prepaySavings(loan, what, day) : null
  const fy = !s.gold && s.rows ? fyTable(s.rows, day, s.coverEmi) : []
  const events = [...(loan.events || [])].filter((x) => x.type !== 'cover').sort((a, b) => (a.date < b.date ? 1 : -1))
  const split = !s.gold && s.rows ? costSplit(fy, s) : null

  async function addEvent(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const item = ev.type === 'rate'
        ? { id: crypto.randomUUID(), type: 'rate', date: ev.date, rate: Number(ev.rate) }
        : { id: crypto.randomUUID(), type: ev.type, date: ev.date, amount: Number(ev.amount) }
      await setLoanEvents(loan, [...(loan.events || []), item])
      setEv(null); onChanged()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }
  async function removeEvent(id) {
    try { await setLoanEvents(loan, (loan.events || []).filter((x) => x.id !== id)); onChanged() } catch (err) { setError(err.message) }
  }
  async function toggleClosed() {
    if (!loan.closed_on && !await dialog.confirm({ title: `Close ${loan.name}?`, message: 'It moves to Closed and stops counting in your totals. You can reopen it later.', confirmLabel: 'Close loan', danger: false })) return
    try { await setLoanClosed(loan, loan.closed_on ? null : day); onChanged(); if (!loan.closed_on) onClose() } catch (err) { setError(err.message) }
  }

  const eventsBlock = (
    <>
      {events.length === 0 && <p className="muted small">{s.gold ? 'None yet. Pay the interest whenever you like — even before the year ends — and add it here; what builds up then counts from that day.' : 'None yet. Add one when it happens, so the schedule follows your loan.'}</p>}
      {events.map((x) => (
        <div key={x.id} className="line">
          <span>{x.type === 'prepay' ? `Prepaid ${money(x.amount)}` : x.type === 'interest' ? `Paid interest ${money(x.amount)}` : `Rate changed to ${x.rate}%`}<span className="muted small"> · {fmtDate(x.date)}</span></span>
          {!readOnly && <button className="btn icon" aria-label="Remove" onClick={() => removeEvent(x.id)}><TrashIcon /></button>}
        </div>
      ))}
      {readOnly ? null : ev ? (
        <form className="stack" onSubmit={addEvent}>
          {!s.gold && <div className="seg">
            <button type="button" className={ev.type === 'prepay' ? 'on' : ''} onClick={() => setEv({ ...ev, type: 'prepay' })}>Prepayment</button>
            <button type="button" className={ev.type === 'rate' ? 'on' : ''} onClick={() => setEv({ ...ev, type: 'rate' })}>Rate change</button>
          </div>}
          <div className="row2">
            <label>Date<input type="date" required value={ev.date} onChange={(e) => setEv({ ...ev, date: e.target.value, ...(ev.type === 'interest' && !ev.touched ? { amount: String(Math.round(interestUntil(loan, e.target.value))) } : {}) })} /></label>
            {ev.type !== 'rate'
              ? <label>{ev.type === 'interest' ? 'Interest paid' : 'Amount'}<AmountInput min="1" step="0.01" required value={ev.amount} onChange={(e) => setEv({ ...ev, amount: e.target.value, touched: true })} /></label>
              : <label>New rate %<input type="number" inputMode="decimal" min="0" step="0.01" required value={ev.rate} onChange={(e) => setEv({ ...ev, rate: e.target.value })} /></label>}
          </div>
          <div className="actions"><div className="spacer" /><button type="button" className="btn" onClick={() => setEv(null)}>Cancel</button><button className="btn primary" disabled={busy}>Add</button></div>
        </form>
      ) : <button className="btn small" onClick={() => setEv(s.gold ? { type: 'interest', date: day, amount: String(Math.round(interestUntil(loan, day))), rate: '' } : { type: 'prepay', date: day, amount: '', rate: '' })}>{s.gold ? '+ Pay interest (till date)' : '+ Add prepayment or rate change'}</button>}
    </>
  )

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal due-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{loan.name}</h3>
        <div className="muted small">{[kindLabel(loan.kind), loan.lender, `${loan.rate}% a year`, `from ${fmtDate(loan.start_date)}`].filter(Boolean).join(' · ')}</div>
        <div className="due-bal neg"><b className="amt">{money(s.outstanding)}</b><span className="small">outstanding</span></div>
        {s.coverEmi > 0 && <div className="muted small">Bank debits {money(s.emiWithCover)} a month: {money(s.emi)} loan + {money(s.coverEmi)} life cover</div>}

        {s.gold ? (
          <>
            <div className="loan-stats">
              <Stat label="Interest each year" value={money(s.yearlyInterest)} />
              <Stat label="Next interest due" value={s.nextInterestOn ? fmtDate(s.nextInterestOn) : '—'} tone={s.state === 'soon' ? 'warn' : ''} />
              <Stat label={s.lastInterestOn ? `Built up since ${fmtDate(s.lastInterestOn)}` : 'Built up since you took it'} value={money(s.sinceLast)} />
              <Stat label="Renewal / closing date" value={loan.due_date ? fmtDate(loan.due_date) : '—'} tone={s.state === 'overdue' ? 'neg' : ''} />
              <Stat label="Interest paid so far" value={money(s.paidInterest)} tone="pos" />
              <Stat label="Gold pledged" value={loan.grams ? `${loan.grams} g` : '—'} />
            </div>
            <h4>Interest payments</h4>
            {eventsBlock}
          </>
        ) : s.incomplete ? <div className="alert error">Edit the loan and add its tenure or EMI to see the schedule.</div> : (
          <>
            <div className="bar"><div className="fill ok" style={{ width: `${s.progress * 100}%` }} /></div>
            <div className="subnav loan-tabs" role="tablist">
              {[['overview', 'Overview'], ['years', 'Years'], ['prepay', 'Prepay']].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
            {s.stuck && <div className="alert error">The EMI does not cover the monthly interest, so the loan never ends. Check the rate and EMI.</div>}

            {tab === 'overview' && (
              <>
                <div className="loan-stats">
                  <Stat label="Principal paid" value={money(s.paidPrincipal)} tone="pos" />
                  <Stat label="Interest paid" value={money(s.paidInterest)} tone="neg" />
                  <Stat label={s.coverEmi > 0 ? 'EMI (loan)' : 'EMI'} value={money(s.emi)} />
                  <Stat label="Next EMI" value={s.nextDate ? fmtDate(s.nextDate) : 'none'} />
                  <Stat label="Ends" value={fmtDate(s.payoffDate)} />
                  <Stat label="Time left" value={months(s.monthsLeft)} />
                </div>
                {split && <p className="muted small" style={{ margin: 0 }}>Over the whole loan you pay <b>{money(split.whole.total)}</b>: {money(split.whole.principal)} principal and {money(split.whole.interest)} interest. See the Years tab for each year.</p>}
                {s.coverEmi > 0 && (
                  <div className="loan-save">
                    <b>Life cover</b>: {money(s.coverEmi)} a month with the EMI, {money(s.coverTotal)} over the loan{coverEvent(loan)?.amount ? ` (premium ${money(coverEvent(loan).amount)} plus the interest on it)` : ''}. Paid so far <b>{money(s.coverPaid)}</b>.
                  </div>
                )}
              </>
            )}

            {tab === 'years' && split && (
              <>
                <div className="fy-table fy-totals">
                  <div className="fy-row head"><span /><span>Interest</span><span>Principal</span></div>
                  <div className="fy-row"><span>Paid so far</span><span className="amt">{money(split.paid.interest)}</span><span className="amt">{money(split.paid.principal)}</span></div>
                  <div className="fy-row"><span>Still to come</span><span className="amt">{money(split.ahead.interest)}</span><span className="amt">{money(split.ahead.principal)}</span></div>
                  <div className="fy-row total"><span>Whole loan</span><span className="amt">{money(split.whole.interest)}</span><span className="amt">{money(split.whole.principal)}</span></div>
                </div>
                {s.coverEmi > 0 && (
                  <div className="fy-table fy-totals">
                    <div className="fy-row head"><span /><span>Paid so far</span><span>Whole loan</span></div>
                    <div className="fy-row total"><span>Life cover</span><span className="amt">{money(s.coverPaid)}</span><span className="amt">{money(s.coverTotal)}</span></div>
                  </div>
                )}
                <p className="loan-save" style={{ margin: 0 }}>Together{s.coverEmi > 0 ? ' with the life cover' : ''}: <b>{money(split.whole.total + (s.coverTotal || 0))}</b> over the loan, of which <b>{money(split.paid.total + (s.coverPaid || 0))}</b> paid so far.</p>
                <h4>Year by year</h4>
                <div className="fy-table">
                  <div className="fy-row head"><span>Year</span><span>Interest</span><span>Principal</span></div>
                  {fy.map((r) => (
                    <div key={r.fy} className="fy-row">
                      <span>{r.fy}{r.planned ? '*' : ''}</span>
                      <span className="amt">{money(r.interest)}</span>
                      <span className="amt">{money(r.principal)}</span>
                      {r.cover > 0 && <span className="fy-extra">+ {money(r.cover)} life cover</span>}
                    </div>
                  ))}
                  <div className="fy-row total"><span>Total</span><span className="amt">{money(split.whole.interest)}</span><span className="amt">{money(split.whole.principal)}</span></div>
                </div>
                <p className="muted small" style={{ margin: 0 }}>* Not over yet. Worked out as if every EMI was paid on its date, so past years should match your bank's loan certificate.{s.coverEmi > 0 ? ' Interest and principal are for the loan itself; the life cover is shown separately.' : ''}</p>
              </>
            )}

            {tab === 'prepay' && (
              <>
                <h4 style={{ marginTop: 0 }}>If I prepay</h4>
                <label>Amount<AmountInput min="1" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. 2,00,000" /></label>
                {savings && (
                  <div className="loan-save">
                    Saves <b className="pos">{money(savings.interestSaved)}</b> of interest and <b>{months(savings.monthsSaved)}</b>; the loan then ends {fmtDate(savings.newPayoff)}.
                  </div>
                )}
                <h4>Prepayments and rate changes</h4>
                {eventsBlock}
              </>
            )}
          </>
        )}

        {loan.note && <p className="muted small">{loan.note}</p>}
        {readOnly && <p className="muted small">{from ? `Shared by ${from}.` : 'Shared with your household.'} You can look but not change it, and it isn't in your totals.</p>}
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          {!readOnly && <button className="btn" onClick={toggleClosed}>{loan.closed_on ? 'Reopen' : 'Close loan'}</button>}
          <div className="spacer" />
          {!readOnly && <button className="btn" onClick={onEdit}>Edit</button>}
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

function LoanForm({ loan, householdId, households = [], canShare, onClose, onSaved, onDeleted }) {
  const dialog = useDialog()
  const [f, setF] = useState(() => ({
    kind: loan?.kind || 'home', name: loan?.name || '', lender: loan?.lender || '', principal: loan ? String(loan.principal) : '',
    coverEmi: (() => { const ce = coverEvent(loan || {}); return ce?.emi ? String(ce.emi) : ce?.amount ? String(Math.round(pmt(ce.amount, loan.rate, loan.tenure_months))) : '' })(),
    rate: loan ? String(loan.rate) : '', tenure_months: loan?.tenure_months ? String(loan.tenure_months) : '', emi: loan?.emi ? String(loan.emi) : '',
    start_date: loan?.start_date || today(), interest_only: loan ? loan.interest_only : false, due_date: loan?.due_date || '',
    grams: loan?.grams ? String(loan.grams) : '', note: loan?.note || '', shared_with: loan?.shared_with || [],
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const pickKind = (e) => setF((x) => ({ ...x, kind: e.target.value, interest_only: e.target.value === 'gold' ? true : x.interest_only && x.kind !== 'gold' }))
  const hint = !f.interest_only && Number(f.principal) > 0 && Number(f.tenure_months) > 0 ? emiOf({ principal: f.principal, rate: f.rate, tenure_months: f.tenure_months, emi: null }) : 0

  async function save(e) {
    e.preventDefault()
    if (!f.interest_only && !(Number(f.tenure_months) > 0) && !(Number(f.emi) > 0)) { setError('Add the tenure or the EMI.'); return }
    setBusy(true); setError(null)
    try { onSaved(await saveLoan({ id: loan?.id, householdId, ...f, events: loan?.events })) } catch (err) { setError(err.message); setBusy(false) }
  }
  async function remove() {
    if (!await dialog.confirm({ title: `Delete ${loan.name}?`, message: 'Its prepayments and rate changes are deleted too. A property deal linked to it just loses the link.', confirmLabel: 'Delete' })) return
    try { await deleteLoan(loan.id); onDeleted() } catch (err) { setError(err.message) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{loan ? 'Edit loan' : 'New loan'}</h3>
        <div className="row2">
          <label>Type<select value={f.kind} onChange={pickKind}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
          <label>Name<input required value={f.name} onChange={set('name')} placeholder="e.g. New flat loan" autoFocus={!loan} /></label>
        </div>
        <label>Lender <span className="muted">(optional)</span><input value={f.lender} onChange={set('lender')} placeholder="Bank or company" /></label>
        <div className="row2">
          <label>Amount borrowed<AmountInput min="1" step="0.01" required value={f.principal} onChange={set('principal')} /></label>
          <label>Interest % a year<input type="number" inputMode="decimal" min="0" step="0.01" required value={f.rate} onChange={set('rate')} /></label>
        </div>
        <label>{f.interest_only ? 'Taken on' : 'First loan date'}<input type="date" required value={f.start_date} onChange={set('start_date')} /></label>
        <label className="check"><input type="checkbox" checked={f.interest_only} onChange={set('interest_only')} /> Interest only — interest paid once a year, the amount repaid at the end (gold loan)</label>
        {f.interest_only ? (
          <div className="row2">
            <label>Renewal / closing date<input type="date" value={f.due_date} onChange={set('due_date')} /></label>
            <label>Gold pledged (g) <span className="muted">(optional)</span><input type="number" inputMode="decimal" min="0" step="0.01" value={f.grams} onChange={set('grams')} /></label>
          </div>
        ) : (
          <>
            <div className="row2">
              <label>Tenure (months)<input type="number" inputMode="numeric" min="1" value={f.tenure_months} onChange={set('tenure_months')} placeholder="e.g. 240" /></label>
              <label>Loan EMI <span className="muted">(optional)</span><AmountInput min="0" step="0.01" value={f.emi} onChange={set('emi')} placeholder={hint ? `≈ ${Math.round(hint)}` : 'worked out'} /></label>
            </div>
            <p className="muted small">The loan EMI is worked out from the amount, the rate and the tenure, unless you type the exact one from your bank (without any life cover).</p>
            <label>Life cover premium, each month <span className="muted">(optional)</span>
              <AmountInput min="0" step="0.01" value={f.coverEmi} onChange={set('coverEmi')} placeholder="e.g. 2,788" />
            </label>
            <p className="muted small" style={{ margin: 0 }}>If your bank adds a loan life cover, put what it adds to the EMI each month here. Your bank debits the EMI plus this; the loan itself stays as it is.</p>
          </>
        )}
        <label>Note <span className="muted">(optional)</span><input value={f.note} onChange={set('note')} /></label>
        {canShare && <ShareChips households={households} homeId={householdId} value={f.shared_with} onChange={(shared_with) => setF((x) => ({ ...x, shared_with }))} />}
        {canShare && f.shared_with.length > 0 && <p className="muted small" style={{ margin: 0 }}>Those households can see this loan but not change it. It stays out of their totals.</p>}
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          {loan && <button type="button" className="btn icon" aria-label="Delete loan" onClick={remove}><TrashIcon /></button>}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

// ── Property deals ──────────────────────────────────────────────────────────────────────────────────────

function DealCard({ deal, dues, loans, onOpen }) {
  const due = dues.find((d) => d.id === deal.due_id)
  const loan = loans.find((l) => l.id === deal.loan_id)
  const done = (deal.checklist || []).filter((c) => c.done).length
  const total = (deal.checklist || []).length
  return (
    <button className="card due-card" onClick={onOpen}>
      <div className="due-top">
        <span className="due-avatar">{deal.kind === 'sell' ? '₹' : '🏠'}</span>
        <div className="grow">
          <div className="deal-title"><span className="deal-name">{deal.name}</span><span className="pill">{deal.kind === 'sell' ? 'selling' : 'buying'}</span></div>
          <div className="muted small">{deal.price ? `Price ${money(deal.price)}` : 'No price set'}{deal.archived ? ' · archived' : ''}</div>
        </div>
      </div>
      <div className="loan-stats">
        {deal.spent !== null && <Stat label="Spent so far" value={money(deal.spent)} />}
        {due && due.balance !== 0 && <Stat label={due.balance < 0 ? `Still to pay ${due.person}` : `${due.person} still owes`} value={money(Math.abs(due.balance))} tone={due.balance < 0 ? 'neg' : 'pos'} />}
        {loan && <Stat label="Loan outstanding" value={money(loan.s.outstanding)} />}
      </div>
      {total > 0 && (
        <>
          <div className="bar"><div className="fill ok" style={{ width: `${(done / total) * 100}%` }} /></div>
          <div className="muted small">{done} of {total} papers in hand</div>
        </>
      )}
    </button>
  )
}

function DealSheet({ deal, householdId, books, dues, loans, onClose, onSaved }) {
  const dialog = useDialog()
  const [f, setF] = useState(() => ({
    name: deal?.name || '', kind: deal?.kind || 'buy', price: deal?.price ? String(deal.price) : '',
    book_id: deal?.book_id || '', due_id: deal?.due_id || '', loan_id: deal?.loan_id || '',
    checklist: deal?.checklist || starterChecklist('buy'), archived: !!deal?.archived,
  }))
  const [newItem, setNewItem] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const patch = (id, p) => setF((x) => ({ ...x, checklist: x.checklist.map((c) => (c.id === id ? { ...c, ...p } : c)) }))
  const untouched = !deal && f.checklist.every((c) => !c.done && !c.where && !c.note)
  const pickKind = (kind) => setF((x) => ({ ...x, kind, checklist: untouched ? starterChecklist(kind) : x.checklist }))
  const addItem = () => {
    const label = newItem.trim()
    if (!label) return
    setF((x) => ({ ...x, checklist: [...x.checklist, { id: crypto.randomUUID(), label, done: false, where: '', note: '' }] }))
    setNewItem('')
  }

  async function save(e, archived = f.archived) {
    e?.preventDefault()
    setBusy(true); setError(null)
    try { await saveDeal({ id: deal?.id, householdId, ...f, archived }); onSaved() } catch (err) { setError(err.message); setBusy(false) }
  }
  async function remove() {
    if (!await dialog.confirm({ title: `Delete ${deal.name}?`, message: 'Only the deal and its checklist are deleted — the Hisab book, the due and the loan stay.', confirmLabel: 'Delete' })) return
    try { await deleteDeal(deal.id); onSaved() } catch (err) { setError(err.message) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{deal ? 'Property deal' : 'New property deal'}</h3>
        <div className="seg">
          <button type="button" className={f.kind === 'buy' ? 'on' : ''} onClick={() => pickKind('buy')}>Buying</button>
          <button type="button" className={f.kind === 'sell' ? 'on' : ''} onClick={() => pickKind('sell')}>Selling</button>
        </div>
        <div className="row2">
          <label>Name<input required value={f.name} onChange={set('name')} placeholder="e.g. New flat" autoFocus={!deal} /></label>
          <label>Price <span className="muted">(optional)</span><AmountInput min="0" step="0.01" value={f.price} onChange={set('price')} /></label>
        </div>
        <label>Expenses book
          <select value={f.book_id} onChange={set('book_id')}><option value="">None</option>{books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </label>
        <label>{f.kind === 'sell' ? 'Buyer payments (a due)' : 'Builder payments (a due)'}
          <select value={f.due_id} onChange={set('due_id')}><option value="">None</option>{dues.map((d) => <option key={d.id} value={d.id}>{d.person}{d.note ? ` · ${d.note}` : ''}</option>)}</select>
        </label>
        <label>Loan
          <select value={f.loan_id} onChange={set('loan_id')}><option value="">None</option>{loans.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </label>

        <h4>Papers</h4>
        <p className="muted small">A checklist only — tick each paper and note where it is kept. Nothing is uploaded.</p>
        <div className="paper-list">
          {f.checklist.map((c) => (
            <div key={c.id} className="paper">
              <div className="line">
                <label className="check grow"><input type="checkbox" checked={c.done} onChange={(e) => patch(c.id, { done: e.target.checked })} /><span className={c.done ? 'done' : ''}>{c.label}</span></label>
                <button type="button" className="btn icon" aria-label={`Remove ${c.label}`} onClick={() => setF((x) => ({ ...x, checklist: x.checklist.filter((i) => i.id !== c.id) }))}><TrashIcon /></button>
              </div>
              <div className="row2">
                <input value={c.where} onChange={(e) => patch(c.id, { where: e.target.value })} placeholder="Where it is kept" aria-label={`Where ${c.label} is kept`} />
                <input value={c.note} onChange={(e) => patch(c.id, { note: e.target.value })} placeholder="Note" aria-label={`Note for ${c.label}`} />
              </div>
            </div>
          ))}
        </div>
        <div className="row2">
          <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add another paper" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }} />
          <button type="button" className="btn" onClick={addItem}>Add</button>
        </div>

        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          {deal && <button type="button" className="btn icon" aria-label="Delete deal" onClick={remove}><TrashIcon /></button>}
          {deal && <button type="button" className="btn" disabled={busy} onClick={() => save(null, !deal.archived)}>{deal.archived ? 'Unarchive' : 'Archive'}</button>}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
