import { supabase } from './supabase'
import { monthEnd, monthStart, today as todayIso } from './format'
import { loadCardBills } from './cards'
import { isCard } from './instruments'
import { emiInMonth, loadLoans, matchEmiPayment } from './loans'

// One month of money for a household, shared by Plan and the Dashboard:
// - Plan items with the amount that counts this month: the logged actual, else (card bills) the
//   bill worked out from that card's spends, else the expected amount.
// - "Left to spend" for the month:
//     planned income + Hisab Daily money received − Plan commitments − Hisab Daily spends not on a card
//     − one-off Budget expenses not on a card.
//   Hisab spends linked to a commitment (recurring_item_id) are that commitment's payment, not extra.
//   Loan EMIs (Loans tab) are commitments too, worked out from each loan's schedule for the month their date falls in
//   (no Plan row to keep in step); a logged spend of the same amount that month counts as its payment, not extra.
//   Only the Daily book counts: occasion books (a house, a wedding…) are usually paid from savings and keep
//   their own totals (the user's call). Card spends don't count here; they're in the card's bill, in the
//   month it's due (that bill includes occasion spends on the card — it still has to be paid). Budget entries on
//   a card count nowhere (usually the bill being paid by hand; the bill line already covers it).
export async function loadMonthMoney(householdId, month, accounts) {
  const cards = accounts.filter((a) => isCard(a) && a.statement_day)
  const cardIds = new Set(accounts.filter(isCard).map((a) => a.id))
  const [ri, tx, hz, bills, daily, loans] = await Promise.all([
    supabase.from('recurring_items').select('*').eq('household_id', householdId).eq('active', true).order('created_at'),
    supabase.from('transactions').select('id, kind, amount, occurred_on, account_id, recurring_item_id, transfer_id, note')
      .eq('household_id', householdId).gte('occurred_on', monthStart(month)).lte('occurred_on', monthEnd(month)).limit(5000),
    supabase.from('hisab_entries').select('id, direction, amount, account_id, occurred_on, recurring_item_id, note, category, book_id')
      .eq('household_id', householdId).gte('occurred_on', monthStart(month)).lte('occurred_on', monthEnd(month)).limit(5000),
    loadCardBills(householdId, cards, [month]),
    supabase.from('hisab_books').select('id').eq('household_id', householdId).eq('kind', 'daily'),
    loadLoans(householdId),
  ])
  const err = ri.error || tx.error || hz.error || daily.error
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

  // Loan EMIs due this month. The payment is a logged spend of (almost) the same amount that isn't linked to anything.
  const usedKeys = new Set()
  const matched = { hisab: new Set(), tx: new Set() }
  const hisabCands = (hz.data || []).filter((e) => e.direction === 'out' && !e.recurring_item_id).map((e) => ({ key: `h${e.id}`, amount: e.amount, id: e.id, from: 'hisab', account_id: e.account_id }))
  const txCands = txs.filter((t) => t.kind === 'expense' && !t.recurring_item_id && !t.transfer_id).map((t) => ({ key: `t${t.id}`, amount: t.amount, id: t.id, from: 'tx', account_id: t.account_id }))
  for (const loan of loans) {
    const due = emiInMonth(loan, month)
    if (!due) continue
    const hit = matchEmiPayment(due.emi, [...txCands, ...hisabCands], usedKeys)
    if (hit) { usedKeys.add(hit.key); matched[hit.from].add(hit.id) }
    const amount = hit ? Number(hit.amount) : due.emi
    const onCard = !!hit && hit.from === 'hisab' && cardIds.has(hit.account_id)
    items.push({
      id: `loan:${loan.id}`, name: `${loan.name} EMI`, kind: 'expense', category_id: null, account_id: null, expected_amount: due.emi,
      day_of_month: Number(due.date.slice(8)), active: true, auto_loan: true, loan_id: loan.id, loanDue: due.date,
      actual: hit ? { ...hit, fromHisab: hit.from === 'hisab' } : null, bill: null, amount, onCard, counted: onCard ? 0 : amount,
    })
  }

  const income = items.filter((i) => i.kind === 'income').reduce((s, i) => s + i.counted, 0)
  const commitments = items.filter((i) => i.kind === 'expense').reduce((s, i) => s + i.counted, 0)
  const offCard = (accountId) => !accountId || !cardIds.has(accountId)
  const dailyIds = new Set((daily.data || []).map((b) => b.id))
  const hisabOut = (hz.data || []).filter((e) => e.direction === 'out' && dailyIds.has(e.book_id) && offCard(e.account_id) && !e.recurring_item_id && !matched.hisab.has(e.id))
  const spends = hisabOut.reduce((s, e) => s + Number(e.amount), 0)
  const oneOffRows = txs.filter((t) => t.kind === 'expense' && !t.recurring_item_id && !t.transfer_id && offCard(t.account_id) && !matched.tx.has(t.id))
  const oneOffs = oneOffRows.reduce((s, t) => s + Number(t.amount), 0)
  // Money received into the Daily book (a transfer in, cash in, a refund to the bank) adds to what's
  // left (the user's call). Not received on a card (card credits already reduce that card's bill), and not
  // a Plan income item already counted above (e.g. the salary credit, if an SMS put it in Hisab too).
  const planIncome = new Set(items.filter((i) => i.kind === 'income').map((i) => Number(i.counted)))
  const hisabIn = (hz.data || []).filter((e) => e.direction === 'in' && dailyIds.has(e.book_id) && offCard(e.account_id) && !planIncome.has(Number(e.amount)))
  const received = hisabIn.reduce((s, e) => s + Number(e.amount), 0)
  // Commitments already paid (for "kept this month") and what Daily spends and one-offs took today.
  const paid = items.filter((i) => i.kind === 'expense' && i.actual).reduce((s, i) => s + i.counted, 0)
  const day = todayIso()
  const todaySpent = hisabOut.filter((e) => e.occurred_on === day).reduce((s, e) => s + Number(e.amount), 0)
    + oneOffRows.filter((t) => t.occurred_on === day).reduce((s, t) => s + Number(t.amount), 0)
  // Bank spends by account (for the breakdown).
  const byAccount = {}
  for (const e of hisabOut) byAccount[e.account_id || 'none'] = (byAccount[e.account_id || 'none'] || 0) + Number(e.amount)
  return {
    items, income, received, commitments, paid, spends, oneOffs, todaySpent, byAccount,
    left: income + received - commitments - spends - oneOffs,
  }
}
