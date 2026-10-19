import assert from 'node:assert/strict'
import { supersededIds } from './quickDevices.js'
const row = (id, hh, name, paired) => ({ id, household_id: hh, name, paired_at: paired })
// Same phone name paired twice in one household: the older row goes.
assert.deepEqual(supersededIds([row('a', 'h1', 'CPH2447', '2026-09-28'), row('b', 'h1', 'CPH2447', '2026-10-03')]), ['a'])
assert.deepEqual(supersededIds([row('b', 'h1', 'CPH2447', '2026-10-03'), row('a', 'h1', 'CPH2447', '2026-09-28')]), ['a'])
// Different household or different name: both stay.
assert.deepEqual(supersededIds([row('a', 'h1', 'CPH2447', '2026-09-28'), row('b', 'h2', 'CPH2447', '2026-10-03')]), [])
assert.deepEqual(supersededIds([row('a', 'h1', 'CPH2447', '2026-09-28'), row('b', 'h1', 'Galaxy S24', '2026-10-03')]), [])
// Three pairings: only the newest stays. An unpaired code row is never touched.
assert.deepEqual(supersededIds([row('a', 'h', 'P', '2026-01-01'), row('b', 'h', 'P', '2026-02-01'), row('c', 'h', 'P', '2026-03-01'), row('x', 'h', null, null)]).sort(), ['a', 'b'])
console.log('quick devices ok')
