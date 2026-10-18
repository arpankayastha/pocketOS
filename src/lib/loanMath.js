// Pure loan maths (no imports, so plain node can test it: `npm run test:loans`).
// Loans (Budget → Loans): a home loan, a gold loan, any other loan. The maths below is pure (tested with
// made-up numbers, `npm run test:loans`); only the loan terms and what happened since — prepayments and rate
// changes, kept in `events` — are stored. Assumes every EMI is paid on its date, one month apart from the start date.
// A prepayment cuts the balance and keeps the EMI (the loan ends sooner); a rate change keeps the EMI too (the tenure moves).

export const KINDS = [
  { id: 'home', label: 'Home loan' },
  { id: 'gold', label: 'Gold loan' },
  { id: 'other', label: 'Other loan' },
]
export const kindLabel = (k) => KINDS.find((x) => x.id === k)?.label || 'Loan'

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

export function pmt(principal, annualRate, months) {
  const p = Number(principal), n = Number(months)
  if (!p || !n) return 0
  const r = Number(annualRate) / 1200
  return r === 0 ? p / n : (p * r * (1 + r) ** n) / ((1 + r) ** n - 1)
}

// 'YYYY-MM-DD' + n months, clamping the day (31 Jan + 1 month = 28/29 Feb).
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number)
  const t = m - 1 + n
  const yy = y + Math.floor(t / 12)
  const mm = ((t % 12) + 12) % 12
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

const dayNumber = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000) }
export const daysBetween = (a, b) => dayNumber(b) - dayNumber(a)

// Financial year (Apr–Mar) of a date: 'FY 2025-26'.
export function fyOf(date) {
  const [y, m] = date.split('-').map(Number)
  const start = m >= 4 ? y : y - 1
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

// The EMI actually charged: the one typed in, else worked out from principal, rate and tenure.
export const emiOf = (loan) => (Number(loan.emi) > 0 ? Number(loan.emi) : pmt(loan.principal, loan.rate, loan.tenure_months))

// Month-by-month schedule: [{ n, date, interest, principal, prepay, balance, emi }]. `extra` = what-if events.
export function schedule(loan, extra = []) {
  const events = [...(loan.events || []), ...extra]
  const prepays = events.filter((e) => e.type === 'prepay').sort(byDate)
  const rates = events.filter((e) => e.type === 'rate').sort(byDate)
  const emi = emiOf(loan)
  let bal = Number(loan.principal)
  const rows = []
  if (!(bal > 0) || !(emi > 0)) return rows
  for (let n = 1; n <= 1200 && bal > 0.005; n++) {
    const date = addMonths(loan.start_date, n)
    const prev = addMonths(loan.start_date, n - 1)
    let prepay = 0
    for (const p of prepays) if (p.date > prev && p.date <= date) prepay += Number(p.amount)
    prepay = Math.min(prepay, bal)
    bal -= prepay
    let rate = Number(loan.rate)
    for (const r of rates) if (r.date <= date) rate = Number(r.rate)
    const interest = bal * rate / 1200
    const pay = Math.min(emi, bal + interest)
    const principal = pay - interest
    if (principal <= 0.005 && bal > 0.005) { rows.push({ n, date, interest, principal: 0, prepay, balance: bal, emi: pay, stuck: true }); break }
    bal = Math.max(0, bal - principal)
    rows.push({ n, date, interest, principal, prepay, balance: bal, emi: pay })
    if (bal <= 0.005 && prepay === 0 && principal <= 0.005) break
  }
  return rows
}

// Where an EMI loan stands on `today` ('YYYY-MM-DD').
export function summary(loan, today) {
  const rows = schedule(loan)
  const emi = emiOf(loan)
  const principal = Number(loan.principal)
  if (!rows.length) return { incomplete: true, emi, outstanding: principal, paidInterest: 0, paidPrincipal: 0, progress: 0 }
  const past = rows.filter((r) => r.date <= today)
  const next = rows.find((r) => r.date > today)
  const paidInterest = past.reduce((s, r) => s + r.interest, 0)
  const paidPrincipal = past.reduce((s, r) => s + r.principal + r.prepay, 0)
  const closed = !!loan.closed_on
  const outstanding = closed ? 0 : past.length ? past[past.length - 1].balance : principal
  const totalInterest = rows.reduce((s, r) => s + r.interest, 0)
  return {
    emi,
    rows,
    stuck: rows.some((r) => r.stuck),
    outstanding,
    paidInterest,
    paidPrincipal,
    progress: closed ? 1 : Math.min(1, Math.max(0, 1 - outstanding / principal)),
    nextDate: next?.date || null,
    nextAmount: next?.emi ?? 0,
    payoffDate: rows[rows.length - 1].date,
    monthsLeft: rows.length - past.length,
    totalInterest,
  }
}

// What a prepayment of `amount` on `today` saves.
export function prepaySavings(loan, amount, today) {
  const base = schedule(loan)
  const withIt = schedule(loan, [{ id: 'what-if', type: 'prepay', date: today, amount: Number(amount) }])
  if (!base.length || !withIt.length) return null
  const sum = (rs) => rs.reduce((s, r) => s + r.interest, 0)
  return {
    interestSaved: Math.max(0, sum(base) - sum(withIt)),
    monthsSaved: Math.max(0, base.length - withIt.length),
    newPayoff: withIt[withIt.length - 1].date,
  }
}

// Interest and principal per financial year, for tax time. `planned` = the year isn't over yet.
export function fyTable(rows, today) {
  const map = new Map()
  for (const r of rows) {
    const k = fyOf(r.date)
    const e = map.get(k) || { fy: k, interest: 0, principal: 0, last: r.date }
    e.interest += r.interest
    e.principal += r.principal + r.prepay
    e.last = r.date
    map.set(k, e)
  }
  return [...map.values()].map((e) => ({ ...e, planned: e.last > today }))
}

// Interest-only loans (gold): the principal is repaid at the end, interest runs by the day.
export function goldSummary(loan, today) {
  const principal = Number(loan.principal)
  const rate = Number(loan.rate)
  const end = loan.closed_on && loan.closed_on < today ? loan.closed_on : today
  const days = Math.max(0, daysBetween(loan.start_date, end))
  const daysToDue = loan.due_date ? daysBetween(today, loan.due_date) : null
  return {
    outstanding: loan.closed_on ? 0 : principal,
    monthlyInterest: principal * rate / 1200,
    accrued: principal * rate / 36500 * days,
    days,
    daysToDue,
    state: loan.closed_on ? 'closed' : daysToDue === null ? 'ok' : daysToDue < 0 ? 'overdue' : daysToDue <= 15 ? 'soon' : 'ok',
  }
}

export const summaryOf = (loan, today) => (loan.interest_only ? { gold: true, ...goldSummary(loan, today) } : summary(loan, today))
