import assert from 'node:assert/strict'
import { interestUntil, pmt, addMonths, fyOf, schedule, summary, prepaySavings, fyTable, goldSummary, summaryOf, daysBetween } from './loanMath.js'

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

// Made-up loan: 50,00,000 at 8.5% for 20 years.
near(pmt(5000000, 8.5, 240), 43391.16, 0.5, 'EMI')
assert.equal(pmt(120000, 0, 12), 10000)
assert.equal(addMonths('2025-01-31', 1), '2025-02-28')
assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
assert.equal(addMonths('2025-11-15', 3), '2026-02-15')
assert.equal(fyOf('2026-03-31'), 'FY 2025-26')
assert.equal(fyOf('2026-04-01'), 'FY 2026-27')
assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30)

const loan = { principal: 5000000, rate: 8.5, tenure_months: 240, emi: null, start_date: '2025-04-10', events: [], interest_only: false }
const rows = schedule(loan)
assert.ok(rows.length >= 239 && rows.length <= 241, `length ${rows.length}`)
near(rows[rows.length - 1].balance, 0, 0.01, 'ends at zero')
near(rows[0].interest, 5000000 * 8.5 / 1200, 0.01, 'first interest')
const totalInterest = rows.reduce((s, r) => s + r.interest, 0)
near(totalInterest, 43391.16 * 240 - 5000000, 500, 'total interest')

const s = summary(loan, '2026-04-20') // 12 EMIs paid
assert.equal(s.rows.length, rows.length)
near(s.outstanding, rows[11].balance, 0.01, 'outstanding after 12')
near(s.paidInterest + s.paidPrincipal, 12 * 43391.16, 20, 'paid so far')
assert.equal(s.nextDate, '2026-05-10')
assert.equal(s.monthsLeft, rows.length - 12)

// A prepayment shortens the loan and saves interest; a bigger one saves more.
const a = prepaySavings(loan, 500000, '2026-04-20')
const b = prepaySavings(loan, 1000000, '2026-04-20')
assert.ok(a.monthsSaved > 20 && a.interestSaved > 500000, JSON.stringify(a))
assert.ok(b.interestSaved > a.interestSaved && b.monthsSaved > a.monthsSaved)

// A loan that has not started yet: a prepayment today still counts (from the first EMI).
const future = { ...loan, start_date: '2026-12-05' }
const f = prepaySavings(future, 1000000, '2026-10-19')
assert.ok(f.interestSaved > 1000000 && f.monthsSaved > 12, JSON.stringify(f))
assert.equal(summary(future, '2026-10-19').outstanding, 5000000)

// A recorded prepayment and the what-if agree.
const withEvent = { ...loan, events: [{ id: 'x', type: 'prepay', date: '2026-04-20', amount: 500000 }] }
assert.equal(schedule(withEvent).length, rows.length - a.monthsSaved)

// A rate change keeps the EMI, so the loan gets longer when the rate rises.
const up = { ...loan, events: [{ id: 'r', type: 'rate', date: '2027-04-10', rate: 9.5 }] }
assert.ok(schedule(up).length > rows.length)

// EMI below the interest → flagged, no endless loop.
const stuck = schedule({ ...loan, emi: 1000 })
assert.ok(stuck.some((r) => r.stuck))

// Financial-year table sums back to the whole.
const fy = fyTable(rows, '2026-04-20')
near(fy.reduce((x, r) => x + r.interest, 0), totalInterest, 0.01, 'FY interest')
near(fy.reduce((x, r) => x + r.principal, 0), 5000000, 0.01, 'FY principal')
assert.equal(fy[0].fy, 'FY 2025-26')
assert.equal(fy[0].planned, false)
assert.equal(fy[fy.length - 1].planned, true)

// Gold loan: interest only, paid about once a year — or earlier, "interest till date".
const gold = { principal: 200000, rate: 9, start_date: '2026-01-01', due_date: '2027-12-31', interest_only: true, closed_on: null, events: [] }
const g = goldSummary(gold, '2026-07-01')
near(g.yearlyInterest, 18000, 0.01, 'gold yearly')
near(g.sinceLast, 200000 * 9 / 36500 * 181, 0.01, 'gold since start')
assert.equal(g.nextInterestOn, '2027-01-01')
assert.equal(g.lastInterestOn, null)
assert.equal(g.state, 'ok')
assert.equal(goldSummary(gold, '2026-12-20').state, 'soon') // interest due in 12 days
assert.equal(goldSummary(gold, '2027-01-05').state, 'overdue') // a year passed, nothing paid
// Paying the interest early restarts the count from that day and the next one is a year later.
const paid = { ...gold, events: [{ id: 'i', type: 'interest', date: '2026-07-01', amount: 8900 }] }
near(interestUntil(gold, '2026-07-01'), 200000 * 9 / 36500 * 181, 0.01, 'interest till date')
const gp = goldSummary(paid, '2026-08-01')
near(gp.sinceLast, 200000 * 9 / 36500 * 31, 0.01, 'built up after paying')
assert.equal(gp.paidInterest, 8900)
assert.equal(gp.lastInterestOn, '2026-07-01')
assert.equal(gp.nextInterestOn, '2027-07-01')
assert.equal(gp.state, 'ok')
assert.equal(goldSummary({ ...gold, due_date: '2026-12-31' }, '2027-01-05').state, 'overdue') // renewal passed
assert.equal(goldSummary({ ...gold, closed_on: '2026-09-01' }, '2026-12-01').state, 'closed')
assert.equal(summaryOf(gold, '2026-07-01').gold, true)

// Missing terms → incomplete, not a crash.
assert.equal(summary({ ...loan, tenure_months: null, emi: null }, '2026-01-01').incomplete, true)
console.log('loan maths ok')
