import assert from 'node:assert/strict'
import { ACTION_W, clampOffset, restingOffset, settle } from './swipeLogic.js'

const tick = { key: 'tick', full: true }
const edit = { key: 'edit' }, del = { key: 'del' }
const W = 360

// dragging is limited to the buttons plus a little give; a long-swipe action allows more
assert.equal(clampOffset(500, [], [edit, del], W), 0)
assert.equal(clampOffset(-500, [], [edit, del], W), -(2 * ACTION_W + 28))
assert.equal(clampOffset(500, [tick], [], W), W * 0.8)
assert.equal(clampOffset(40, [tick], [edit], W), 40)

// short pull springs back, past 40% of the buttons it stays open
assert.deepEqual(settle({ offset: -20, left: [], right: [edit, del], width: W }), { open: null })
assert.deepEqual(settle({ offset: -90, left: [], right: [edit, del], width: W }), { open: 'right' })
assert.deepEqual(settle({ offset: 20, left: [tick], right: [], width: W }), { open: null })
assert.deepEqual(settle({ offset: 50, left: [tick], right: [], width: W }), { open: 'left' })
// a long swipe fires the `full` action, but only if there is one
assert.deepEqual(settle({ offset: 250, left: [tick], right: [], width: W }), { fire: tick })
assert.deepEqual(settle({ offset: -300, left: [], right: [edit, del], width: W }), { open: 'right' })
// nothing on that side: stays shut
assert.deepEqual(settle({ offset: 120, left: [], right: [edit], width: W }), { open: null })

assert.equal(restingOffset('left', [tick], []), ACTION_W)
assert.equal(restingOffset('right', [], [edit, del]), -2 * ACTION_W)
assert.equal(restingOffset(null, [tick], [edit]), 0)
console.log('swipe logic ok')
