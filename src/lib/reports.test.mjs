import assert from 'node:assert/strict'
import { byKind, byStaff, customerSummary, dailyRows, toCsv } from './reports.js'

const S = (o) => ({ status: 'closed', minutes: 60, gaming_amount: 80, extend_amount: 0, fnb_before: 0, fnb_while: 0, discount: 0, paid_cash: 0, paid_online: 0, paid_deposit: 0, owed: 0, ...o })
const d1 = new Date(2026, 9, 1), d2 = new Date(2026, 9, 2), d3 = new Date(2026, 9, 3)
const at = (d, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString()
const sessions = [
  S({ system_name: 'PC1', customer_name: 'Test One', customer_phone: '9800000001', started_at: at(d1, 12), paid_cash: 80, entered_by: 'A' }),
  S({ system_name: 'PS5', customer_name: 'Test Two (1/2)', started_at: at(d1, 14), gaming_amount: 100, paid_online: 100, entered_by: 'B' }),
  S({ system_name: 'PC2', customer_name: 'Test One', customer_phone: '98000 00001', started_at: at(d2, 15), fnb_before: 20, paid_cash: 50, owed: 50, entered_by: 'A' }),
  S({ system_name: 'PC3', customer_name: 'Walk-in', started_at: at(d2, 16), status: 'cancelled' }),
]
const deposits = [{ customer_name: 'Test One', customer_phone: '9800000001', kind: 'add', amount: 100, mode: 'cash', created_at: at(d2, 10) },
  { customer_name: 'Test One', customer_phone: '9800000001', kind: 'use', amount: 30, created_at: at(d2, 11) }]

// days: money in per day = sessions paid + deposits paid in; totals add up
const { rows, totals } = dailyRows({ sessions: sessions.filter((s) => s.status !== 'cancelled'), cash: [], advances: [], deposits, duesPaid: [] }, d1, d3)
assert.equal(rows.length, 2)
assert.equal(rows[0].cash, 80); assert.equal(rows[0].online, 100); assert.equal(rows[0].sessions, 2)
assert.equal(rows[1].cash, 150); assert.equal(rows[1].deposits, 100); assert.equal(rows[1].owed, 50)
assert.equal(totals.total, 330)

// groups: PC vs PS5, by staff; cancelled sessions skipped
const k = byKind(sessions)
assert.deepEqual(k.map((r) => [r.key, r.sessions, r.bill]), [['PC', 2, 180], ['PS5', 1, 100]])
assert.deepEqual(byStaff(sessions).map((r) => [r.key, r.sessions]), [['A', 2], ['B', 1]])

// customers: same mobile written two ways = one customer; deposit left; dues; walk-ins not listed
const c = customerSummary(sessions, deposits, [sessions[2]])
const one = c.find((r) => r.phone === '9800000001')
assert.equal(one.visits, 2); assert.equal(one.spent, 180); assert.equal(one.deposit, 70); assert.equal(one.dues, 50)
assert.equal(c.find((r) => r.name === 'Test Two').visits, 1)
assert.ok(!c.some((r) => r.key === 'walk-in'))

// CSV: header, quotes, BOM
assert.equal(toCsv([['a', 'Name'], [(r) => r.n * 2, 'Double']], [{ a: 'x, y', n: 2 }]), '﻿Name,Double\n"x, y",4')

console.log('reports: all good')
