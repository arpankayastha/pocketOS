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

// ===== Occasion templates (editable): saved as lists with is_template = true, one row per task / samagri / person.
// A task's "days before the event" lives in its qty. Until the owner customises, the built-in ones in listTemplates.js are used.
export function templateShape(row, items) {
  const mine = items.filter((i) => i.list_id === row.id)
  return {
    id: row.id, name: row.name, icon: row.icon, saved: true,
    tasks: mine.filter((i) => i.tab === 'tasks').map((i) => [i.name, Number(i.qty) || 0]),
    samagri: mine.filter((i) => i.tab === 'samagri').map((i) => [i.section || 'Other', i.name, i.qty || '']),
    people: mine.filter((i) => i.tab === 'people').map((i) => [i.section || 'Family', i.name]),
  }
}
export async function loadTemplates() {
  const rows = must(await supabase.from('lists').select('*').eq('is_template', true).order('created_at'))
  if (!rows.length) return []
  const items = must(await supabase.from('list_items').select('*').in('list_id', rows.map((r) => r.id)).order('created_at').limit(5000))
  return rows.map((r) => templateShape(r, items))
}
export async function saveTemplate(householdId, tpl) {
  let id = tpl.id
  if (id) {
    must(await supabase.from('lists').update({ name: tpl.name, icon: tpl.icon }).eq('id', id))
    must(await supabase.from('list_items').delete().eq('list_id', id))
  } else {
    id = must(await supabase.from('lists').insert({ household_id: householdId, name: tpl.name, icon: tpl.icon, kind: 'occasion', is_template: true, tabs: ['tasks', 'samagri', 'people'] }).select('id').single()).id
  }
  const base = { list_id: id, household_id: householdId }
  const rows = [
    ...tpl.tasks.filter((t) => t[0].trim()).map(([n, d]) => ({ ...base, tab: 'tasks', name: n.trim(), qty: String(Number(d) || 0) })),
    ...tpl.samagri.filter((t) => t[1].trim()).map(([s, n, q]) => ({ ...base, tab: 'samagri', name: n.trim(), section: s.trim() || 'Other', qty: q || null })),
    ...tpl.people.filter((t) => t[1].trim()).map(([s, n]) => ({ ...base, tab: 'people', name: n.trim(), section: s.trim() || 'Family' })),
  ]
  if (rows.length) must(await supabase.from('list_items').insert(rows))
  return id
}
export const deleteTemplate = (id) => deleteList(id)
// First customise: copy the built-in starters in, so they can be edited like any other.
export async function seedTemplates(householdId, builtIns) {
  for (const t of builtIns) if (t.name) await saveTemplate(householdId, { name: t.name, icon: t.icon, tasks: t.tasks, samagri: t.samagri, people: t.people })
}
// "Save as template" from an occasion: its items with ticks cleared; due dates become days before the event.
export async function templateFromList(list) {
  const items = (await loadItems(list.id)).filter((i) => !i.cleared)
  const day = (iso) => Math.round((Date.parse(`${list.event_date}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86400000)
  return saveTemplate(list.household_id, {
    name: `${list.name} (template)`, icon: list.icon,
    tasks: items.filter((i) => i.tab === 'tasks').map((i) => [i.name, list.event_date && i.due_date ? Math.max(day(i.due_date), 0) : 0]),
    samagri: items.filter((i) => i.tab === 'samagri').map((i) => [i.section || 'Other', i.name, i.qty || '']),
    people: items.filter((i) => i.tab === 'people').map((i) => [i.section || 'Family', i.name]),
  })
}
