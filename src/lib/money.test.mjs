// Run: npm test — the counter's money and time rules (lib/money.js). Made-up customers only.
import assert from 'node:assert/strict'
import {
  priceFor, sessionEnd, pausedMinutes, sessionTotal, sessionPaid, depositBalances, balanceFor, customerKey,
  dayTotals, duesByCustomer, dueOf, dueReason, shareOut, startPayments, endBill, collectSplit,
} from './money.js'

const sum = (a) => Math.round(a.reduce((t, x) => t + x, 0) * 100) / 100
const rates = [
  { kind: 'PC', minutes: 30, price: 50 }, { kind: 'PC', minutes: 60, price: 80 },
  { kind: 'PS', minutes: 30, price: 60 }, { kind: 'PS', minutes: 60, price: 100 },
  { kind: 'PC', minutes: 30, price: 30, happy: true }, { kind: 'PC', minutes: 60, price: 60, happy: true },
]
const S = (o = {}) => ({ gaming_amount: 0, extend_amount: 0, fnb_before: 0, fnb_while: 0, discount: 0, paid_cash: 0, paid_online: 0, paid_deposit: 0, owed: 0, ...o })

// --- Rate card: cheapest mix that covers the time (the owner's old sheet) ---
assert.equal(priceFor(rates, 'PC', 30), 50)
assert.equal(priceFor(rates, 'PC', 60), 80)
assert.equal(priceFor(rates, 'PC', 90), 130)
assert.equal(priceFor(rates, 'PC', 120), 160)
assert.equal(priceFor(rates, 'PS', 60), 100)
assert.equal(priceFor(rates, 'PS', 90), 160)
assert.equal(priceFor(rates, 'PC', 60, true), 60)        // happy hours
assert.equal(priceFor(rates, 'PS', 60, true), 100)       // no happy PS rates here → normal ones
assert.equal(priceFor(rates, 'PC', 0), 0)
assert.equal(priceFor(rates, 'XB', 60), 0)               // no rates for the kind

// --- Time: pause adds to the end, so nobody loses time ---
const t0 = Date.parse('2026-10-17T10:00:00Z')
const run = { started_at: '2026-10-17T10:00:00Z', minutes: 60, paused_minutes: 15 }
assert.equal(sessionEnd(run).toISOString(), '2026-10-17T11:15:00.000Z')
const paused = { ...run, paused_minutes: 0, paused_at: '2026-10-17T10:30:00Z' }
assert.equal(sessionEnd(paused, t0 + 40 * 60_000).toISOString(), '2026-10-17T11:10:00.000Z') // paused 10 min so far
assert.equal(pausedMinutes(paused, t0 + 40 * 60_000), 10)
assert.equal(pausedMinutes({ ...paused, waiting: true }, t0 + 40 * 60_000), 0) // a saved entry isn't "paused"

// --- Bill ---
const bill = S({ gaming_amount: 80, extend_amount: 80, fnb_while: 20, discount: 10, paid_cash: 50, paid_online: 30, paid_deposit: 20, owed: 40 })
assert.equal(sessionTotal(bill), 170)
assert.equal(sessionPaid(bill), 100)
assert.equal(dueOf(bill), 30)

// --- Share out: parts always add up ---
assert.deepEqual(shareOut(200, 3), [66.67, 66.67, 66.66])
assert.equal(sum(shareOut(100, 3)), 100)
assert.equal(sum(shareOut(0, 2)), 0)

