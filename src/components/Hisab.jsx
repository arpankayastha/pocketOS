import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DonutChart } from './LazyCharts'
import { currentMonth, money, moneyShort, monthLabel, shiftMonth, today } from '../lib/format'
import { SOURCES, loadCategories, colorFor, deleteBook, deleteEntry, evaluate, iconFor, loadBooks, loadEntries, saveBook, saveEntry } from '../lib/hisab'
import { useBackAction } from '../lib/backNav'
import { useMonthSwipe } from '../lib/useSwipe'
import { useDialog } from '../lib/dialog'
import { BookIcon, PencilIcon, TrashIcon } from '../lib/icons'
import { MonthPicker } from './Transactions'
import { SkeletonRows } from './Skeleton'

const dayHead = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
const shortDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const sum = (rows, dir) => rows.filter((e) => e.direction === dir).reduce((s, e) => s + Number(e.amount), 0)

// Budget → Hisab: cash books that don't touch Budget totals. `addSignal` bumps when the
// floating + is tapped on this tab: it adds to the open book, or to Daily from the list.
export default function Hisab({ activeHouseholdId, addSignal }) {
  const [books, setBooks] = useState(null)
  const [bookId, setBookId] = useState(null)
  const [addReq, setAddReq] = useState(0)
  const [openAdd, setOpenAdd] = useState(false)
  const [editingBook, setEditingBook] = useState(null) // {} new, or a book
  const [error, setError] = useState(null)
  const [categories, setCategories] = useState([])
  const lastSignal = useRef(addSignal)
  useEffect(() => { if (activeHouseholdId) loadCategories(activeHouseholdId).then(setCategories).catch((err) => setError(err.message)) }, [activeHouseholdId])

  const load = useCallback(async () => {
    if (!activeHouseholdId) return
    try { setBooks(await loadBooks(activeHouseholdId)); setError(null) } catch (err) { setError(err.message) }
  }, [activeHouseholdId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (addSignal === lastSignal.current || !books) return
    lastSignal.current = addSignal
    // From the book list: open Daily with the entry sheet already up (BookView reads openAdd on
    // mount); inside a book: bump addReq so the open BookView shows the sheet.
    if (!bookId) { setBookId(books.find((b) => b.kind === 'daily')?.id); setOpenAdd(true) }
    else setAddReq((n) => n + 1)
  }, [addSignal, books, bookId])

  useBackAction(!!bookId, () => setBookId(null), 3)
  const book = books?.find((b) => b.id === bookId)

  if (book) return <BookView book={book} categories={categories} addReq={addReq} openAdd={openAdd} onAddOpened={() => setOpenAdd(false)} onBack={() => setBookId(null)} onChanged={load} onEdit={() => setEditingBook(book)} editor={editingBook && (
    <BookForm book={editingBook} householdId={activeHouseholdId} onClose={() => setEditingBook(null)}
      onSaved={() => { setEditingBook(null); load() }} onDeleted={() => { setEditingBook(null); setBookId(null); load() }} />
  )} />

  const daily = books?.find((b) => b.kind === 'daily')
  const occasions = books?.filter((b) => b.kind !== 'daily') || []
  return (
    <section>
      {error && <div className="alert error">{error}</div>}
      {!books ? <div className="card"><SkeletonRows rows={3} /></div> : (
        <>
          <button className="card hb-daily" onClick={() => setBookId(daily.id)}>
            <span className="hb-icon">🗓️</span>
            <div className="grow">
              <div className="hb-name">Daily</div>
              <div className="muted small">Everyday spends · {monthLabel(currentMonth())}</div>
            </div>
            <div className="hb-amt"><b className="amt neg">{money(daily.monthOut)}</b><span className="muted small">this month</span></div>
          </button>

          <div className="hb-section">
            <h3>Occasions</h3>
            <button className="btn primary small" onClick={() => setEditingBook({})}>+ New book</button>
          </div>
          {occasions.length === 0 ? (
            <div className="card empty-module">
              <BookIcon />
              <b>No occasion books yet</b>
              <p className="muted small">Make one for Diwali, a wedding or a trip, and log every bill of that shopping into it — cash, card, whoever paid. It stays out of your Budget totals.</p>
            </div>
          ) : (
            <div className="hb-list">
              {occasions.map((b) => (
                <button key={b.id} className="card hb-card" onClick={() => setBookId(b.id)}>
                  <div className="hb-top">
                    <span className="hb-icon">📒</span>
                    <div className="grow">
                      <div className="hb-name">{b.name}</div>
                      <div className="muted small">{b.first ? `${shortDate(b.first)}${b.last !== b.first ? ` – ${shortDate(b.last)}` : ''}` : 'no entries yet'} · {b.count} entr{b.count === 1 ? 'y' : 'ies'}</div>
                    </div>
                    <div className="hb-amt"><b className="amt neg">{money(b.out)}</b>{b.in > 0 && <span className="small pos">+{money(b.in)} in</span>}</div>
                  </div>
                  {b.target && <TargetBar spent={b.out} target={b.target} />}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {editingBook && <BookForm book={editingBook.id ? editingBook : null} householdId={activeHouseholdId} onClose={() => setEditingBook(null)}
        onSaved={(b) => { setEditingBook(null); load(); setBookId(b.id) }} onDeleted={() => { setEditingBook(null); load() }} />}
    </section>
  )
}

function TargetBar({ spent, target }) {
  const pct = spent / target
  return (
    <div className="hb-target">
      <div className="bar"><div className={`fill ${pct > 1 ? 'over' : pct > 0.85 ? 'warn' : 'ok'}`} style={{ width: `${Math.min(100, pct * 100)}%` }} /></div>
      <span className="muted small">{Math.round(pct * 100)}% of {moneyShort(target)}</span>
    </div>
  )
}

function BookView({ book, categories, addReq, openAdd, onAddOpened, onBack, onChanged, onEdit, editor }) {
  const [entries, setEntries] = useState(null)
  const [view, setView] = useState('daily') // daily | calendar | summary
  const [month, setMonth] = useState(currentMonth)
  const [calMonth, setCalMonth] = useState(null)
  const [sheet, setSheet] = useState(null) // {} new, or an entry
  const [error, setError] = useState(null)
  const lastAdd = useRef(addReq)
  const isDaily = book.kind === 'daily'

  const load = useCallback(async () => {
    try { setEntries(await loadEntries(book.id)); setError(null) } catch (err) { setError(err.message) }
  }, [book.id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (addReq !== lastAdd.current) { lastAdd.current = addReq; setSheet({}) }
  }, [addReq])
  useEffect(() => { if (openAdd) { setSheet({}); onAddOpened() } }, [openAdd, onAddOpened])

  const changed = () => { load(); onChanged() }
  const shown = useMemo(() => (entries || []).filter((e) => !isDaily || e.occurred_on.startsWith(month)), [entries, isDaily, month])
  const out = sum(shown, 'out'), inn = sum(shown, 'in')
  // Most-used first, for the category/source pickers.
  const used = useMemo(() => {
    const count = (key) => Object.entries((entries || []).reduce((m, e) => (e[key] ? { ...m, [e[key]]: (m[e[key]] || 0) + 1 } : m), {})).sort((a, b) => b[1] - a[1]).map(([k]) => k)
    return { categories: count('category'), sources: count('source') }
  }, [entries])
  const swipe = useMonthSwipe(month, setMonth)
  const cal = isDaily ? month : calMonth || (entries?.[0]?.occurred_on.slice(0, 7) ?? currentMonth())

  return (
    <section {...(isDaily ? swipe : {})}>
      <div className="hb-head">
        <button className="btn icon" aria-label="All books" onClick={onBack}>‹</button>
        <h2 className="grow">{book.name}</h2>
        {!isDaily && <button className="btn icon" aria-label="Edit book" onClick={onEdit}><PencilIcon /></button>}
      </div>
      {isDaily && <div className="toolbar"><MonthPicker month={month} setMonth={setMonth} /></div>}
      {error && <div className="alert error">{error}</div>}

      <div className="tiles hb-tiles">
        <div className="card tile"><div className="muted small">Spent</div>{entries ? <div className="big-num neg">{money(out)}</div> : <div className="skel" style={{ height: 22 }} />}</div>
        <div className="card tile"><div className="muted small">Received</div>{entries ? <div className="big-num pos">{money(inn)}</div> : <div className="skel" style={{ height: 22 }} />}</div>
      </div>
      {book.target && entries && <div className="card"><TargetBar spent={out} target={book.target} /></div>}

      <div className="seg seg3 hb-views">
        {[['daily', 'Daily'], ['calendar', 'Calendar'], ['summary', 'Summary']].map(([id, label]) => (
          <button key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>

      {!entries ? <div className="card"><SkeletonRows rows={4} /></div> : view === 'daily' ? (
        shown.length === 0 ? (
          <div className="card empty-module"><BookIcon /><b>Nothing logged{isDaily ? ` in ${monthLabel(month)}` : ' yet'}</b><p className="muted small">Tap + to add your first entry.</p></div>
        ) : <DayGroups entries={shown} onOpen={setSheet} />
      ) : view === 'calendar' ? (
        <CalendarView month={cal} setMonth={isDaily ? setMonth : setCalMonth} entries={entries} onOpen={setSheet} />
      ) : <SummaryView entries={shown} />}

      {sheet && <EntrySheet book={book} categories={categories} entry={sheet.id ? sheet : null} used={used}
        defaultDate={isDaily && month !== currentMonth() ? `${month}-01` : today()}
        onClose={() => setSheet(null)} onSaved={changed} />}
      {editor}
    </section>
  )
}

function DayGroups({ entries, onOpen }) {
  const days = []
  for (const e of entries) {
    const last = days[days.length - 1]
    if (last?.date === e.occurred_on) last.rows.push(e); else days.push({ date: e.occurred_on, rows: [e] })
  }
  return days.map((d) => {
    const out = sum(d.rows, 'out'), inn = sum(d.rows, 'in')
    return (
      <div className="card hb-day" key={d.date}>
        <div className="hb-day-head">
          <b>{dayHead(d.date)}</b>
          <span className="small">{out > 0 && <span className="neg">−{money(out)}</span>}{inn > 0 && <span className="pos"> +{money(inn)}</span>}</span>
        </div>
        {d.rows.map((e) => <EntryRow key={e.id} e={e} onOpen={onOpen} />)}
      </div>
    )
  })
}

function EntryRow({ e, onOpen }) {
  return (
    <button className="hb-entry" onClick={() => onOpen(e)}>
      <span className="hb-cat">{iconFor(e.category)}</span>
      <div className="grow">
        <div className="hb-entry-name">{e.category || 'Other'}</div>
        {(e.note || e.source) && <div className="muted small hb-entry-sub">{[e.note, e.source].filter(Boolean).join(' · ')}</div>}
      </div>
      <b className={`amt ${e.direction === 'out' ? 'neg' : 'pos'}`}>{e.direction === 'out' ? '−' : '+'}{money(e.amount)}</b>
    </button>
  )
}

function CalendarView({ month, setMonth, entries, onOpen }) {
  const [picked, setPicked] = useState(null)
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7 // Monday first
  const byDay = {}
  for (const e of entries) {
    if (!e.occurred_on.startsWith(month)) continue
    const d = Number(e.occurred_on.slice(8, 10))
    const t = byDay[d] || (byDay[d] = { out: 0, in: 0 })
    t[e.direction] += Number(e.amount)
  }
  const max = Math.max(1, ...Object.values(byDay).map((t) => t.out))
  const pickedDate = picked && `${month}-${String(picked).padStart(2, '0')}`
  const todayStr = today()
  return (
    <>
      <div className="card hb-cal">
        <div className="hb-cal-nav">
          <button className="btn icon" aria-label="Previous month" onClick={() => { setMonth(shiftMonth(month, -1)); setPicked(null) }}>‹</button>
          <b>{monthLabel(month)}</b>
          <button className="btn icon" aria-label="Next month" onClick={() => { setMonth(shiftMonth(month, 1)); setPicked(null) }}>›</button>
        </div>
        <div className="hb-cal-grid">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="hb-cal-dow">{d}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1, t = byDay[d]
            const date = `${month}-${String(d).padStart(2, '0')}`
            return (
              <button key={d} className={`hb-cal-day ${picked === d ? 'on' : ''} ${date === todayStr ? 'today' : ''}`} onClick={() => setPicked(picked === d ? null : d)}
                style={t?.out ? { '--heat': `${Math.round(12 + (t.out / max) * 40)}%` } : undefined}>
                <span className="hb-cal-num">{d}</span>
                {t?.out > 0 && <span className="hb-cal-amt neg">{moneyShort(t.out).replace('₹', '')}</span>}
                {t?.in > 0 && <span className="hb-cal-amt pos">+{moneyShort(t.in).replace('₹', '')}</span>}
              </button>
            )
          })}
        </div>
      </div>
      {pickedDate && (() => {
        const rows = entries.filter((e) => e.occurred_on === pickedDate)
        return rows.length ? <DayGroups entries={rows} onOpen={onOpen} /> : <div className="muted small pad">Nothing on {dayHead(pickedDate)}.</div>
      })()}
    </>
  )
}

function SummaryView({ entries }) {
  const outs = entries.filter((e) => e.direction === 'out')
  const group = (rows, key) => Object.entries(rows.reduce((m, e) => ({ ...m, [e[key] || 'Other']: (m[e[key] || 'Other'] || 0) + Number(e.amount) }), {}))
    .map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const byCat = group(outs, 'category')
  const order = byCat.map((c) => c.name)
  const bySource = group(outs, 'source')
  const inByCat = group(entries.filter((e) => e.direction === 'in'), 'category')
  const total = byCat.reduce((s, c) => s + c.value, 0)
  if (!entries.length) return <div className="card muted pad">No entries to sum up yet.</div>
  return (
    <>
      {total > 0 && (
        <div className="card">
          <h3>Where it went</h3>
          <div className="hb-donut">
            <DonutChart data={byCat.map((c) => ({ ...c, key: c.name, color: colorFor(c.name, order) }))} height={200} inner={58} outer={88} />
            <div className="hb-donut-mid"><span className="muted small">Spent</span><b>{moneyShort(total)}</b></div>
          </div>
          {byCat.map((c) => (
            <div className="line" key={c.name}>
              <span><span className="dot" style={{ background: colorFor(c.name, order) }} />{iconFor(c.name)} {c.name}</span>
              <span><b>{money(c.value)}</b> <span className="muted small">{Math.round((c.value / total) * 100)}%</span></span>
            </div>
          ))}
        </div>
      )}
      {bySource.length > 0 && total > 0 && (
        <div className="card">
          <h3>Paid from</h3>
          {bySource.map((s) => (
            <div className="line" key={s.name}><span>{s.name}</span><b>{money(s.value)}</b></div>
          ))}
        </div>
      )}
      {inByCat.length > 0 && (
        <div className="card">
          <h3>Received</h3>
          {inByCat.map((c) => (
            <div className="line" key={c.name}><span>{iconFor(c.name)} {c.name}</span><b className="pos">{money(c.value)}</b></div>
          ))}
        </div>
      )}
    </>
  )
}

const KEYS = ['7', '8', '9', '⌫', '4', '5', '6', '+', '1', '2', '3', '−', '.', '0', '00', '×']

function EntrySheet({ book, categories, entry, used, defaultDate, onClose, onSaved }) {
  const dialog = useDialog()
  const [dir, setDir] = useState(entry?.direction || 'out')
  const [expr, setExpr] = useState(entry ? String(Number(entry.amount)) : '')
  const [category, setCategory] = useState(entry?.category || '')
  const [source, setSource] = useState(entry?.source ?? used.sources[0] ?? '')
  const [date, setDate] = useState(entry?.occurred_on || defaultDate)
  const [note, setNote] = useState(entry?.note || '')
  const [extraSources, setExtraSources] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null) // last "Save & next" summary
  const amount = evaluate(expr)
  const hasOps = /[+−×]/.test(expr)

  // The household's managed list (⚙ → Hisab categories); an entry's own category stays pickable when editing.
  const cats = categories.filter((c) => c.direction === dir)
  if (entry?.category && !cats.some((c) => c.name === entry.category)) cats.push({ name: entry.category, icon: iconFor(entry.category) })
  const sources = [...new Set([...SOURCES, ...used.sources, ...extraSources, ...(source ? [source] : [])])]

  function press(k) {
    setError(null)
    setExpr((x) => {
      if (k === '⌫') return x.slice(0, -1)
      const last = x.slice(-1)
      if (/[+−×]/.test(k)) return !x ? x : /[+−×.]/.test(last) ? x.slice(0, -1) + k : x + k
      if (k === '.') { const cur = x.split(/[+−×]/).pop(); return cur.includes('.') ? x : x + (cur ? '.' : '0.') }
      const cur = x.split(/[+−×]/).pop()
      if (cur.includes('.') && cur.split('.')[1].length >= 2) return x
      if (x.length >= 40) return x
      return cur === '0' && k !== '.' ? x.slice(0, -1) + (k === '00' ? '0' : k) : x + k
    })
  }

  // Physical keyboard on desktop (ignored while typing in the note/date fields).
  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
    const map = { Backspace: '⌫', '+': '+', '-': '−', '*': '×', x: '×', '.': '.' }
    const k = /^\d$/.test(e.key) ? e.key : map[e.key]
    if (k) { e.preventDefault(); press(k) } else if (e.key === 'Enter') { e.preventDefault(); save(false) }
  }

  async function addSource() {
    const s = await dialog.prompt({ title: 'New source', label: 'Paid from / by', placeholder: 'e.g. Papa, HDFC card', confirmLabel: 'Add' })
    if (s?.trim()) { setExtraSources((x) => [...x, s.trim()]); setSource(s.trim()) }
  }

  async function save(next) {
    if (!amount || amount <= 0) return setError('Enter an amount.')
    setBusy(true); setError(null)
    try {
      await saveEntry(book, { id: entry?.id, direction: dir, amount, occurredOn: date, category: category || 'Other', source, note: note.trim() })
      onSaved()
      if (next) { setSaved(`${money(amount)} · ${category || 'Other'}`); setExpr(''); setNote(''); setBusy(false) }
      else onClose()
    } catch (err) { setError(err.message); setBusy(false) }
  }

  async function remove() {
    if (!await dialog.confirm({ title: 'Delete this entry?', message: `${money(entry.amount)} · ${entry.category || 'Other'} on ${dayHead(entry.occurred_on)}`, confirmLabel: 'Delete' })) return
    try { await deleteEntry(entry.id); onSaved(); onClose() } catch (err) { setError(err.message) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal hb-sheet" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown} tabIndex={-1}>
        <div className="hb-sheet-top">
          <div className="seg hb-dir">
            <button type="button" className={dir === 'out' ? 'on expense' : ''} onClick={() => { setDir('out'); setCategory('') }}>Spent</button>
            <button type="button" className={dir === 'in' ? 'on income' : ''} onClick={() => { setDir('in'); setCategory('') }}>Received</button>
          </div>
          {entry && <button type="button" className="btn icon" aria-label="Delete entry" onClick={remove}><TrashIcon /></button>}
        </div>

        <div className={`hb-display ${dir === 'out' ? 'neg' : 'pos'}`} aria-live="polite">
          <span className="hb-expr">{expr ? `₹${expr}` : <span className="muted">₹0</span>}</span>
          {hasOps && amount !== null && <span className="hb-result">= {money(amount)}</span>}
        </div>

        <div className="hb-cats" role="radiogroup" aria-label="Category">
          {cats.map((c) => (
            <button type="button" key={c.name} role="radio" aria-checked={category === c.name} className={category === c.name ? 'on' : ''}
              onClick={() => setCategory(category === c.name ? '' : c.name)}>
              <span className="hb-cat-icon">{c.icon}</span><span className="hb-cat-name">{c.name}</span>
            </button>
          ))}
        </div>

        <div className="hb-sources">
          {sources.map((s) => (
            <button type="button" key={s} className={`chip chip-btn ${source === s ? 'on' : ''}`} onClick={() => setSource(source === s ? '' : s)}>{s}</button>
          ))}
          <button type="button" className="chip chip-btn" onClick={addSource}>+ Other</button>
        </div>

        <div className="hb-meta">
          <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="hb-keys">
          {KEYS.map((k) => (
            <button type="button" key={k} className={/[+−×⌫]/.test(k) ? 'op' : ''} onClick={() => press(k)}>{k}</button>
          ))}
        </div>

        {error && <div className="alert error">{error}</div>}
        {saved && !error && <div className="muted small hb-saved">✓ Saved {saved} — add the next one</div>}
        <div className="actions">
          {!entry && <button type="button" className="btn" disabled={busy} onClick={() => save(true)}>Save &amp; next</button>}
          <button type="button" className="btn primary" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : entry ? 'Save' : 'Save & close'}</button>
        </div>
      </div>
    </div>
  )
}

function BookForm({ book, householdId, onClose, onSaved, onDeleted }) {
  const dialog = useDialog()
  const [name, setName] = useState(book?.name || '')
  const [target, setTarget] = useState(book?.target ? String(book.target) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { onSaved(await saveBook({ id: book?.id, householdId, name, target: Number(target) || null })) } catch (err) { setError(err.message); setBusy(false) }
  }

  async function remove() {
    if (!await dialog.confirm({ title: `Delete "${book.name}"?`, message: `All ${book.count} entr${book.count === 1 ? 'y' : 'ies'} in it are deleted. Your Budget isn't affected.`, confirmLabel: 'Delete' })) return
    try { await deleteBook(book.id); onDeleted() } catch (err) { setError(err.message) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{book ? 'Edit book' : 'New occasion book'}</h3>
        <label>Name<input required autoFocus={!book} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali 2026, Cousin's wedding" /></label>
        <label>Target amount <span className="muted">(optional)</span>
          <input type="number" inputMode="decimal" min="1" step="1" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="How much you plan to spend" />
        </label>
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          {book && <button type="button" className="btn icon" aria-label="Delete book" onClick={remove}><TrashIcon /></button>}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : book ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </div>
  )
}
