import { supabase } from './supabase'

export * from './loanMath'

// ── Data ────────────────────────────────────────────────────────────────────────────────────────────────

export async function loadLoans(householdId) {
  const { data, error } = await supabase.from('loans').select('*').eq('household_id', householdId).order('created_at')
  if (error) throw error
  return data
}

export async function saveLoan({ id, householdId, ...f }) {
  const row = {
    kind: f.kind,
    name: f.name.trim(),
    lender: f.lender?.trim() || null,
    principal: Number(f.principal),
    rate: Number(f.rate) || 0,
    tenure_months: f.interest_only ? null : Number(f.tenure_months) || null,
    emi: f.interest_only ? null : Number(f.emi) > 0 ? Number(f.emi) : null,
    start_date: f.start_date,
    interest_only: !!f.interest_only,
    due_date: f.interest_only ? f.due_date || null : null,
    grams: Number(f.grams) > 0 ? Number(f.grams) : null,
    note: f.note?.trim() || null,
  }
  const q = id ? supabase.from('loans').update(row).eq('id', id) : supabase.from('loans').insert({ ...row, household_id: householdId })
  const { data, error } = await q.select().single()
  if (error) throw error
  return data
}

export async function setLoanEvents(loan, events) {
  const { data, error } = await supabase.from('loans').update({ events }).eq('id', loan.id).select().single()
  if (error) throw error
  return data
}

export async function setLoanClosed(loan, closedOn) {
  const { data, error } = await supabase.from('loans').update({ closed_on: closedOn }).eq('id', loan.id).select().single()
  if (error) throw error
  return data
}

export async function deleteLoan(id) {
  const { error } = await supabase.from('loans').delete().eq('id', id)
  if (error) throw error
}

// ── Property deals (buy / sell) — temporary, with a paper checklist (no files) ─────────────────────────────

export const BUY_PAPERS = ['Sale agreement', 'Stamp duty receipt', 'Registration receipt', 'Loan sanction letter', 'Possession letter', 'Society share certificate']
export const SELL_PAPERS = ['Original title papers', 'Loan closure letter and NOC', 'Sale agreement', 'Tax papers (capital gains)', 'Society NOC']
export const starterChecklist = (kind) => (kind === 'sell' ? SELL_PAPERS : BUY_PAPERS).map((label) => ({ id: crypto.randomUUID(), label, done: false, where: '', note: '' }))

// Deals with what they link to, read live: the occasion book's net spend, the due's balance, the loan.
export async function loadDeals(householdId) {
  const { data: deals, error } = await supabase.from('property_deals').select('*').eq('household_id', householdId).order('created_at')
  if (error) throw error
  const bookIds = deals.map((d) => d.book_id).filter(Boolean)
  const spent = {}
  if (bookIds.length) {
    const { data, error: e } = await supabase.from('hisab_entries').select('book_id, direction, amount').in('book_id', bookIds)
    if (e) throw e
    for (const r of data) spent[r.book_id] = (spent[r.book_id] || 0) + (r.direction === 'out' ? 1 : -1) * Number(r.amount)
  }
  return deals.map((d) => ({ ...d, spent: d.book_id ? spent[d.book_id] || 0 : null }))
}

export async function saveDeal({ id, householdId, ...f }) {
  const row = {
    name: f.name.trim(),
    kind: f.kind,
    price: Number(f.price) > 0 ? Number(f.price) : null,
    book_id: f.book_id || null,
    due_id: f.due_id || null,
    loan_id: f.loan_id || null,
    checklist: f.checklist || [],
    archived: !!f.archived,
  }
  const q = id ? supabase.from('property_deals').update(row).eq('id', id) : supabase.from('property_deals').insert({ ...row, household_id: householdId })
  const { data, error } = await q.select().single()
  if (error) throw error
  return data
}

export async function deleteDeal(id) {
  const { error } = await supabase.from('property_deals').delete().eq('id', id)
  if (error) throw error
}
