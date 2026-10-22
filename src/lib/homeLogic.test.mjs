import assert from 'node:assert/strict'
import { greeting, greetingEmoji, firstName, addDays, mood, dueDateOf, weekItems, dealProgress, loanJourney, spendByHousehold, peopleSummary } from './homeLogic.js'

for (const [h, want] of [[0, 'Good night'], [1, 'Good night'], [4, 'Good night'], [5, 'Good morning'], [8, 'Good morning'], [11, 'Good morning'], [12, 'Good afternoon'], [16, 'Good afternoon'], [17, 'Good evening'], [20, 'Good evening'], [21, 'Good night'], [23, 'Good night']]) {
  assert.equal(greeting(new Date(2026, 9, 22, h)), want, `hour ${h}`)
}
assert.equal(greetingEmoji(new Date(2026, 9, 22, 1)), '🌙')
assert.equal(greetingEmoji(new Date(2026, 9, 22, 9)), '🙏')
assert.equal(greeting(new Date(2026, 9, 22, 14)), 'Good afternoon')
assert.equal(greeting(new Date(2026, 9, 22, 20)), 'Good evening')
assert.equal(firstName('arpan@alchemytech.ca'), 'Arpan')
assert.equal(firstName('pinu'), 'Pinu')
assert.equal(firstName('first.last@x.com'), 'First')
assert.equal(firstName(''), '')
assert.equal(addDays('2026-10-28', 7), '2026-11-04')
assert.equal(addDays('2026-12-30', 3), '2027-01-02')

// Mood: gentle, never harsh.
assert.match(mood({ left: 70000, total: 100000, today: '2026-10-22' }).text, /comfortable.*9 days to go/)
assert.equal(mood({ left: 70000, total: 100000, today: '2026-10-22' }).share, 0.7)
assert.match(mood({ left: 30000, total: 100000, today: '2026-10-10' }).text, /tight|steadily/)
assert.match(mood({ left: -500, total: 100000, today: '2026-10-22' }).text, /little care/)
assert.equal(mood({ left: 0, total: 0, today: '2026-10-22' }).share, null)
assert.match(mood({ left: 5000, total: 100000, today: '2026-10-31' }).text, /last day/)
for (const t of ['2026-10-05', '2026-10-15', '2026-10-30']) assert.ok(!/owe|debt|overdue/i.test(mood({ left: 1000, total: 100000, today: t }).text))

// Due dates and "this week".
assert.equal(dueDateOf({ day_of_month: 31 }, '2026-11'), '2026-11-30') // clamped
assert.equal(dueDateOf({ auto_loan: true, loanDue: '2026-11-05' }, '2026-11'), '2026-11-05')
assert.equal(dueDateOf({ auto_card: true, bill: { due: '2026-10-24' } }, '2026-10'), '2026-10-24')
assert.equal(dueDateOf({ name: 'x' }, '2026-10'), null)
const items = {
  '2026-10': [
    { id: 'a', name: 'SIP', kind: 'expense', amount: 5000, day_of_month: 28 },
    { id: 'b', name: 'Card', kind: 'expense', amount: 12400, auto_card: true, bill: { due: '2026-10-24' } },
    { id: 'c', name: 'Paid already', kind: 'expense', amount: 900, day_of_month: 23, actual: { id: 'x' } },
    { id: 'd', name: 'Later', kind: 'expense', amount: 700, day_of_month: 30 },
    { id: 'e', name: 'Past', kind: 'expense', amount: 600, day_of_month: 20 },
  ],
  '2026-11': [{ id: 'f', name: 'EMI', kind: 'expense', amount: 47064, auto_loan: true, loanDue: '2026-11-02' }],
}
const week = weekItems(items, '2026-10-22', 7)
assert.deepEqual(week.map((r) => r.name), ['Card', 'SIP']) // sorted, unpaid, in range
assert.deepEqual(weekItems(items, '2026-10-29', 7).map((r) => r.name), ['Later', 'EMI']) // crosses into next month

// A deal as progress.
const deal = { kind: 'buy', price: 8500000, checklist: [{ label: 'Agreement', done: true }, { label: 'Registration', done: false }, { label: 'Possession', done: false }] }
const due = { entries: [{ direction: 'in', amount: 8500000 }, { direction: 'out', amount: 1500000 }] }
const p = dealProgress(deal, due)
assert.equal(p.paid, 1500000); assert.ok(Math.abs(p.pct - 1500000 / 8500000) < 1e-9); assert.equal(p.done, 1); assert.equal(p.count, 3); assert.equal(p.next, 'Registration')
assert.equal(dealProgress({ ...deal, price: null }, due).total, 8500000) // falls back to what was opened on the due
assert.equal(dealProgress(deal, null).paid, 0)
assert.equal(dealProgress({ ...deal, kind: 'sell' }, { entries: [{ direction: 'in', amount: 200000 }, { direction: 'out', amount: 1000000 }] }).paid, 200000)

// A loan as a journey.
const loan = { start_date: '2026-12-05' }
const before = loanJourney(loan, { progress: 0, paidPrincipal: 0, nextDate: '2027-01-05', emi: 47064, monthsLeft: 324 }, '2026-10-22')
assert.equal(before.begins, true); assert.equal(before.nextAmount, 47064); assert.equal(before.years, 27)
const going = loanJourney({ start_date: '2025-01-05' }, { progress: 0.0213, paidPrincipal: 130000, nextDate: '2026-11-05', emi: 47064, monthsLeft: 300 }, '2026-10-22')
assert.equal(going.pct, 2); assert.equal(going.begins, false); assert.equal(going.justBegun, false)
assert.equal(loanJourney({ start_date: '2025-01-05' }, { progress: 0.002, paidPrincipal: 9000, emi: 1, monthsLeft: 10 }, '2026-10-22').justBegun, true)
assert.equal(loanJourney(loan, { gold: true }, '2026-10-22'), null)

// Households and people.
assert.deepEqual(spendByHousehold([{ household_id: 'h1', direction: 'out', amount: 100, book_id: 'b1' }, { household_id: 'h1', direction: 'out', amount: 50, book_id: 'occ' }, { household_id: 'h2', direction: 'in', amount: 9, book_id: 'b2' }, { household_id: 'h2', direction: 'out', amount: 7, book_id: 'b2' }], new Set(['b1', 'b2'])), { h1: 100, h2: 7 })
assert.deepEqual(peopleSummary([{ id: 1, balance: 2700 }, { id: 2, balance: -120000 }, { id: 3, balance: -7000000 }, { id: 4, balance: 0 }], new Set([3])), { lent: 2700, settling: 120000, open: 2 })
console.log('home logic ok')
