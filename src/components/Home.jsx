import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { currentMonth, monthEnd, monthStart, shiftMonth, today } from '../lib/format'
import { loadMonthMoney } from '../lib/runway'
import { loadDeals, loadLoans, summaryOf } from '../lib/loans'
import { loadDues } from '../lib/dues'
import { householdColor } from '../lib/colors'
import { homeCardsOff } from '../lib/homeCards'
import { dealProgress, greeting, greetingEmoji, greetName, keptInfo, loanJourney, mood, nextBill, pace, peopleSummary, spendByHousehold, togoText, weekItems } from '../lib/homeLogic'
import { MASK, useHideAmounts } from '../lib/hideAmounts'
import { EyeIcon } from '../lib/icons'
import { DashboardSkeleton } from './Skeleton'

// The old Home (month picker, left to spend, Coming up, where the money went) lives on, folded away under
// "See the month's numbers".
const MonthNumbers = lazy(() => import('./Dashboard'))

const rs = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

// Home (redesigned Oct 2026, the user's call: welcoming, not data-centric; progress made rather than amounts owed).
// A greeting, one calm number for the month, and a few cards that only show when they have something to say.
// Which cards show is chosen in Settings → Home cards (this phone only). The + button adds entries, as everywhere.
export default function Home({ categories, accounts, activeHouseholdId, households, setActiveHouseholdId, name, go, ...rest }) {
  const [state, setState] = useState(null)
  const [showNumbers, setShowNumbers] = useState(false)
  const [hide, toggleHide] = useHideAmounts()
  const R = (n) => (hide ? MASK : rs(n)) // every amount on Home goes through this, so the eye can mask them all
  const off = useMemo(() => new Set(homeCardsOff()), [])
  const day = today()
  const thisMonth = currentMonth()

  const load = useCallback(async () => {
    if (!activeHouseholdId) return
    const nextMonth = shiftMonth(thisMonth, 1)
    const safe = (p, fallback) => Promise.resolve(p).catch(() => fallback)
    const ids = households.map((h) => h.id)
    const [month, next, deals, dues, loans, spend, prev] = await Promise.all([
      safe(loadMonthMoney(activeHouseholdId, thisMonth, accounts), null),
      off.has('week') ? null : safe(loadMonthMoney(activeHouseholdId, nextMonth, accounts), null),
      off.has('newhome') ? [] : safe(loadDeals(activeHouseholdId), []),
      off.has('people') && off.has('newhome') ? [] : safe(loadDues(activeHouseholdId), []),
      off.has('loan') ? [] : safe(loadLoans(activeHouseholdId), []),
      ids.length > 1 && !off.has('households') ? safe(householdSpends(ids, thisMonth), null) : null,
      off.has('kept') ? null : safe(loadMonthMoney(activeHouseholdId, shiftMonth(thisMonth, -1), accounts), null),
    ])
    setState({ month, next, deals, dues, loans, spend, prev })
  }, [activeHouseholdId, accounts, households, thisMonth, off])
  useEffect(() => { load() }, [load])

  const view = useMemo(() => {
    if (!state) return null
    const { month, next, deals, dues, loans, spend, prev } = state
    const total = month ? month.income + month.received : 0
    const feel = month ? mood({ left: month.left, total, today: day }) : null
    const week = off.has('week') ? [] : weekItems({ [thisMonth]: month?.items || [], [shiftMonth(thisMonth, 1)]: next?.items || [] }, day, 7)
    const live = deals.filter((d) => !d.archived)
    const dealCards = off.has('newhome') ? [] : live.map((d) => ({ deal: d, p: dealProgress(d, dues.find((x) => x.id === d.due_id)) }))
    const dealDueIds = new Set(live.map((d) => d.due_id).filter(Boolean))
    const journeys = off.has('loan') ? [] : loans.filter((l) => l.kind === 'home' && !l.closed_on).map((l) => ({ loan: l, j: loanJourney(l, summaryOf(l, day), day) })).filter((x) => x.j)
    const people = off.has('people') ? null : peopleSummary(dues, dealDueIds)
    const pc = month ? pace({ left: month.left, total, today: day, spentToday: month.todaySpent || 0 }) : null
    const kept = off.has('kept') ? null : keptInfo(month, prev)
    const bill = month ? nextBill({ [thisMonth]: month.items || [], [shiftMonth(thisMonth, 1)]: next?.items || [] }, day) : null
    return { month, feel, total, week, dealCards, journeys, people, spend, pc, kept, bill }
  }, [state, off, day, thisMonth])

  const swatch = (h) => householdColor(h, households)
  if (!view) return <DashboardSkeleton />
  const { month, feel, week, dealCards, journeys, people, spend, pc, kept, bill } = view
  const weekTotal = week.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.amount, 0)
  const hello = greetName(households.find((h) => h.id === activeHouseholdId)?.name, name)
  const catName = (id) => categories.find((c) => c.id === id)?.name
  const accName = (id) => accounts.find((a) => a.id === id)?.name?.trim()

  return (
    <section className="home fade-in">
      <div className="home-hello">
        <div>
          <div className="home-date">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 className="home-title">{greeting(new Date())}{hello ? `, ${hello}` : ''} {greetingEmoji(new Date())}</h1>
        </div>
        <button type="button" className={`home-eye ${hide ? 'on' : ''}`} onClick={toggleHide} aria-pressed={hide} aria-label={hide ? 'Show amounts' : 'Hide amounts'} title={hide ? 'Show amounts' : 'Hide amounts'}><EyeIcon off={hide} /></button>
      </div>

      {month && feel && pc && (
        <div className="home-hero">
          <div className="home-line">Still yours to spend this month</div>
          <div className="home-numrow">
            <div className="home-num">{R(Math.max(month.left, 0))}</div>
            <span className="home-togo">{togoText(pc.daysLeft)}</span>
          </div>
          {pc.moneyShare !== null && (
            <>
              <div className="home-track marked" role="img" aria-label={`${Math.round(pc.moneyShare * 100)} percent of the month's money is left, with ${Math.round(pc.monthShare * 100)} percent of the month left`}>
                <i style={{ width: `${Math.round(pc.moneyShare * 100)}%` }} />
                <s style={{ left: `${Math.round(pc.monthShare * 100)}%` }} />
              </div>
              <div className="home-split"><span>{Math.round(pc.moneyShare * 100)}% of the money left</span><span>{Math.round(pc.monthShare * 100)}% of the month left</span></div>
            </>
          )}
          <div className="home-mood">{feel.emoji} {feel.text.split(' · ')[0]}{month.left > 0 && pc.daysLeft > 0 ? ` · about ${R(pc.perDay)} a day` : ''}</div>
        </div>
      )}

      {month && pc && month.left > 0 && (
        <div className={`home-two ${bill ? '' : 'one'}`}>
          <div className="home-card">
            <div className="home-sm">Left today</div>
            <div className="home-mid">{R(pc.leftToday)}</div>
            <div className="home-sub">{month.todaySpent > 0 ? `${R(month.todaySpent)} spent so far` : 'A fresh day'}</div>
          </div>
          {bill && (
            <div className="home-card">
              <div className="home-sm">Next bill</div>
              <div className="home-mid2">{bill.auto_loan ? '🏠 ' : bill.auto_card ? '💳 ' : ''}{bill.name}</div>
              <div className="home-sub">{R(bill.amount)} · {bill.days === 0 ? 'today' : bill.days === 1 ? 'tomorrow' : `in ${bill.days} days`}</div>
            </div>
          )}
        </div>
      )}

      {kept && (
        <div className="home-card home-kept">
          <div className="home-hd"><span className="home-ic">✓</span><h3>Kept this month</h3><span className="home-r">so far</span></div>
          <div className="home-keptnum">{R(kept.kept)}</div>
          <div className="home-line">{Math.round(kept.share * 100)}% of this month&apos;s income</div>
          <div className="home-keptbar" role="img" aria-label={`${Math.round(kept.share * 100)} percent of the income kept`}>
            <i style={{ width: `${Math.round(kept.share * 100)}%` }} /><b />
          </div>
          <div className="home-split"><span>Kept {R(kept.kept)}</span><span>Spent {R(kept.spent)} of {R(kept.total)}</span></div>
          {kept.points !== null && kept.points >= 2 && <div className="home-keptnote">{kept.points} points more than last month. Nicely done.</div>}
          {kept.points !== null && kept.points > -2 && kept.points < 2 && <div className="home-keptnote">About the same as last month.</div>}
        </div>
      )}

      {week.length > 0 && (
        <div className="home-card">
          <div className="home-hd"><span className="home-ic">📅</span><h3>This week</h3><span className="home-r">{week.length} {week.length === 1 ? 'thing' : 'things'} coming up</span></div>
          <div className="home-list">
            {week.slice(0, 5).map((r) => {
              const d = new Date(`${r.date}T00:00:00`)
              return (
                <div key={r.id} className="home-it">
                  <div className="home-dt"><small>{d.toLocaleDateString('en-IN', { weekday: 'short' })}</small><b>{d.getDate()}</b></div>
                  <div className="home-g"><b>{r.auto_loan ? '🏠 ' : r.auto_card ? '💳 ' : ''}{r.name}</b>
                    <span>{r.auto_loan ? 'from your loan' : r.auto_card ? 'card bill' : r.kind === 'income' ? 'expected' : catName(r.category_id) || accName(r.account_id) || 'planned'}</span></div>
                  <div className={`home-a ${r.kind === 'income' ? 'pos' : ''}`}>{r.kind === 'income' ? '+' : ''}{R(r.amount)}</div>
                </div>
              )
            })}
          </div>
          {weekTotal > 0 && <div className="home-foot"><span>In total</span><b>{R(weekTotal)}</b></div>}
        </div>
      )}

      {dealCards.map(({ deal, p }) => (
        <button key={deal.id} type="button" className="home-card home-tap" onClick={() => go('deals')}>
          <div className="home-hd"><span className="home-ic">🏠</span><h3>{deal.name}</h3><span className="home-r">{p.sell ? 'selling' : 'buying'}</span></div>
          {p.paid > 0 || p.hasDue ? (
            <div className="home-big">{R(p.paid)} <small>{p.sell ? 'received from the buyer so far' : 'paid to the builder so far'}</small></div>
          ) : (
            <div className="home-big"><small>Getting started 🌱</small></div>
          )}
          {p.pct !== null && <div className="home-track pos"><i style={{ width: `${Math.round(p.pct * 100)}%` }} /></div>}
          <div className="home-sub">
            {p.pct !== null ? `${Math.round(p.pct * 100)}% of the price is done` : p.total > 0 ? '' : deal.price ? `Price ${R(deal.price)}` : ''}
            {p.count > 0 ? `${p.pct !== null || deal.price ? ' · ' : ''}${p.done === p.count ? 'All papers in hand ✓' : `Papers: ${p.done} of ${p.count} in hand${p.next ? ` · next: ${p.next}` : ''}`}` : ''}
          </div>
        </button>
      ))}

      {journeys.map(({ loan, j }) => (
        <button key={loan.id} type="button" className="home-card home-tap" onClick={() => go('loans')}>
          <div className="home-hd"><span className="home-ic">🏦</span><h3>{loan.name} journey</h3><span className="home-r">{[loan.lender, `${loan.rate}%`].filter(Boolean).join(' · ')}</span></div>
          {j.begins ? (
            <div className="home-big"><small>Begins {shortDate(j.beginsOn)}</small></div>
          ) : (
            <div className="home-big">{j.justBegun ? 'Just begun' : `${j.pct}%`} <small>{j.justBegun ? '' : 'done'}{j.paid > 0 ? `${j.justBegun ? '' : ' · '}${R(j.paid)} paid so far` : ''}</small></div>
          )}
          {!j.begins && <div className="home-track"><i style={{ width: `${Math.max(j.pct, 1)}%` }} /></div>}
          <div className="home-sub">{j.nextDate ? `${j.begins ? 'First' : 'Next'} EMI ${R(j.nextAmount)} on ${shortDate(j.nextDate)}` : ''}{j.nextDate && !j.begins ? ' · one step closer each month' : ''}</div>
        </button>
      ))}

      {spend && households.length > 1 && (
        <div className="home-card">
          <div className="home-hd"><span className="home-ic">👪</span><h3>Households this month</h3><span className="home-r">spent</span></div>
          <div className="home-list">
            {households.map((h) => (
              <button key={h.id} type="button" className={`home-hh ${h.id === activeHouseholdId ? 'on' : ''}`} onClick={() => setActiveHouseholdId(h.id)}>
                <span className="home-av" style={{ background: swatch(h) }}>{h.name.trim().slice(0, 1).toUpperCase()}</span>
                <span className="home-n">{h.name}</span><span className="home-v">{R(spend[h.id] || 0)}</span><span className="home-ch">›</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {people && people.open > 0 && (
        <button type="button" className="home-card home-tap" onClick={() => go('dues')}>
          <div className="home-hd"><span className="home-ic">🤝</span><h3>With family &amp; friends</h3><span className="home-r">{people.open} open</span></div>
          <div className="home-pair">
            <div><small>Lent, coming back</small><b>{people.lent > 0 ? R(people.lent) : '—'}</b></div>
            <div><small>Being settled</small><b>{people.settling > 0 ? R(people.settling) : '—'}</b></div>
          </div>
        </button>
      )}

      {!hide && <button type="button" className="home-more" aria-expanded={showNumbers} onClick={() => setShowNumbers((v) => !v)}>
        <span>{showNumbers ? 'Hide' : 'See'} the month&apos;s numbers</span><span>{showNumbers ? '⌃' : '›'}</span>
      </button>}
      {!hide && showNumbers && (
        <Suspense fallback={<DashboardSkeleton />}>
          <MonthNumbers categories={categories} accounts={accounts} activeHouseholdId={activeHouseholdId} {...rest} />
        </Suspense>
      )}
    </section>
  )
}

// What each household spent from its Daily Hisab book this month: { householdId: total }.
async function householdSpends(ids, month) {
  const [books, entries] = await Promise.all([
    supabase.from('hisab_books').select('id').in('household_id', ids).eq('kind', 'daily'),
    supabase.from('hisab_entries').select('household_id, direction, amount, book_id').in('household_id', ids).eq('direction', 'out')
      .gte('occurred_on', monthStart(month)).lte('occurred_on', monthEnd(month)).limit(20000),
  ])
  if (books.error || entries.error) throw books.error || entries.error
  return spendByHousehold(entries.data || [], new Set((books.data || []).map((b) => b.id)))
}

