import assert from 'node:assert/strict'
import { groupByMonth, highlight, matches, searchEntries, totals } from './hisabSearch.js'

const e = (id, date, amount, category, note, direction = 'out', source = 'UPI') => ({ id, occurred_on: date, amount, category, note, direction, source, created_at: date })
const all = [
  e(1, '2026-10-10', 2800, 'Medical', 'Pharmacy, fever medicine'),
  e(2, '2026-10-26', 320, 'Food', 'Lunch', 'out', 'Cash'),
  e(3, '2026-09-22', 640, 'Medical', 'Pharmacy'),
  e(4, '2026-09-02', 90000, 'Salary', 'Salary', 'in', 'Bank'),
  e(5, '2026-08-30', 1900, 'Medical', 'Medical tests'),
]
const t = { today: '2026-10-26' }
assert.deepEqual(searchEntries(all, { ...t, q: 'med' }).map((x) => x.id), [1, 3, 5])        // category and note both count, newest first
assert.deepEqual(searchEntries(all, { ...t, q: 'MED', range: 'month' }).map((x) => x.id), [1]) // this month only
assert.deepEqual(searchEntries(all, { ...t, q: '', dir: 'in' }).map((x) => x.id), [4])          // received only, no query
assert.deepEqual(searchEntries(all, { ...t, q: 'cash' }).map((x) => x.id), [2])                // the source matches too
assert.deepEqual(searchEntries(all, { ...t, q: '2,800' }).map((x) => x.id), [1])               // an amount, typed with commas
assert.deepEqual(searchEntries(all, { ...t, q: '₹640' }).map((x) => x.id), [3])
assert.deepEqual(searchEntries(all, { ...t, q: '90' }).map((x) => x.id), [])                  // two digits: only an exact amount counts
assert.deepEqual(searchEntries(all, { ...t, q: '900' }).map((x) => x.id), [4])                 // three digits: the start of an amount counts
assert.equal(searchEntries(all, { ...t, q: 'nothing like this' }).length, 0)
assert.equal(matches(all[0], '  '), true)

const g = groupByMonth(searchEntries(all, { ...t, q: 'med' }))
assert.deepEqual(g.map((x) => [x.month, x.spent, x.rows.length]), [['2026-10', 2800, 1], ['2026-09', 640, 1], ['2026-08', 1900, 1]])
assert.deepEqual(totals(searchEntries(all, { ...t, q: '' })), { out: 5660, in: 90000 })
assert.deepEqual(highlight('Pharmacy, fever medicine', 'med'), ['Pharmacy, fever ', 'med', 'icine'])
assert.deepEqual(highlight('Lunch', 'xyz'), ['Lunch', '', ''])
assert.deepEqual(highlight(null, 'a'), ['', '', ''])
console.log('hisab search ok')
