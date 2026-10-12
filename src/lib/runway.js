import { supabase } from './supabase'
import { monthEnd, monthStart } from './format'
import { loadCardBills } from './cards'
import { isCard } from './instruments'

// One month of money for a household, shared by Plan and the Dashboard:
// - Plan items with the amount that counts this month: the logged actual, else (card bills) the
//   bill worked out from that card's spends, else the expected amount.
// - "Left to spend" for the month:
//     planned income + Hisab Daily money received − Plan commitments − Hisab Daily spends not on a card
//     − one-off Budget expenses not on a card.
//   Hisab spends linked to a commitment (recurring_item_id) are that commitment's payment, not extra.
//   Only the Daily book counts: occasion books (a house, a wedding…) are usually paid from savings and keep
//   their own totals (the user's call). Card spends don't count here; they're in the card's bill, in the
//   month it's due (that bill includes occasion spends on the card — it still has to be paid). Budget entries on
//   a card count nowhere (usually the bill being paid by hand; the bill line already covers it).
export async function loadMonthMoney(householdId, month, accounts) {
  const cards = accounts.filter((a) => isCard(a) && a.statement_day)
  const cardIds = new Set(accounts.filter(isCard).map((a) => a.id))
  const [ri, tx, hz, bills, daily] = await Promise.all([
    supabase.from('recurring_items').select('*').eq('household_id', householdId).eq('active', true).order('created_at'),
    supabase.from('transactions').select('id, kind, amount, occurred_on, account_id, recurring_item_id, transfer_id, note')
      .eq('household_id', householdId).gte('occurred_on', monthStart(month)).lte('occurred_on', monthEnd(month)).limit(5000),
    supabase.from('hisab_entries').select('id, direction, amount, account_id, occurred_on, recurring_item_id, note, category, book_id')
      .eq('household_id', householdId).gte('occurred_on', monthStart(month)).lte('occurred_on', monthEnd(month)).limit(5000),
    loadCardBills(householdId, cards, [month]),
    supabase.from('hisab_books').select('id').eq('household_id', householdId).eq('kind', 'daily'),
  ])
  const err = ri.error || tx.error || hz.error || daily.error
  if (err) throw err
  const txs = tx.data || []
  // A commitment's payment: a Budget transaction logged against it, or a Hisab spend linked to it.
  const actuals = Object.fromEntries([
    ...(hz.data || []).filter((e) => e.recurring_item_id).map((e) => [e.recurring_item_id, { ...e, fromHisab: true }]),
    ...txs.filter((t) => t.recurring_item_id).map((t) => [t.recurring_item_id, t]),
  ])
  // Several payments can be claimed against one item in a month (GRANDXGAMER: cash outs for wafers against
  // "Wafers ₹12,000"): add them up. Until the claims reach the expected amount the rest is still expected.
  const claimed = {}
  for (const e of (hz.data || [])) if (e.recurring_item_id && e.direction === 'out') claimed[e.recurring_item_id] = (claimed[e.recurring_item_id] || 0) + Number(e.amount)
  for (const t of txs) if (t.recurring_item_id) claimed[t.recurring_item_id] = (claimed[t.recurring_item_id] || 0) + Number(t.amount)
  const items = (ri.data || []).map((it) => {
    const actual = actuals[it.id]
    const bill = it.auto_card ? bills[it.account_id]?.[month] : null
    const claims = claimed[it.id] || 0
    const parts = (hz.data || []).filter((e) => e.recurring_item_id === it.id).length + txs.filter((t) => t.recurring_item_id === it.id).length
    const amount = actual ? (parts > 1 ? Math.max(claims, Number(it.expected_amount)) : Number(actual.amount)) : bill ? bill.amount : Number(it.expected_amount)
    // Paid with a card (a linked Hisab spend on a card): it's inside that card's bill already.
    const onCard = !!actual?.fromHisab && cardIds.has(actual.account_id)
    return { ...it, actual, bill, amount, onCard, counted: onCard ? 0 : amount, claimed: claims, parts }
  })

  const income = items.filter((i) => i.kind === 'income').reduce((s, i) => s + i.counted, 0)
  const commitments = items.filter((i) => i.kind === 'expense').reduce((s, i) => s + i.counted, 0)
  const offCard = (accountId) => !accountId || !cardIds.has(accountId)
  const dailyIds = new Set((daily.data || []).map((b) => b.id))
  const hisabOut = (hz.data || []).filter((e) => e.direction === 'out' && dailyIds.has(e.book_id) && offCard(e.account_id) && !e.recurring_item_id)
  const spends = hisabOut.reduce((s, e) => s + Number(e.amount), 0)
  const oneOffRows = txs.filter((t) => t.kind === 'expense' && !t.recurring_item_id && !t.transfer_id && offCard(t.account_id))
  const oneOffs = oneOffRows.reduce((s, t) => s + Number(t.amount), 0)
  // Money received into the Daily book (a transfer in, cash in, a refund to the bank) adds to what's
  // left (the user's call). Not received on a card (card credits already reduce that card's bill), and not
  // a Plan income item already counted above (e.g. the salary credit, if an SMS put it in Hisab too).
  const planIncome = new Set(items.filter((i) => i.kind === 'income').map((i) => Number(i.counted)))
  const hisabIn = (hz.data || []).filter((e) => e.direction === 'in' && dailyIds.has(e.book_id) && offCard(e.account_id) && !planIncome.has(Number(e.amount)))
  const received = hisabIn.reduce((s, e) => s + Number(e.amount), 0)
  // Bank spends by account (for the breakdown).
  const byAccount = {}
  for (const e of hisabOut) byAccount[e.account_id || 'none'] = (byAccount[e.account_id || 'none'] || 0) + Number(e.amount)
  return {
    items, income, received, commitments, spends, oneOffs, byAccount,
    left: income + received - commitments - spends - oneOffs,
  }
}