// --- Start: one row per timer ---
const two = [{ g: 80, f: 20 }, { g: 80, f: 0 }]
let p = startPayments(two, { pay: 'cash' })
assert.deepEqual(p.map((x) => x.paid_cash), [100, 80])
p = startPayments(two, { pay: 'split', cashPart: 55 })                 // ₹55 cash, rest online
assert.equal(sum(p.map((x) => x.paid_cash)), 55)
assert.equal(sum(p.map((x) => x.paid_online)), 125)
p = startPayments(two, { pay: 'split', cashPart: 999 })                // more cash than the bill → all cash
assert.equal(sum(p.map((x) => x.paid_cash)), 180)
assert.equal(sum(p.map((x) => x.paid_online)), 0)
p = startPayments(two, { pay: 'deposit', fromDep: 150 })               // deposit fills the first timer first
assert.deepEqual(p.map((x) => x.paid_deposit), [100, 50])
p = startPayments(two, { pay: 'due', dueNow: 120 })
assert.deepEqual(p.map((x) => x.owed), [100, 20])
p = startPayments([{ g: 66.67, f: 0 }, { g: 66.67, f: 0 }, { g: 66.66, f: 20 }], { pay: 'booked', booked: 200 })
assert.equal(sum(p.map((x) => x.paid_online)), 200)                    // F&B left to collect at the end
p = startPayments(two, { pay: 'end' })
assert.ok(p.every((x) => x.paid_cash + x.paid_online + x.paid_deposit + x.owed === 0))

// --- End & collect ---
// 17 Oct: 2 h ₹160, first hour paid online ₹80, extend hour put in dues → nothing more to collect at the end.
let e = endBill(S({ gaming_amount: 80, extend_amount: 80, paid_online: 80, owed: 80 }), { mode: 'cash' })
assert.equal(e.due, 0); assert.equal(e.owedBefore, 80)
// Playing from a ₹150 deposit on a ₹160 bill → ₹10 to collect.
e = endBill(S({ gaming_amount: 160 }), { deposit: 150, useDeposit: true, mode: 'online' })
assert.equal(e.fromDep, 150); assert.equal(e.due, 10); assert.equal(e.online, 10)
e = endBill(S({ gaming_amount: 160 }), { deposit: 500, useDeposit: true })   // deposit bigger than the bill
assert.equal(e.fromDep, 160); assert.equal(e.due, 0)
e = endBill(S({ gaming_amount: 160 }), { deposit: 150, useDeposit: false, mode: 'owes' })
assert.equal(e.owed, 160); assert.equal(e.cash + e.online, 0)
e = endBill(S({ gaming_amount: 130 }), { mode: 'split', cashPart: 50 })
assert.equal(e.cash, 50); assert.equal(e.online, 80)
e = endBill(S({ gaming_amount: 130 }), { mode: 'split', cashPart: 500 })      // cash part capped at what's due
assert.equal(e.cash, 130); assert.equal(e.online, 0)
e = endBill(S({ gaming_amount: 80, paid_cash: 100 }), {})                     // overpaid never goes negative
assert.equal(e.due, 0)
e = endBill(S({ gaming_amount: 80 }), { discount: 20 })
assert.equal(e.due, 60)

// --- Collect while playing: dues first ---
let c = collectSplit(S({ gaming_amount: 160, owed: 160 }), 160)          // started on "Due", paid in full later
assert.deepEqual(c, { due: 160, value: 160, fromDues: 160 })
c = collectSplit(S({ gaming_amount: 160, extend_amount: 50, owed: 50 }), 100)
assert.deepEqual(c, { due: 210, value: 100, fromDues: 50 })
c = collectSplit(S({ gaming_amount: 80 }), 500)                           // never more than is due
assert.equal(c.value, 80)

// --- Deposits: balance per customer (mobile, else name), carried until used ---
assert.equal(customerKey('Test One', '+91 98000 00001'), '9800000001')
assert.equal(customerKey('Test One', ''), 'test one')
const deps = [
  { customer_name: 'TEST ONE', customer_phone: '9800000001', kind: 'add', amount: 150 },
  { customer_name: 'TEST ONE', customer_phone: '9800000001', kind: 'use', amount: 80 },
  { customer_name: 'Test Two', customer_phone: null, kind: 'add', amount: 100 },
]
assert.deepEqual(depositBalances(deps).map((r) => [r.name, r.balance]), [['TEST ONE', 70], ['Test Two', 100]])
assert.equal(balanceFor(deps, 'Test One', '98000 00001').balance, 70)
assert.equal(balanceFor(deps, 'test two', '').balance, 100)               // name only
assert.equal(balanceFor([...deps, { customer_name: 'TEST ONE', customer_phone: '9800000001', kind: 'use', amount: 70 }], 'TEST ONE', '9800000001'), undefined)

