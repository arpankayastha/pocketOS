import { supabase } from './supabase'
import { saveTransfer, deleteTransfer } from './transfers'

// Dues: money owed between the active household and a person, both ways.
// An entry's direction is 'out' (money went to the person) or 'in' (came from them);
// balance = Σ out − Σ in, so > 0 means they owe the household and < 0 means it owes them.
// Entries can be mirrored into Budget: a transaction in the "Dues" category, or a
// between-household transfer when the person is one of the user's own households.
// An optional EMI is a recurring_items row with due_id, so it shows in Plan.

export const balanceOf = (entries) => entries.reduce((s, e) => s + (e.direction === 'out' ? 1 : -1) * Number(e.amount), 0)

// A due "started" as a loan taken (first entry in) or a loan given (first entry out);
// that decides the words used for each entry.
export function entryLabel(entry, firstDirection) {
  const borrowedFirst = firstDirection === 'in'
  if (entry.direction === 'in') return borrowedFirst ? 'Borrowed' : 'Received'
  return borrowedFirst ? 'Paid back' : 'Lent'
}

// The two actions offered on a due, most likely first.
export function actionsFor(balance) {
  if (balance < 0) return [{ direction: 'out', label: 'Pay back' }, { direction: 'in', label: 'Borrow more' }]
  if (balance > 0) return [{ direction: 'in', label: 'Received' }, { direction: 'out', label: 'Lend more' }]
  return [{ direction: 'out', label: 'Lend' }, { direction: 'in', label: 'Borrow' }]
}

const DUES_NAME = /^dues?$/i
async function duesCategoryId(householdId, kind) {
  const { data, error } = await supabase.from('categories').select('id, name').eq('household_id', householdId).eq('kind', kind)
  if (error) throw error
  const found = data.find((c) => DUES_NAME.test(c.name.trim()))
  if (found) return found.id
  const { data: created, error: err } = await supabase.from('categories')
    .insert({ household_id: householdId, kind, name: 'Dues', color: '#9085e9' }).select('id').single()
  if (err) throw err
  return created.id
}

// Loads the household's dues with their entries and EMI item: [{ ...due, entries, emi, balance }].
export async function loadDues(householdId) {
  const [d, e, r] = await Promise.all([
    supabase.from('dues').select('*').eq('household_id', householdId).order('created_at'),
    supabase.from('due_entries').select('*').eq('household_id', householdId).order('occurred_on').order('created_at'),
    supabase.from('recurring_items').select('*').eq('household_id', householdId).not('due_id', 'is', null),
  ])
  const err = d.error || e.error || r.error
  if (err) throw err
  return d.data.map((due) => {
    const entries = e.data.filter((x) => x.due_id === due.id)
    return { ...due, entries, emi: r.data.find((x) => x.due_id === due.id) || null, balance: balanceOf(entries) }
  })
}

// Adds an entry to a due, mirroring it into Budget when `toBudget`.
// `recurringItemId` links the Budget row to the EMI commitment (when logged from Plan).
export async function addEntry(due, { direction, amount, occurredOn, note, toBudget, accountId, recurringItemId }) {
  let transactionId = null, transferId = null
  const budgetNote = note ? `${note} · ${due.person}` : `${direction === 'out' ? 'To' : 'From'} ${due.person}`
  if (toBudget && due.person_household_id) {
    const own = { recurring_item_id: recurringItemId || null }
    transferId = await saveTransfer(direction === 'out'
      ? { fromHouseholdId: due.household_id, toHouseholdId: due.person_household_id, fromAccountId: accountId, amount, occurredOn, note: budgetNote, fromExtra: own }
      : { fromHouseholdId: due.person_household_id, toHouseholdId: due.household_id, toAccountId: accountId, amount, occurredOn, note: budgetNote, toExtra: own })
  } else if (toBudget) {
    const kind = direction === 'out' ? 'expense' : 'income'
    const { data, error } = await supabase.from('transactions').insert({
      household_id: due.household_id, kind, amount, occurred_on: occurredOn, note: budgetNote,
      category_id: await duesCategoryId(due.household_id, kind), account_id: accountId || null, recurring_item_id: recurringItemId || null,
    }).select('id').single()
    if (error) throw error
    transactionId = data.id
  }
  const { error } = await supabase.from('due_entries').insert({
    household_id: due.household_id, due_id: due.id, direction, amount, occurred_on: occurredOn, note: note || null,
    transaction_id: transactionId, transfer_id: transferId,
  })
  if (error) {
    // Don't leave a Budget row behind for an entry that failed to save.
    if (transactionId) await supabase.from('transactions').delete().eq('id', transactionId)
    if (transferId) await deleteTransfer(transferId)
    throw error
  }
  await syncEmi(due.id)
}

