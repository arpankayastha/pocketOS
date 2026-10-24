import assert from 'node:assert/strict'
import { listShareText, occasionShareText, noteShareText } from './listShare.js'

const list = { name: 'Groceries', icon: '🛒', sections: ['Vegetables', 'Dairy'] }
const items = [
  { id: 1, name: 'Onions', qty: '2 kg', section: 'Vegetables', done: false },
  { id: 2, name: 'Milk', qty: '2 L', section: 'Dairy', done: false },
  { id: 3, name: 'Soap', section: null, done: false },
  { id: 4, name: 'Bread', section: 'Dairy', done: true },
  { id: 5, name: 'Old thing', done: true, cleared: true },
]
assert.equal(listShareText(list, items), [
  '*Groceries* 🛒', '_3 to get_', '', '*Vegetables*', '☐ Onions — 2 kg', '', '*Dairy*', '☐ Milk — 2 L', '', '*Other*', '☐ Soap', '', '*✓ Got it*', '✓ Bread',
].join('\n'))

const occ = { name: 'Griha pravesh', icon: '🏠', event_date: '2026-12-12', event_time: '07:00', place: 'New flat' }
const oi = [
  { tab: 'tasks', name: 'Book pandit', due_date: '2026-12-01', assignee: 'Asha', done: false },
  { tab: 'tasks', name: 'Send invites', due_date: null, done: false },
  { tab: 'tasks', name: 'Buy flowers', done: true },
  { tab: 'samagri', name: 'Ghee', qty: '500 g', section: 'Puja', assignee: 'Ravi', done: false },
  { tab: 'people', name: 'Uncle', section: 'Family', rsvp: 'yes' },
  { tab: 'people', name: 'Neighbour', section: 'Friends', rsvp: null },
]
const t = occasionShareText(occ, oi, { today: '2026-11-20' })
assert.ok(t.startsWith('*Griha pravesh* 🏠\n📅 '))
assert.ok(t.includes('📍 New flat'))
assert.ok(t.includes('☐ Book pandit — 1 Dec (Asha)'))
assert.ok(t.includes('☐ Send invites'))
assert.ok(t.includes('✓ 1 done'))
assert.ok(t.includes('☐ Ghee — 500 g (Ravi)'))
assert.ok(t.includes('*People* — 1 coming'))
assert.ok(t.includes('• Uncle — ✓ coming') && t.includes('• Neighbour'))
// only the parts asked for
const only = occasionShareText(occ, oi, { today: '2026-11-20', parts: ['tasks'] })
assert.ok(only.includes('*Tasks*') && !only.includes('*Samagri*') && !only.includes('*People*'))

assert.equal(noteShareText('Wifi', '  line one\nline two \n'), '*Wifi*\n\nline one\nline two')
console.log('list share ok')
