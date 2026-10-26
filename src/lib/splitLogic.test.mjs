import assert from 'node:assert/strict'
import { addRow, mergeSameCategory, paise, splitStatus, startRows } from './splitLogic.js'

assert.equal(paise('0.1') + paise('0.2'), paise('0.3'))
const rows = [{ category: 'Groceries', amount: 1600 }, { category: 'Household', amount: 800 }]
assert.deepEqual(splitStatus(2400, rows), { left: 0, placed: 2400, ok: true })
assert.equal(splitStatus(2400, [{ category: 'Groceries', amount: 1600 }, { category: 'Household', amount: 500 }]).left, 300)  // still to place
assert.equal(splitStatus(2400, [{ category: 'Groceries', amount: 1600 }, { category: 'Household', amount: 900 }]).left, -100) // over
assert.equal(splitStatus(2400, [{ category: 'Groceries', amount: 1600 }, { category: 'Household', amount: 800 }, { category: 'Food', amount: '' }]).ok, false) // an empty row is not a split
assert.equal(splitStatus(2400, [{ category: 'Groceries', amount: 2400 }]).ok, false) // one row is not a split
assert.equal(splitStatus(0.3, [{ category: 'A', amount: 0.1 }, { category: 'B', amount: 0.2 }]).ok, true) // decimals add up exactly

assert.deepEqual(startRows(2400, ['Food', 'Groceries', 'Household'], 'Groceries'), [{ category: 'Groceries', amount: 2400 }, { category: 'Food', amount: '' }])
assert.deepEqual(startRows(100, ['Food'], ''), [{ category: 'Food', amount: 100 }, { category: 'Food', amount: '' }])
assert.deepEqual(startRows(100, [], 'x'), [{ category: 'Other', amount: 100 }, { category: 'Other', amount: '' }])

assert.deepEqual(addRow(rows, ['Groceries', 'Household', 'Medical'], 250), [...rows, { category: 'Medical', amount: 250 }])
assert.deepEqual(addRow(rows, ['Groceries', 'Household'], 0)[2], { category: 'Groceries', amount: '' }) // all used: starts again
assert.deepEqual(mergeSameCategory([{ category: 'Food', amount: 100.1 }, { category: 'Fuel', amount: 50 }, { category: 'Food', amount: 0.2 }]), [{ category: 'Food', amount: 100.3 }, { category: 'Fuel', amount: 50 }])
console.log('split logic ok')
