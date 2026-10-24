import { useEffect, useMemo, useState } from 'react'
import { useListItems } from '../../lib/useListItems'
import { daysTo, gotItems, groupBySection, openItems, progress, RSVP_NEXT, rsvpCounts, shortDate, shortTime, taskGroups } from '../../lib/listLogic'
import { OCCASION_TABS } from '../../lib/listTemplates'
import { createBookFor, loadHouseholdBooks, updateList } from '../../lib/lists'
import { loadEntries, iconFor } from '../../lib/hisab'
import { today } from '../../lib/format'
import { useDialog } from '../../lib/dialog'
import { AddBar, Group, Row } from './ListParts'
import ItemSheet from './ItemSheet'
import ShareSheet from '../ShareSheet'
import { occasionShareText } from '../../lib/listShare'

const rs = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`

// An occasion: countdown card, then Tasks · Samagri · People · Money (whichever were included).
export default function OccasionView({ list, member, onMenu, onBack, onListChanged }) {
  const L = useListItems(list)
  const tabs = OCCASION_TABS.filter((t) => (list.tabs || []).includes(t.id))
  const [tab, setTab] = useState(tabs[0]?.id || 'tasks')
  const [editing, setEditing] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [parts, setParts] = useState(['tasks', 'samagri', 'people'])
  const items = useMemo(() => L.items || [], [L.items])
  const by = (t) => items.filter((i) => i.tab === t && !i.cleared)

  const days = daysTo(list.event_date, today())
  const prog = progress([...by('tasks'), ...by('samagri')])
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0
  const people = by('people')
  const yes = rsvpCounts(people).yes

  if (!L.items) return <section className="ls-view"><div className="ls-empty">{L.error ? `Couldn’t load: ${L.error}` : 'Loading…'}</div></section>

  return (
    <section className="ls-view fade-in">
      <div className="ls-head">
        <button type="button" className="ls-back" onClick={onBack}>‹ Lists</button>
        <span className="ls-grow" />
        <button type="button" className="btn small" onClick={() => setSharing(true)}>Share</button>
        <button type="button" className="btn icon" aria-label="Occasion settings" onClick={onMenu}>⋮</button>
      </div>
      <div className="ls-hero">
        <div className="ls-hero-h">
          <span className="ls-hero-ic">{list.icon}</span>
          <div><b>{list.name}</b><small>{[shortDate(list.event_date), shortTime(list.event_time), list.place].filter(Boolean).join(' · ') || 'No date yet — set it in ⋮'}</small></div>
          {days !== null && <div className="ls-count">{days > 0 ? <><b>{days}</b><small>{days === 1 ? 'day' : 'days'}</small></> : days === 0 ? <b>Today</b> : <small>was {shortDate(list.event_date)}</small>}</div>}
        </div>
        <div className="ls-track"><i style={{ width: `${pct}%` }} /></div>
        <small className="ls-herosub">{prog.total ? `${prog.done} of ${prog.total} done` : 'Nothing to do yet'}{people.length ? ` · ${yes} of ${people.length} coming` : ''}</small>
      </div>
      {tabs.length > 1 && <div className="ls-seg">{tabs.map((t) => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>}
      {L.error && <div className="alert error">{L.error}</div>}

      {tab === 'tasks' && <Tasks L={L} tasks={by('tasks')} setEditing={setEditing} />}
      {tab === 'samagri' && <Samagri L={L} rows={by('samagri')} setEditing={setEditing} />}
      {tab === 'people' && <People L={L} rows={people} setEditing={setEditing} />}
      {tab === 'money' && <Money list={list} member={member} onListChanged={onListChanged} />}

      {sharing && (
        <ShareSheet key={parts.join()} title={`Share ${list.name}`} text={occasionShareText(list, items, { today: today(), parts })} onClose={() => setSharing(false)}
          extra={<div className="ls-chips">{tabs.filter((t) => t.id !== 'money').map((t) => (
            <button key={t.id} type="button" className={parts.includes(t.id) ? 'on' : ''}
              onClick={() => setParts((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))}>{parts.includes(t.id) ? '✓ ' : ''}{t.label}</button>))}</div>} />
      )}
      {editing && <ItemSheet item={editing} tab={editing.tab} sections={[...new Set(by(editing.tab).map((i) => i.section).filter(Boolean))]}
        onSave={(f) => L.save(editing.id, f)} onRemove={() => L.remove(editing.id)} onClose={() => setEditing(null)} />}
    </section>
  )
}

function Tasks({ L, tasks, setEditing }) {
  const groups = taskGroups(tasks, today())
  return (<>
    <AddBar placeholder="Add a task…" parse={false} onAdd={(v) => L.add({ tab: 'tasks', name: v.name })} />
    {groups.map((g) => (
      <Group key={g.label} title={g.label} count={g.items.length} action={g.label === 'Done' ? <> · <span role="button" tabIndex={0} className="ls-clear" onClick={() => L.clear('tasks')}>Clear</span></> : null}>
        {g.items.map((t) => <Row key={t.id} item={t} onTick={L.tick} onOpen={setEditing} sub={t.assignee || ''} right={t.due_date ? <span className="ls-q">{shortDate(t.due_date).replace(/^\w+,? /, '')}</span> : null} />)}
      </Group>
    ))}
    {!tasks.length && <div className="ls-empty">No tasks yet. Add the first one above.</div>}
  </>)
}

function Samagri({ L, rows, setEditing }) {
  const sections = [...new Set(rows.map((i) => i.section).filter(Boolean))]
  const open = openItems(rows)
  const got = gotItems(rows)
  return (<>
    <AddBar placeholder="Add a samagri item… (ghee 500 g)" onAdd={(v) => L.add({ tab: 'samagri', name: v.name, qty: v.qty || null })} />
    {groupBySection(open, sections, 'Other').map((g) => (
      <Group key={g.section} title={g.section} count={g.items.length}>
        {g.items.map((it) => <Row key={it.id} item={it} onTick={L.tick} onOpen={setEditing} sub={it.assignee ? `${it.note ? `${it.note} · ` : ''}${it.assignee}` : ''} />)}
      </Group>
    ))}
    {got.length > 0 && (
      <Group title="✓ Got it" count={got.length} action={<> · <span role="button" tabIndex={0} className="ls-clear" onClick={() => L.clear('samagri')}>Clear</span></>}>
        {got.map((it) => <Row key={it.id} item={it} onTick={L.tick} onOpen={setEditing} />)}
      </Group>
    )}
    {!rows.length && <div className="ls-empty">No samagri yet. Add what you need above.</div>}
  </>)
}

function People({ L, rows, setEditing }) {
  const counts = rsvpCounts(rows)
  const groups = groupBySection(rows, [...new Set(rows.map((i) => i.section).filter(Boolean))], 'Others')
  const label = { yes: 'Coming', maybe: 'Maybe', no: 'Not coming' }
  return (<>
    <AddBar placeholder="Add a person or family…" parse={false} onAdd={(v) => L.add({ tab: 'people', name: v.name, section: 'Family' })} />
    {rows.length > 0 && <div className="ls-sum"><b>{counts.yes}</b> coming · <b>{counts.maybe}</b> maybe · <b>{counts.no}</b> not coming · <b>{counts.asked}</b> not asked</div>}
    {groups.map((g) => (
      <Group key={g.section} title={g.section} count={g.items.length}>
        {g.items.map((p) => (
          <div key={p.id} className="ls-row">
            <button type="button" className="ls-n" onClick={() => setEditing(p)}><span>{p.name}</span>{p.note && <small>{p.note}</small>}</button>
            <button type="button" className={`ls-rsvp ${p.rsvp || ''}`} onClick={() => L.save(p.id, { rsvp: RSVP_NEXT[p.rsvp ?? null] })}>{label[p.rsvp] || 'Not asked'}</button>
          </div>
        ))}
      </Group>
    ))}
    {!rows.length && <div className="ls-empty">Add the people you’re inviting or who help.</div>}
  </>)
}

// The occasion's money is a Hisab occasion book, read live. Nothing is copied.
function Money({ list, member, onListChanged }) {
  const dialog = useDialog()
  const [entries, setEntries] = useState(null)
  const [books, setBooks] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    const p = list.book_id ? loadEntries(list.book_id).then((e) => alive && setEntries(e)) : loadHouseholdBooks(list.household_id).then((b) => alive && setBooks(b.filter((x) => x.kind === 'occasion')))
    p.catch((e) => alive && setErr(e.message || String(e)))
    return () => { alive = false }
  }, [list.book_id, list.household_id])

  async function link(fn) { try { onListChanged(await fn()) } catch (e) { dialog.alert(e.message || String(e)) } }

  if (err) return <div className="ls-empty">Couldn’t read the money: {err}</div>
  if (!list.book_id) {
    if (member) return <div className="ls-empty">The owner tracks the money for this occasion.</div>
    return (
      <div className="ls-box ls-money-empty">
        <p>Track what this occasion costs in a Hisab book. Entries stay in Hisab; this tab just shows them.</p>
        <button type="button" className="btn primary" onClick={() => link(() => createBookFor(list))}>Create a Hisab book for it</button>
        {books?.length > 0 && <>
          <div className="ls-label">Or use an existing book</div>
          <div className="ls-chips">{books.map((b) => <button key={b.id} type="button" onClick={() => link(() => updateList(list.id, { book_id: b.id }))}>{b.name}</button>)}</div>
        </>}
      </div>
    )
  }
  if (!entries) return <div className="ls-empty">Loading…</div>
  const out = entries.filter((e) => e.direction === 'out').reduce((s, e) => s + Number(e.amount), 0)
  const inn = entries.filter((e) => e.direction === 'in').reduce((s, e) => s + Number(e.amount), 0)
  return (<>
    <div className="ls-money"><div><small>Spent so far</small><b>{rs(out)}</b></div>{inn > 0 && <div><small>Received</small><b>{rs(inn)}</b></div>}<div><small>Entries</small><b>{entries.length}</b></div></div>
    <Group title="Latest" count={entries.length}>
      {entries.slice(0, 10).map((e) => (
        <div key={e.id} className="ls-row"><span className="ls-ic">{iconFor(e.category)}</span><span className="ls-n"><span>{e.note || e.category || 'Entry'}</span><small>{shortDate(e.occurred_on)}</small></span>
          <span className={`ls-q ${e.direction === 'in' ? 'pos' : ''}`}>{e.direction === 'in' ? '+' : ''}{rs(e.amount)}</span></div>
      ))}
      {!entries.length && <div className="ls-empty">No entries yet. Add them in Budget → Hisab → Occasions.</div>}
    </Group>
    {!member && <button type="button" className="ls-linkbtn" onClick={() => link(() => updateList(list.id, { book_id: null }))}>Unlink this book</button>}
  </>)
}
