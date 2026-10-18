import { useCallback, useEffect, useMemo, useState } from 'react'
import { DonutChart } from './LazyCharts'
import { supabase } from '../lib/supabase'
import { currentMonth, monthEnd, monthLabel, monthStart, money, shiftMonth } from '../lib/format'
import { MonthPicker } from './Transactions'
import { DashboardSkeleton } from './Skeleton'
import { useMonthSwipe } from '../lib/useSwipe'
import { loadMonthMoney } from '../lib/runway'
import { colorFor, iconFor } from '../lib/hisab'
import { dueLabel, dueSoon, docSubtitle, REMIND_DAYS } from '../lib/docs'

// Home, kept to what the family uses (simplified Oct 2026, the user's call): last / this / next month.
//   this month — Left to spend, what's still coming up from Plan, where the Daily Hisab money went;
//   next month — what's planned (income − commitments) and the commitments by day;
//   last month — what was spent and where.
// The detail lives in Plan (commitments, card bills) and Hisab (every spend).
export default function Dashboard({ categories, accounts, activeHouseholdId, docs }) {
  const thisMonth = currentMonth()
  const range = { min: shiftMonth(thisMonth, -1), max: shiftMonth(thisMonth, 1) }
  const [month, setMonth] = useState(thisMonth)
  const [money_, setMoney] = useState({}) // ym → loadMonthMoney result
  const [spends, setSpends] = useState({}) // ym → Daily-book Hisab entries
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!activeHouseholdId) return
    try {
      const months = [range.min, thisMonth, range.max]
      const [mm, books, entries] = await Promise.all([
        Promise.all(months.map((m) => loadMonthMoney(activeHouseholdId, m, accounts))),
        supabase.from('hisab_books').select('id').eq('household_id', activeHouseholdId).eq('kind', 'daily'),
        supabase.from('hisab_entries').select('direction, amount, category, occurred_on, book_id')
          .eq('household_id', activeHouseholdId).gte('occurred_on', monthStart(range.min)).lte('occurred_on', monthEnd(thisMonth)).limit(10000),
      ])
      if (books.error || entries.error) throw books.error || entries.error
      const daily = new Set((books.data || []).map((b) => b.id))
      const byMonth = {}
      for (const e of entries.data || []) if (daily.has(e.book_id)) (byMonth[e.occurred_on.slice(0, 7)] ||= []).push(e)
      setMoney(Object.fromEntries(months.map((m, i) => [m, mm[i]])))
      setSpends(byMonth)
      setError(null)
    } catch (err) { setError(err.message) }
    setLoaded(true)
  }, [activeHouseholdId, range.min, range.max, thisMonth, accounts])

  useEffect(() => { load() }, [load])

  const catById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])
  const m = money_[month]
  const isPlan = month === range.max, isNow = month === thisMonth

  // Plan commitments for the month as Coming-up rows: done (✓) once logged / paid from Hisab, else expected.
  const upcoming = useMemo(() => (m?.items || [])
    .filter((i) => i.amount > 0 || i.auto_card)
    .map((i) => ({ id: i.id, kind: i.kind, amount: i.amount, note: i.name, day: i.day_of_month, category_id: i.category_id, account_id: i.account_id, planned: !i.actual }))
    .sort((a, b) => (a.day || 99) - (b.day || 99)), [m])

  // Where the Daily money went, by Hisab category.
  const breakdown = useMemo(() => {
    const out = (spends[month] || []).filter((e) => e.direction === 'out')
    const by = {}
    for (const e of out) by[e.category || 'Other'] = (by[e.category || 'Other'] || 0) + Number(e.amount)
    const order = Object.keys(by).sort((a, b) => by[b] - by[a])
    return order.map((name) => ({ id: name, key: name, name, value: by[name], color: colorFor(name, order) }))
  }, [spends, month])
  const spent = breakdown.reduce((s, d) => s + d.value, 0)
  const received = (spends[month] || []).filter((e) => e.direction === 'in').reduce((s, e) => s + Number(e.amount), 0)

  // Documents (Docs module) whose expiry / renewal is within 45 days.
  const docsDue = useMemo(() => dueSoon(docs), [docs])

  const swipe = useMonthSwipe(month, setMonth, range)
  if (!loaded) return <DashboardSkeleton />
  return (
    <section {...swipe} className="fade-in">
      <div className="toolbar">
        <MonthPicker month={month} setMonth={setMonth} {...range} />
        <span className="muted small">{isNow ? 'this month' : isPlan ? 'next month · planned' : 'last month'}</span>
      </div>
      {error && <div className="alert error">{error}</div>}

      {isNow && m && (
        <div className="card plan-left">
          <div className="muted small">Left to spend this month</div>
          <div className={`plan-left-num ${m.left < 0 ? 'neg' : 'pos'}`}>{money(m.left)}</div>
          <div className="muted small">Income {money(m.income)}{m.received > 0 ? ` + received ${money(m.received)}` : ''} − plan {money(m.commitments)} − bank &amp; cash spends {money(m.spends + m.oneOffs)}. Card spends count on their bill; occasion books are left out.</div>
        </div>
      )}
      {isPlan && m && (
        <div className="card plan-left">
          <div className="muted small">Planned for {monthLabel(month)}</div>
          <div className={`plan-left-num ${m.income - m.commitments < 0 ? 'neg' : 'pos'}`}>{money(m.income - m.commitments)}</div>
          <div className="muted small">Income {money(m.income)} − commitments {money(m.commitments)} (card bills as they stand today).</div>
        </div>
      )}
      {!isNow && !isPlan && (
        <div className="card plan-left">
          <div className="muted small">Spent in {monthLabel(month)} · Hisab Daily</div>
          <div className="plan-left-num neg">{money(spent)}</div>
          {received > 0 && <div className="muted small">Received {money(received)}</div>}
        </div>
      )}

      {isNow && docsDue.length > 0 && (
        <div className="card">
          <h3>Documents <span className="muted small">next {REMIND_DAYS} days</span></h3>
          <div className="list">
            {docsDue.map(({ doc, days }) => (
              <div className="txn" key={doc.id}>
                <span className="grow">
                  <div className="ellipsis">{doc.title}</div>
                  <div className="muted small ellipsis">{docSubtitle(doc)}</div>
                </span>
                <span className={`small ${days < 0 ? 'neg' : 'warn'}`}>{dueLabel(days)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid2">
        {(isNow || isPlan) && (
          <div className="card"><ComingUp rows={upcoming} month={month} catById={catById} accounts={accounts} /></div>
        )}
        {!isPlan && (
          <div className="card">
            <h3>Where the money went <span className="muted small">{money(spent)}</span></h3>
            {breakdown.length === 0 ? <div className="empty-chart muted" style={{ height: 160 }}>No Daily spends this month.</div> : (
              <div className="pie-wrap">
                <DonutChart data={breakdown} />
                <ul className="legend">
                  {breakdown.slice(0, 6).map((d) => (
                    <li key={d.id}><span className="dot" style={{ background: d.color }} />{iconFor(d.name)} {d.name}<b>{money(d.value)}</b></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

const shortMonth = (ym) => monthLabel(ym).split(' ')[0]

// A month's Plan commitments by day: logged ones (✓) and those still expected.
function ComingUp({ rows, month, catById, accounts }) {
  const accById = Object.fromEntries(accounts.map((a) => [a.id, a]))
  const done = rows.filter((t) => !t.planned)
  const toPay = rows.filter((t) => t.planned && t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const mon = shortMonth(month)
  return (
    <>
      <div className="cu-head">
        <h3>Coming up</h3>
        {rows.length > 0 && <span className="muted small">{done.length} of {rows.length} done</span>}
      </div>
      {rows.length > 0 && (
        <div className="cu-progress">
          <div className="bar"><div className="fill ok" style={{ width: `${(done.length / rows.length) * 100}%` }} /></div>
          <span className="muted small">{toPay ? `${money(toPay)} still to pay` : 'all paid'}</span>
        </div>
      )}
      {rows.length === 0 ? <div className="muted">Nothing planned. Add commitments in the Plan tab.</div> : (
        <div className="cu-list">
          {rows.map((t) => {
            const day = t.day
            const sub = [catById[t.category_id]?.name, accById[t.account_id]?.name].filter(Boolean).join(' · ')
            const income = t.kind === 'income'
            return (
              <div className={`cu-row ${t.planned ? 'planned' : 'done'}`} key={t.id}>
                <div className="cu-date"><b>{day || '—'}</b><span>{mon}</span></div>
                <div className="grow">
                  <div className="cu-name">{t.note?.trim() || catById[t.category_id]?.name || 'Uncategorised'}</div>
                  {sub && <div className="muted small cu-sub">{sub}</div>}
                </div>
                <div className="cu-right">
                  <b className={`amt ${income ? 'pos' : 'neg'}`}>{income ? '+' : '−'}{money(t.amount)}</b>
                  <span className={`cu-status ${t.planned ? '' : 'ok'}`}>{t.planned ? 'Expected' : income ? '✓ Received' : '✓ Paid'}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
