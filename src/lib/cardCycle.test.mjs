// Run: npm run test:cards — card bill cut-off / due date rules.
import assert from 'node:assert/strict'
import { billDue, statementFor, statementDueIn, dueForStatement } from './cardCycle.js'
const c = { statement_day: 15, due_day: 3 }
assert.equal(statementFor(c, '2026-09-10'), '2026-09-15')
assert.equal(statementFor(c, '2026-09-15'), '2026-09-15')       // on the cut-off day: this statement
assert.equal(statementFor(c, '2026-09-16'), '2026-10-15')       // after: next one
assert.equal(billDue(c, '2026-09-10'), '2026-10-03')
assert.equal(billDue(c, '2026-09-20'), '2026-11-03')
assert.equal(billDue(c, '2026-12-20'), '2027-02-03')            // year roll
assert.equal(statementDueIn(c, '2026-10'), '2026-09-15')
// due later in the same month as the statement
const d = { statement_day: 5, due_day: 25 }
assert.equal(billDue(d, '2026-09-04'), '2026-09-25')
assert.equal(billDue(d, '2026-09-06'), '2026-10-25')
assert.equal(statementDueIn(d, '2026-10'), '2026-10-05')
// day 31 / February clamp
const e = { statement_day: 31, due_day: 20 }
assert.equal(statementFor(e, '2026-02-28'), '2026-02-28')
assert.equal(statementFor(e, '2026-02-10'), '2026-02-28')
assert.equal(billDue(e, '2026-02-10'), '2026-03-20')
assert.equal(statementFor(e, '2026-04-30'), '2026-04-30')
// due day 31 in a 30-day month (same-month due)
const f = { statement_day: 10, due_day: 31 }
assert.equal(dueForStatement(f, '2026-04-10'), '2026-04-30')
// no due day → statement + 20 days
assert.equal(dueForStatement({ statement_day: 15 }, '2026-09-15'), '2026-10-05')
console.log('cardCycle: all checks passed')