// --- Dues ---
const dues = [
  { customer_name: 'Test One', customer_phone: '9800000001', owed: 80, note: 'Due: extend 1h ₹80' },
  { customer_name: 'TEST ONE', customer_phone: '9800000001', owed: 30, gaming_amount: 30 },
  { customer_name: 'Test Two', customer_phone: null, owed: 50, fnb_while: 50 },
]
assert.deepEqual(duesByCustomer(dues).map((d) => [d.key, d.total, d.sessions.length]), [['9800000001', 110, 2], ['test two', 50, 1]])
assert.equal(dueReason(dues[0]), 'extend 1h ₹80')
assert.equal(dueReason(dues[1]), 'game')
assert.equal(dueReason({ note: 'Due: game ₹30 · From X’s deposit ₹20 · Due: extend 30 min ₹50' }), 'game ₹30 · extend 30 min ₹50')

// --- One day's money: a deposit counts the day it's paid, not again when it's used ---
const day = new Date('2026-10-17T00:00:00')
const at = (h) => new Date(day.getTime() + h * 3_600_000).toISOString()
const t = dayTotals({
  sessions: [
    S({ started_at: at(13), status: 'closed', minutes: 120, gaming_amount: 80, extend_amount: 80, paid_online: 80, paid_deposit: 80 }),
    S({ started_at: at(14), status: 'closed', minutes: 120, gaming_amount: 160, paid_online: 80, paid_deposit: 70 }),
    S({ started_at: at(15), status: 'running', minutes: 60, gaming_amount: 80, paid_cash: 80, fnb_before: 20 }),
  ],
  cash: [{ kind: 'open', amount: 500 }, { kind: 'out', amount: 120 }, { kind: 'in', amount: 30 }],
  advances: [{ advance_mode: 'online', advance_paid: 100 }],
  deposits: [
    { kind: 'add', amount: 150, mode: 'online', created_at: at(13) },
    { kind: 'use', amount: 80, created_at: at(16) }, { kind: 'use', amount: 70, created_at: at(16) },
    { kind: 'add', amount: 300, mode: 'cash', created_at: at(-5) },          // yesterday: not today's money
  ],
  duesPaid: [{ amount: 10, mode: 'online', created_at: at(16) }, { amount: 60, mode: 'cash', created_at: at(12) }],
}, day)
assert.equal(t.online, 80 + 80 + 100 + 150 + 10)
assert.equal(t.cash, 80 + 60)
assert.equal(t.deposits, 150)
assert.equal(t.duesIn, 70)
assert.equal(t.sessions, 2)
assert.equal(t.minutes, 240)
assert.equal(t.fnb, 20)
assert.equal(t.drawer, 500 + 140 + 30 - 120)

// A deposit returned (₹100 in, ₹50 used, ₹50 back) lowers the balance and is money out that day.
const back = [
  { customer_name: 'Test Three', customer_phone: '9800000003', kind: 'add', amount: 100, mode: 'cash', created_at: at(10) },
  { customer_name: 'Test Three', customer_phone: '9800000003', kind: 'use', amount: 50, created_at: at(11) },
  { customer_name: 'Test Three', customer_phone: '9800000003', kind: 'refund', amount: 50, mode: 'cash', created_at: at(12) },
]
assert.equal(balanceFor(back, 'Test Three', '9800000003'), undefined)        // nothing left
const t2 = dayTotals({ sessions: [], cash: [], advances: [], deposits: back }, day)
assert.equal(t2.cash, 50); assert.equal(t2.deposits, 100); assert.equal(t2.refunds, 50)

console.log('money rules: all good')
