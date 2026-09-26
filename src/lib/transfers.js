import { supabase } from './supabase'

// Between-household transfers. One transfer = two transactions sharing `transfer_id`:
// an expense in the sender household and an income in the receiver, both in each
// household's "Home transfer" category. They count in normal income/expense totals.

// Matches the user's existing category even with typos/spaces ("Home Trasfer ").
const TRANSFER_NAME = /^(home\s*)?tra\w*fers?$/i
export const isTransferCategory = (c) => !!c && TRANSFER_NAME.test(c.name.trim())

async function transferCategoryId(householdId, kind) {
  const { data, error } = await supabase.from('categories').select('id, name').eq('household_id', householdId).eq('kind', kind)
  if (error) throw error
  const found = data.find(isTransferCategory)
  if (found) return found.id
  const { data: created, error: err } = await supabase.from('categories')
    .insert({ household_id: householdId, kind, name: 'Home transfer', color: '#0ea5e9' }).select('id').single()
  if (err) throw err
  return created.id
}

// Loads both halves of a transfer: { sender, receiver } rows.
export async function loadTransfer(transferId) {
  const { data, error } = await supabase.from('transactions').select('*').eq('transfer_id', transferId)
  if (error) throw error
  return { sender: data.find((r) => r.kind === 'expense'), receiver: data.find((r) => r.kind === 'income') }
}

// Creates a transfer (no transferId) or updates both halves of an existing one.
export async function saveTransfer({ transferId, fromHouseholdId, toHouseholdId, fromAccountId, toAccountId, amount, occurredOn, note }) {
  const shared = { amount, occurred_on: occurredOn, note: note || null }
  if (transferId) {
    const [a, b] = await Promise.all([
      supabase.from('transactions').update({ ...shared, account_id: fromAccountId || null }).eq('transfer_id', transferId).eq('kind', 'expense'),
      supabase.from('transactions').update({ ...shared, account_id: toAccountId || null }).eq('transfer_id', transferId).eq('kind', 'income'),
    ])
    if (a.error || b.error) throw a.error || b.error
    return
  }
  const [fromCat, toCat] = await Promise.all([transferCategoryId(fromHouseholdId, 'expense'), transferCategoryId(toHouseholdId, 'income')])
  const id = crypto.randomUUID()
  // One insert request → one statement, so both halves are created or neither is.
  const { error } = await supabase.from('transactions').insert([
    { ...shared, transfer_id: id, kind: 'expense', household_id: fromHouseholdId, category_id: fromCat, account_id: fromAccountId || null },
    { ...shared, transfer_id: id, kind: 'income', household_id: toHouseholdId, category_id: toCat, account_id: toAccountId || null },
  ])
  if (error) throw error
}

export async function deleteTransfer(transferId) {
  const { error } = await supabase.from('transactions').delete().eq('transfer_id', transferId)
  if (error) throw error
}

// For list labels: transfer_id → the other household's id, for rows in `householdId`.
export async function transferCounterparts(transferIds, householdId) {
  if (!transferIds.length) return {}
  const { data, error } = await supabase.from('transactions').select('transfer_id, household_id')
    .in('transfer_id', transferIds).neq('household_id', householdId)
  if (error) throw error
  return Object.fromEntries(data.map((r) => [r.transfer_id, r.household_id]))
}
