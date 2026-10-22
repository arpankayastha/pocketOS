import assert from 'node:assert/strict'
import { parseQuick, groupBySection, historyOf, daysTo, addDaysIso, autoClearIds, repeatIds, taskGroups, rsvpCounts, progress } from './listLogic.js'

assert.deepEqual(parseQuick('milk 2 L'), { name: 'Milk', qty: '2 L' })
assert.deepEqual(parseQuick('onions 2kg'), { name: 'Onions', qty: '2 kg' })
assert.deepEqual(parseQuick('2 kg rice'), { name: 'Rice', qty: '2 kg' })
assert.deepEqual(parseQuick('eggs 12'), { name: 'Eggs', qty: '12' })
assert.deepEqual(parseQuick('  coriander '), { name: 'Coriander', qty: '' })
assert.deepEqual(parseQuick('vitamin b12'), { name: 'Vitamin b12', qty: '' })
assert.deepEqual(parseQuick(''), { name: '', qty: '' })

const it = (name, o = {}) => ({ id: name, name, section: null, done: false, cleared: false, created_at: '2026-01-01', ...o })
const g = groupBySection([it('a', { section: 'Veg' }), it('b', { section: 'Dairy' }), it('c'), it('d', { section: 'Gone' })], ['Veg', 'Dairy', 'Dry'])
assert.deepEqual(g.map((x) => [x.section, x.items.length]), [['Veg', 1], ['Dairy', 1], ['Other', 2]])

const h = historyOf([it('Milk', { created_at: '2026-01-01', qty: '1 L' }), it('milk', { created_at: '2026-02-01', qty: '2 L', done: true }), it('Tea', { created_at: '2026-03-01' })])
assert.equal(h[0].name, 'Milk'); assert.equal(h[0].times, 2); assert.equal(h[0].qty, '2 L'); assert.equal(h[0].onList, true)
assert.equal(h[1].name, 'Tea')

assert.equal(daysTo('2026-11-14', '2026-10-22'), 23)
assert.equal(daysTo('2026-10-20', '2026-10-22'), -2)
assert.equal(daysTo(null, '2026-10-22'), null)
assert.equal(addDaysIso('2026-11-14', -30), '2026-10-15')

const now = Date.parse('2026-10-22T12:00:00Z')
const old = '2026-10-18T12:00:00Z'
assert.deepEqual(autoClearIds([it('x', { done: true, done_at: old }), it('y', { done: true, done_at: '2026-10-22T10:00:00Z' })], 3, now), ['x'])
assert.deepEqual(autoClearIds([it('x', { done: true, done_at: old })], null, now), [])
assert.deepEqual(repeatIds([it('w', { repeat_weekly: true, done: true, done_at: '2026-10-10T00:00:00Z' }), it('v', { repeat_weekly: true, done: true, done_at: old })], now), ['w'])

const tg = taskGroups([it('late', { due_date: '2026-10-20' }), it('soon', { due_date: '2026-10-25' }), it('far', { due_date: '2026-11-30' }), it('nodate'), it('ok', { done: true, due_date: '2026-10-25' })], '2026-10-22')
assert.deepEqual(tg.map((x) => x.label), ['Overdue', 'This week', 'Later', 'No date', 'Done'])

assert.deepEqual(rsvpCounts([{ rsvp: 'yes' }, { rsvp: 'yes' }, { rsvp: 'maybe' }, { rsvp: null }]), { yes: 2, maybe: 1, no: 0, asked: 1 })
assert.deepEqual(progress([{ done: true }, { done: false }]), { done: 1, total: 2 })
console.log('listLogic ok')
