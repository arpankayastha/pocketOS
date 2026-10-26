import assert from 'node:assert/strict'
import { calendarDays } from './hisabCalendar.js'

const e = (date, amount, category, extra = {}) => ({ occurred_on: date, direction: 'out', amount, category, ...extra })
const entries = [
  e('2026-10-05', 25000, 'Housing', { recurring_item_id: 'r1' }),
  e('2026-10-06', 640, 'Food'),
  e('2026-10-06', 100, 'Fuel'),
  e('2026-10-08', 400, 'Food'),
  { occurred_on: '2026-10-08', direction: 'in', amount: 5000, category: 'Refund' },
  e('2026-10-20', 1600, 'Travel'),
  e('2026-09-28', 90, 'Food'), // an earlier month: it only sets where "no spending" starts counting
]
const { days, quiet, max } = calendarDays({ month: '2026-10', entries, today: '2026-10-20', trackQuiet: true })
assert.equal(days.length, 31)
assert.equal(max, 25000)
const d5 = days[4], d6 = days[5], d8 = days[7]
assert.equal(d5.top, 'Housing'); assert.equal(d5.bill, true); assert.equal(d5.size, 36) // the biggest day gets the biggest bubble
assert.equal(days[19].size, 36) // 1,600 is the typical big day here, so it is full size too: one huge day doesn't shrink the rest
assert.equal(d6.out, 740); assert.equal(d6.top, 'Food'); assert.equal(d6.bill, false)
assert.ok(d6.size > 14 && d6.size < 36)
assert.equal(d8.out, 400); assert.equal(d8.in, 5000) // a day with money received still shows what was spent
assert.equal(days[0].quiet, true)  // 1 Oct: nothing spent, after the first entry (28 Sep)
assert.equal(days[1].quiet, true)
assert.equal(days[20].future, true) // 21 Oct is still ahead of 20 Oct
assert.equal(days[20].quiet, false)
// quiet days to date: 1-4, 7, 9-19 = 4 + 1 + 11 = 16
assert.equal(quiet, 16)
// without tracking, nothing is quiet
assert.equal(calendarDays({ month: '2026-10', entries, today: '2026-10-20' }).quiet, 0)
// a book whose first entry is on 18 Oct counts only from then on
const late = calendarDays({ month: '2026-10', entries: [e('2026-10-18', 50, 'Food')], today: '2026-10-20', trackQuiet: true })
assert.equal(late.quiet, 2) // 19 and 20
assert.equal(calendarDays({ month: '2026-10', entries: [], today: '2026-10-20', trackQuiet: true }).quiet, 0)
console.log('hisab calendar ok')
