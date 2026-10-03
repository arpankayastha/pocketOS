import { supabase } from './supabase'

// Cards & bank accounts: Budget accounts that carry the last digits bank SMS show (accounts.digits),
// and for credit cards the statement (cut-off) and due days. Hisab entries and SMS captures point at
// them (account_id), so card spends build that card's bill in Plan and bank spends count this month.

export const isCard = (a) => a?.type === 'card'
export const isInstrument = (a) => (a?.digits?.length || 0) > 0

// "ICICI Amazon ••7013"
export const instrumentLabel = (a) => (a.digits?.length ? `${a.name.trim()} ••${a.digits[0]}` : a.name.trim())

// Parse "7013, 1487" → ['7013', '1487'] (digits only, 3–6 long, no repeats).
export function parseDigits(text) {
  return [...new Set(String(text || '').split(/[^0-9]+/).filter((d) => d.length >= 3 && d.length <= 6))]
}

// Bank + digits seen in this household's SMS that no account claims yet.
export async function loadUnlinked(householdId) {
  const { data, error } = await supabase.rpc('unlinked_instruments', { p_household: householdId })
  if (error) throw error
  return data || []
}

// Attach SMS digits to an existing account (or create one). The database then re-links past
// payments with these digits and, for a card with a bill day, adds its Plan line.
export async function attachDigits({ householdId, accountId, name, type, bank, digits, color }) {
  if (accountId) {
    const { data: a, error: e1 } = await supabase.from('accounts').select('digits, bank').eq('id', accountId).single()
    if (e1) throw e1
    const { error } = await supabase.from('accounts')
      .update({ digits: [...new Set([...(a.digits || []), digits])], bank: a.bank || bank }).eq('id', accountId)
    if (error) throw error
    return accountId
  }
  const { data, error } = await supabase.from('accounts')
    .insert({ household_id: householdId, name: name.trim(), type, bank, digits: [digits], color }).select('id').single()
  if (error) throw error
  return data.id
}
