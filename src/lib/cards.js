import { supabase } from './supabase'
import { monthEnd, monthStart, shiftMonth, today } from './format'
import { dueForStatement, statementDueIn, statementFor } from './cardCycle'

export { billDue, dueForStatement, statementDueIn, statementFor } from './cardCycle'

// Card spends whose bill is due in each of `months`, per card account: Hisab entries paid with the
// card (refunds/credits in Hisab reduce it). Budget entries on a card never count — they're usually the
// bill being paid, not spends (the user's call).
// → { [accountId]: { [ym]: { amount, count, spends: [...], statement, due, open } } }
export async function loadCardBills(householdId, cards, months) {
  const out = {}
  const withDay = cards.filter((c) => c.statement_day)
  if (!withDay.length || !months.length) return out
  const ids = withDay.map((c) => c.id)
  const sorted = [...months].sort()
  const from = monthStart(shiftMonth(sorted[0], -2)), to = monthEnd(sorted[sorted.length - 1])
  const { data, error } = await supabase.from('hisab_entries')
    .select('id, direction, amount, occurred_on, occurred_at, category, note, account_id')
    .eq('household_id', householdId).in('account_id', ids).gte('occurred_on', from).lte('occurred_on', to).limit(5000)
  if (error) throw error
  const spends = (data || []).map((e) => ({ ...e, sign: e.direction === 'in' ? -1 : 1 }))
  const now = today()
  for (const card of withDay) {
    out[card.id] = {}
    for (const ym of months) {
      const statement = statementDueIn(card, ym)
      const mine = statement ? spends.filter((s) => s.account_id === card.id && statementFor(card, s.occurred_on) === statement) : []
      out[card.id][ym] = {
        amount: Math.max(0, mine.reduce((sum, s) => sum + s.sign * Number(s.amount), 0)),
        count: mine.length,
        spends: mine.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)),
        statement, due: statement ? dueForStatement(card, statement) : null,
        open: !!statement && now <= statement,
      }
    }
  }
  return out
}