// Edits amount/date/note of an entry and its Budget mirror.
export async function updateEntry(entry, { amount, occurredOn, note }) {
  const { error } = await supabase.from('due_entries').update({ amount, occurred_on: occurredOn, note: note || null }).eq('id', entry.id)
  if (error) throw error
  if (entry.transaction_id) {
    const patch = { amount, occurred_on: occurredOn, ...(note ? { note } : {}) }
    const { error: err } = await supabase.from('transactions').update(patch).eq('id', entry.transaction_id)
    if (err) throw err
  }
  if (entry.transfer_id) {
    const { error: err } = await supabase.from('transactions').update({ amount, occurred_on: occurredOn, ...(note ? { note } : {}) }).eq('transfer_id', entry.transfer_id)
    if (err) throw err
  }
  await syncEmi(entry.due_id)
}

export async function deleteEntry(entry) {
  if (entry.transaction_id) await supabase.from('transactions').delete().eq('id', entry.transaction_id)
  if (entry.transfer_id) await deleteTransfer(entry.transfer_id)
  const { error } = await supabase.from('due_entries').delete().eq('id', entry.id)
  if (error) throw error
  await syncEmi(entry.due_id)
}

// Creates or edits a due. `opening` (new dues only) is the first entry; `emi` is
// { amount, day } or null to remove it.
export async function saveDue({ id, householdId, person, personHouseholdId, note, opening, emi }) {
  const fields = { person: person.trim(), person_household_id: personHouseholdId || null, note: note || null }
  let due
  if (id) {
    const { data, error } = await supabase.from('dues').update(fields).eq('id', id).select('*').single()
    if (error) throw error
    due = data
  } else {
    const { data, error } = await supabase.from('dues').insert({ ...fields, household_id: householdId }).select('*').single()
    if (error) throw error
    due = data
    if (opening) {
      try { await addEntry(due, opening) } catch (err) { await supabase.from('dues').delete().eq('id', due.id); throw err }
    }
  }
  await saveEmi(due, emi)
  return due
}

async function saveEmi(due, emi) {
  const { data: existing } = await supabase.from('recurring_items').select('id').eq('due_id', due.id).maybeSingle()
  if (!emi) {
    if (existing) await supabase.from('recurring_items').delete().eq('id', existing.id)
    return
  }
  const fields = { name: `EMI · ${due.person}`, expected_amount: emi.amount, day_of_month: emi.day || null }
  const { error } = existing
    ? await supabase.from('recurring_items').update(fields).eq('id', existing.id)
    : await supabase.from('recurring_items').insert({ ...fields, household_id: due.household_id, due_id: due.id, kind: 'expense' })
  if (error) throw error
  await syncEmi(due.id)
}

// Keeps a due's EMI commitment in step with its balance: paying (expense) while the
// household owes, receiving (income) while the person owes, and off once settled.
async function syncEmi(dueId) {
  const [{ data: emi }, { data: entries }] = await Promise.all([
    supabase.from('recurring_items').select('*').eq('due_id', dueId).maybeSingle(),
    supabase.from('due_entries').select('direction, amount').eq('due_id', dueId),
  ])
  if (!emi) return
  const balance = balanceOf(entries || [])
  const kind = balance > 0 ? 'income' : 'expense'
  const category_id = balance !== 0 && (kind !== emi.kind || !emi.category_id) ? await duesCategoryId(emi.household_id, kind) : emi.category_id
  await supabase.from('recurring_items').update({ active: balance !== 0, kind, category_id }).eq('id', emi.id)
}

export async function deleteDue(due) {
  // Entries go with it (on delete cascade); their Budget rows are real money moves and stay.
  const { error } = await supabase.from('dues').delete().eq('id', due.id)
  if (error) throw error
}
