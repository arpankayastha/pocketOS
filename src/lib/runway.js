import { supabase } from './supabase'
import { monthEnd, monthStart } from './format'
import { loadCardBills } from './cards'
import { isCard } from './instruments'

// One month of money for a household, shared by Plan and the Dashboard:
// - Plan items with the amount that counts this month: the logged actual, else (card bills) the
//   bill worked out from that card's spends, else the expected amount.
// - "Left to spend" for the month:
//     planned income − Plan commitments − Hisab spends not on a card − one-off Budget expenses not on a card.
//   Hisab spends linked to a commitment (recurring_item_id) are that commitment's payment, not extra.
//   Card spends don't count here; they're in the card's bill, in the month it's due. Budget entries on
//   a card count nowhere (usually the bill being paid by hand; the bill line already covers it).
export async function loadMonthMoney(householdId, month, accounts) {
  const cards = accounts.filter((a) => isCard(a) && a.statement_day)
  const cardIds = new Set(accounts.filter(isCard).map((a) => a.id))
  const [ri, tx, hz, bills] = await Promise.all([
    supabase.from('recurring_items').select('*').eq('household_id', householdId).eq('active', true).order('created_at'),
    supabase.from('transactions').select('id, kind, amount, occurred_on, account_id, recurring_item_id, transfer_id, note')
      .eq('household_id', householdId).gte('occurred_on', monthStart(month)).lte('occurred_on', monthEnd(month)).limit(5000),
    supabase.from('hisab_entries').select('id, direction, amount, account_id, occurred_on, recurring_item_id, note, category')
      .eq('household_id', householdId).gte('occurred_on', monthStart(month)).lte('occurred_on', monthEnd(month)).limit(5000),
    loadCardBills(householdId, cards, [month]),
  ])
  const err = ri.error || tx.error || hz.error
  if (err) throw err
  const txs = tx.data || []
  // A commitment's payment: a Budget transaction logged against it, or a Hisab spend linked to it.
  const actuals = Object.fromEntries([
    ...(hz.data || []).filter((e) => e.recurring_item_id).map((e) => [e.recurring_item_id, { ...e, fromHisab: true }]),
    ...txs.filter((t) => t.recurring_item_id).map((t) => [t.recurring_item_id, t]),
  ])
  const items = (ri.data || []).map((it) => {
    const actual = actuals[it.id]
    const bill = it.auto_card ? bills[it.account_id]?.[month] : null
    const amount = actual ? Number(actual.amount) : bill ? bill.amount : Number(it.expected_amount)
    // Paid with a card (a linked Hisab spend on a card): it's inside that card's bill already.
    const onCard = !!actual?.fromHisab && cardIds.has(actual.account_id)
    return { ...it, actual, bill, amount, onCard, counted: onCard ? 0 : amount }
  })

  const income = items.filter((i) => i.kind === 'income').reduce((s, i) => s + i.counted, 0)
  const commitments = items.filter((i) => i.kind === 'expense').reduce((s, i) => s + i.counted, 0)
  const offCard = (accountId) => !accountId || !cardIds.has(accountId)
  const hisabOut = (hz.data || []).filter((e) => e.direction === 'out' && offCard(e.account_id) && !e.recurring_item_id)
  const spends = hisabOut.reduce((s, e) => s + Number(e.amount), 0)
  const oneOffRows = txs.filter((t) => t.kind === 'expense' && !t.recurring_item_id && !t.transfer_id && offCard(t.account_id))
  const oneOffs = oneOffRows.reduce((s, t) => s + Number(t.amount), 0)
  // Bank spends by account (for the breakdown).
  const byAccount = {}
  for (const e of hisabOut) byAccount[e.account_id || 'none'] = (byAccount[e.account_id || 'none'] || 0) + Number(e.amount)
  return {
    items, income, commitments, spends, oneOffs, byAccount,
    left: income - commitments - spends - oneOffs,
  }
}
