import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { money, monthLabel, today } from '../lib/format'
import { iconFor } from '../lib/hisab'
import { groupByMonth, highlight, searchEntries, totals } from '../lib/hisabSearch'

// Find any Hisab entry of this household (Daily and occasion books) by note, category, source or amount.
// Tapping a result opens that entry in its own book. Nothing is saved here.
const SHOW = 150

export default function HisabSearch({ householdId, books, onPick, onClose }) {
  const [all, setAll] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [range, setRange] = useState('all')
  const [dir, setDir] = useState('both')

  useEffect(() => {
    let alive = true
    supabase.from('hisab_entries').select('id, book_id, direction, amount, occurred_on, category, source, note, created_at').eq('household_id', householdId)
      .order('occurred_on', { ascending: false }).limit(5000)
      .then(({ data, error: err }) => { if (!alive) return; if (err) setError(err.message); else setAll(data) })
    return () => { alive = false }
  }, [householdId])

  const rows = useMemo(() => (all ? searchEntries(all, { q, range, dir, today: today() }) : []), [all, q, range, dir])
  const shown = useMemo(() => groupByMonth(rows.slice(0, SHOW)), [rows])
  const t = useMemo(() => totals(rows), [rows])
  const bookName = (id) => { const b = books?.find((x) => x.id === id); return b && b.kind !== 'daily' ? b.name : null }
  const chip = (on, label, set) => <button type="button" className={`chip chip-btn ${on ? 'on' : ''}`} onClick={set}>{label}</button>

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal sheet hb-search" role="dialog" aria-label="Search Hisab">
        <div className="hb-search-head">
          <h3 style={{ margin: 0 }}>Search Hisab</h3>
          <button type="button" className="btn small ghost" onClick={onClose}>Close</button>
        </div>
        <input className="hb-search-input" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Note, category or amount" aria-label="Search note, category or amount" enterKeyHint="search" />
        <div className="hb-search-chips">
          {chip(range === 'all', 'All time', () => setRange('all'))}
          {chip(range === 'month', 'This month', () => setRange('month'))}
          {chip(dir === 'both', 'Spent and received', () => setDir('both'))}
          {chip(dir === 'out', 'Spent', () => setDir('out'))}
          {chip(dir === 'in', 'Received', () => setDir('in'))}
        </div>
        {error && <div className="alert error">{error}</div>}
        {!all && !error ? <div className="muted small pad">Loading…</div> : (
          <>
            <div className="hb-search-sum">
              <span><b>{rows.length}</b> <span className="muted">{rows.length === 1 ? 'entry' : 'entries'}</span></span>
              <span className="mono">{t.out > 0 && <b className="neg">−{money(t.out)}</b>}{t.out > 0 && t.in > 0 && ' '}{t.in > 0 && <b className="pos">+{money(t.in)}</b>}</span>
            </div>
            <div className="hb-search-list">
              {shown.map((g) => (
                <div key={g.month}>
                  <div className="hb-search-month"><span>{monthLabel(g.month)}</span>{g.spent > 0 && <span className="mono">−{money(g.spent)}</span>}</div>
                  {g.rows.map((e) => {
                    const [a, hit, b] = highlight(e.note || e.category || 'Entry', q)
                    const bn = bookName(e.book_id)
                    return (
                      <button key={e.id} type="button" className="hb-search-row" onClick={() => onPick(e)}>
                        <span className="hb-cat">{iconFor(e.category)}</span>
                        <span className="grow">
                          <span className="hb-search-name">{a}{hit && <mark>{hit}</mark>}{b}</span>
                          <span className="muted small hb-search-sub">{[e.category, new Date(`${e.occurred_on}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }), e.source, bn].filter(Boolean).join(' · ')}</span>
                        </span>
                        <b className={`amt ${e.direction === 'out' ? '' : 'pos'}`}>{e.direction === 'out' ? '−' : '+'}{money(e.amount)}</b>
                      </button>
                    )
                  })}
                </div>
              ))}
              {rows.length === 0 && <div className="muted pad">Nothing matches. Try a category, part of the note, or an amount.</div>}
              {rows.length > SHOW && <div className="muted small pad">Showing the newest {SHOW}. Type more to narrow it down.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
