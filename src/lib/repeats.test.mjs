import assert from 'node:assert/strict'
import { findRepeats, ordinal } from './repeats.js'

const e = (date, note, amount, extra = {}) => ({ occurred_on: date, direction: 'out', note, amount, category: 'Bills', ...extra })
const today = '2026-10-26'
const entries = [
  // electric bill: 4 months, about the same amount, mid-month
  e('2026-07-16', 'Electric Co', 1790), e('2026-08-16', 'Electric Co', 1840), e('2026-09-17', 'Electric Co', 1910), e('2026-10-16', 'Electric Co', 1840),
  // a streaming plan: exact amount, 12th
  e('2026-08-12', 'streaming plan', 649), e('2026-09-12', 'streaming plan', 649), e('2026-10-12', 'streaming plan', 649),
  // already on the Plan by amount (rent)
  e('2026-08-05', 'Landlord', 25000), e('2026-09-05', 'Landlord', 25000), e('2026-10-05', 'Landlord', 25000),
  // a daily habit: many entries per month, never a bill
  ...['2026-08-03', '2026-08-04', '2026-08-09', '2026-09-03', '2026-09-04', '2026-09-09', '2026-10-03', '2026-10-04', '2026-10-09'].map((d) => e(d, 'Chai stall', 20)),
  // only two months: not yet a repeat
  e('2026-09-20', 'New gym', 1500), e('2026-10-20', 'New gym', 1500),
  // amounts all over the place
  e('2026-08-10', 'Pharmacy', 300), e('2026-09-10', 'Pharmacy', 2800), e('2026-10-10', 'Pharmacy', 640),
  // stopped long ago
  e('2026-04-14', 'Old course', 999), e('2026-05-14', 'Old course', 999), e('2026-06-14', 'Old course', 999),
  // no note, already linked, income
  e('2026-08-02', '', 500), e('2026-09-02', '', 500), e('2026-10-02', '', 500),
  e('2026-08-08', 'SIP', 5000, { recurring_item_id: 'x' }), e('2026-09-08', 'SIP', 5000, { recurring_item_id: 'x' }), e('2026-10-08', 'SIP', 5000, { recurring_item_id: 'x' }),
  { occurred_on: '2026-10-01', direction: 'in', note: 'Salary', amount: 90000 }, { occurred_on: '2026-09-01', direction: 'in', note: 'Salary', amount: 90000 }, { occurred_on: '2026-08-01', direction: 'in', note: 'Salary', amount: 90000 },
]
const plan = [{ name: 'House rent', kind: 'expense', expected_amount: 25000 }]
const r = findRepeats({ entries, planItems: plan, today })
assert.deepEqual(r.map((x) => x.name), ['Electric Co', 'Streaming plan'])
assert.equal(r[0].amount, 1840); assert.equal(r[0].day, 16); assert.equal(r[0].months, 4)
assert.equal(r[1].amount, 649); assert.equal(r[1].day, 12)
assert.equal(r[0].category, 'Bills')
// once it's on the Plan (same name, or the same amount) it is no longer suggested
assert.deepEqual(findRepeats({ entries, planItems: [...plan, { name: 'Electric Co bill', kind: 'expense', expected_amount: 0 }], today }).map((x) => x.name), ['Streaming plan'])
assert.deepEqual(findRepeats({ entries, planItems: [...plan, { name: 'Netflix', kind: 'expense', expected_amount: 650 }], today }).map((x) => x.name), ['Electric Co'])
// hidden by the user
assert.deepEqual(findRepeats({ entries, planItems: plan, today, hidden: ['electric co'] }).map((x) => x.name), ['Streaming plan'])
assert.equal(findRepeats({ entries, planItems: plan, today, limit: 1 }).length, 1)
assert.deepEqual(findRepeats({ entries: [], today }), [])
assert.equal(ordinal(1), '1st'); assert.equal(ordinal(12), '12th'); assert.equal(ordinal(22), '22nd'); assert.equal(ordinal(16), '16th')
console.log('repeats ok')
