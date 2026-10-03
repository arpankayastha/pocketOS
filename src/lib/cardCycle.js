// Pure date maths for credit-card bills (no imports, so it can be tested with plain node).
// Credit-card bills from spends. A card has a statement (cut-off) day and a due day: spends up to and
// on the statement day go on that statement, later ones on the next; the bill is paid on the first due
// day after its statement. A bill "belongs" to the month its due date falls in, so Plan shows
// September's tap & pay spends under (say) October's "ICICI card bill".

const pad = (n) => String(n).padStart(2, '0')
const daysIn = (y, m) => new Date(y, m, 0).getDate() // m: 1–12
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(Math.min(d, daysIn(y, m)))}`
const nextYm = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1])

// Statement date that a spend on `date` (YYYY-MM-DD) goes on.
export function statementFor(card, date) {
  const [y, m, d] = date.split('-').map(Number)
  const s = card.statement_day
  if (d <= Math.min(s, daysIn(y, m))) return ymd(y, m, s)
  const [ny, nm] = nextYm(y, m)
  return ymd(ny, nm, s)
}

// Due date of a statement: the first due day after it (same month if the due day is later in the
// month, else the next). Without a due day, 20 days after the statement.
export function dueForStatement(card, statement) {
  const [y, m, d] = statement.split('-').map(Number)
  if (!card.due_day) {
    const t = new Date(Date.UTC(y, m - 1, d + 20))
    return t.toISOString().slice(0, 10)
  }
  if (card.due_day > d && card.due_day <= daysIn(y, m)) return ymd(y, m, card.due_day)
  if (card.due_day > d) return ymd(y, m, daysIn(y, m))
  const [ny, nm] = nextYm(y, m)
  return ymd(ny, nm, card.due_day)
}

export const billDue = (card, date) => dueForStatement(card, statementFor(card, date))

// The statement whose bill is due in month `ym`, or null if none falls there.
export function statementDueIn(card, ym) {
  const [y, m] = ym.split('-').map(Number)
  // Candidates: this month's and last month's statements.
  for (const [sy, sm] of [[y, m], m === 1 ? [y - 1, 12] : [y, m - 1]]) {
    const st = ymd(sy, sm, card.statement_day)
    if (dueForStatement(card, st).startsWith(ym)) return st
  }
  return null
}

