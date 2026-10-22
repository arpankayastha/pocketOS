import { supabase } from './supabase'
import { loadBooks, saveBook } from './hisab'
import { addDaysIso } from './listLogic'

const must = ({ data, error }) => { if (error) throw error; return data }

// Everything the signed-in login may see (RLS: own households' lists + lists shared with the member's household).
export async function loadLists() {
  return must(await supabase.from('lists').select('*').eq('is_template', false).order('created_at'))
}

// Open / ticked counts per list, for the home screen: { listId: { open, done, total } }.
export async function loadCounts() {
  const rows = must(await supabase.from('list_items').select('list_id, tab, done, cleared').eq('cleared', false).limit(20000))
  const out = {}
  for (const r of rows) {
    const c = out[r.list_id] || (out[r.list_id] = { open: 0, done: 0, total: 0 })
    c.total += 1
    if (r.done) c.done += 1; else c.open += 1
  }
  return out
}

export async function loadItems(listId) {
  return must(await supabase.from('list_items').select('*').eq('list_id', listId).order('created_at').limit(5000))
}

export async function createList(householdId, fields) {
  return must(await supabase.from('lists').insert({ household_id: householdId, ...fields }).select('*').single())
}
export async function updateList(id, fields) {
  return must(await supabase.from('lists').update(fields).eq('id', id).select('*').single())
}
export async function deleteList(id) { must(await supabase.from('lists').delete().eq('id', id)) }

export async function addItem(list, fields) {
  return must(await supabase.from('list_items').insert({ list_id: list.id, household_id: list.household_id, ...fields }).select('*').single())
}
export async function updateItem(id, fields) {
  return must(await supabase.from('list_items').update(fields).eq('id', id).select('*').single())
}
export async function deleteItem(id) { must(await supabase.from('list_items').delete().eq('id', id)) }
export async function setDone(id, done) {
  return updateItem(id, { done, done_at: done ? new Date().toISOString() : null })
}
// Ticked items leave the list but stay in the history (cleared, not deleted).
export async function clearTicked(listId, tab) {
  let q = supabase.from('list_items').update({ cleared: true }).eq('list_id', listId).eq('done', true).eq('cleared', false)
  if (tab) q = q.eq('tab', tab)
  must(await q)
}
export async function setCleared(ids, cleared = true) {
  if (ids.length) must(await supabase.from('list_items').update({ cleared }).in('id', ids))
}
export async function resetItems(ids) {
  if (ids.length) must(await supabase.from('list_items').update({ done: false, done_at: null }).in('id', ids))
}

// A new occasion from a starter template (or blank): the list row plus its tasks / samagri / people.
export async function createOccasion(householdId, { name, icon, eventDate, eventTime, place, tabs, shared, template }) {
  const list = await createList(householdId, {
    name, icon, kind: 'occasion', event_date: eventDate || null, event_time: eventTime || null, place: place || null,
    tabs, shared_with: shared, sections: [],
  })
  const base = { list_id: list.id, household_id: householdId }
  const rows = []
  if (template && tabs.includes('tasks')) for (const [n, days] of template.tasks) rows.push({ ...base, tab: 'tasks', name: n, due_date: eventDate ? addDaysIso(eventDate, -days) : null })
  if (template && tabs.includes('samagri')) for (const [section, n, qty] of template.samagri) rows.push({ ...base, tab: 'samagri', name: n, qty: qty || null, section })
  if (template && tabs.includes('people')) for (const [section, n] of template.people) rows.push({ ...base, tab: 'people', name: n, section })
  if (rows.length) must(await supabase.from('list_items').insert(rows))
  return list
}

// "Use again": copies an old list or occasion with its items (ticks cleared, history rows left out).
export async function copyList(source, { name, eventDate }) {
  const items = await loadItems(source.id)
  const shift = source.event_date && eventDate ? Math.round((Date.parse(`${eventDate}T00:00:00Z`) - Date.parse(`${source.event_date}T00:00:00Z`)) / 86400000) : 0
  const list = await createList(source.household_id, {
    name, icon: source.icon, kind: source.kind, sections: source.sections, shared_with: source.shared_with, tabs: source.tabs,
    event_date: eventDate || null, event_time: source.event_time, place: source.place, auto_clear_days: source.auto_clear_days,
  })
  const rows = items.filter((i) => !i.cleared || source.kind === 'list').map((i) => ({
    list_id: list.id, household_id: list.household_id, tab: i.tab, name: i.name, qty: i.qty, note: i.note, section: i.section, assignee: i.assignee,
    due_date: i.due_date && shift ? addDaysIso(i.due_date, shift) : i.due_date, repeat_weekly: i.repeat_weekly,
  }))
  if (rows.length) must(await supabase.from('list_items').insert(rows))
  return list
}

// Money tab: link an occasion to a Hisab occasion book (created here or picked), read live — nothing is copied.
export async function createBookFor(list) {
  const book = await saveBook({ householdId: list.household_id, name: list.name })
  return updateList(list.id, { book_id: book.id })
}
export const loadHouseholdBooks = (householdId) => loadBooks(householdId)

export async function loadHouseholds() {
  return must(await supabase.from('households').select('id, name, color').order('created_at'))
}
