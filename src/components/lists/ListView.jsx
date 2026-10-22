import { useMemo, useState } from 'react'
import { useListItems } from '../../lib/useListItems'
import { gotItems, groupBySection, historyOf, openItems } from '../../lib/listLogic'
import { AddBar, Group, Row } from './ListParts'
import ItemSheet from './ItemSheet'

// An everyday list (groceries, shopping, to-do): compact rows grouped by section, ticked items collapse into "Got it",
// and everything bought before is one tap away in history.
export default function ListView({ list, store, onMenu, onBack }) {
  const L = useListItems(list)
  const [filter, setFilter] = useState('All')
  const [editing, setEditing] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showGot, setShowGot] = useState(true)
  const sections = useMemo(() => list.sections || [], [list.sections])

  const items = useMemo(() => L.items || [], [L.items])
  const open = openItems(items)
  const got = gotItems(items)
  const history = useMemo(() => historyOf(items), [items])
  const often = history.filter((h) => !h.onList && h.times > 1).slice(0, 8)
  const groups = useMemo(() => groupBySection(open, sections), [open, sections])
  const chips = ['All', ...groups.map((g) => g.section)]
  const shown = filter === 'All' ? groups : groups.filter((g) => g.section === filter)
  const addNamed = (v, section) => L.add({ tab: 'items', name: v.name, qty: v.qty || null, section: section || (filter !== 'All' && filter !== 'Other' ? filter : null) })

  if (!L.items) return <section className="ls-view"><Head list={list} onBack={onBack} onMenu={onMenu} count="…" /><div className="ls-empty">{L.error ? `Couldn’t load: ${L.error}` : 'Loading…'}</div></section>

  return (
    <section className="ls-view fade-in">
      <Head list={list} onBack={onBack} onMenu={onMenu} count={open.length ? `${open.length} to buy` : 'all done'} />
      {L.error && <div className="alert error">{L.error}</div>}
      <AddBar onAdd={(v) => addNamed(v)} />
      {often.length > 0 && (
        <div className="ls-again">
          {often.map((h) => <button key={h.name} type="button" onClick={() => addNamed({ name: h.name, qty: h.qty }, h.section)}>＋ {h.name}</button>)}
          <button type="button" className="more" onClick={() => setShowHistory(true)}>All ›</button>
        </div>
      )}
      {often.length === 0 && history.length > 0 && <button type="button" className="ls-linkbtn" onClick={() => setShowHistory(true)}>Add from history ›</button>}
      {chips.length > 2 && (
        <div className="ls-filter">{chips.map((c) => <button key={c} type="button" className={filter === c ? 'on' : ''} onClick={() => setFilter(c)}>{c}</button>)}</div>
      )}
      {shown.map((g) => (
        <Group key={g.section} title={g.section} count={g.items.length}>
          {g.items.map((it) => <Row key={it.id} item={it} onTick={L.tick} onOpen={setEditing} />)}
        </Group>
      ))}
      {!open.length && <div className="ls-empty">{got.length ? 'Everything is bought 🎉' : 'Nothing here yet. Add the first item above.'}</div>}
      {got.length > 0 && (
        <Group title={`✓ Got it`} count={got.length} action={<> · <span role="button" tabIndex={0} className="ls-clear" onClick={() => L.clear()}>Clear</span></>}>
          {(showGot ? got : got.slice(0, 0)).map((it) => <Row key={it.id} item={it} onTick={L.tick} onOpen={setEditing} />)}
          <button type="button" className="ls-linkbtn" onClick={() => setShowGot((v) => !v)}>{showGot ? 'Hide' : `Show ${got.length}`}</button>
        </Group>
      )}
      {editing && <ItemSheet item={editing} tab="items" sections={sections} onSave={(f) => L.save(editing.id, f)} onRemove={() => L.remove(editing.id)} onClose={() => setEditing(null)} />}
      {showHistory && <History rows={history} onAdd={(h) => addNamed({ name: h.name, qty: h.qty }, h.section)} onClose={() => setShowHistory(false)} />}
      {store}
    </section>
  )
}

function Head({ list, onBack, onMenu, count }) {
  return (
    <div className="ls-head">
      <button type="button" className="ls-back" onClick={onBack}>‹ Lists</button>
      <h1>{list.name} <span aria-hidden>{list.icon}</span></h1>
      <span className="ls-pill">{count}</span>
      <button type="button" className="btn icon" aria-label="List settings" onClick={onMenu}>⋮</button>
    </div>
  )
}

// Everything ever on this list, by how often it was bought. Tap to add again.
function History({ rows, onAdd, onClose }) {
  const [tab, setTab] = useState('often')
  const [q, setQ] = useState('')
  const list = rows.filter((h) => h.name.toLowerCase().includes(q.toLowerCase()))
    .filter((h) => (tab === 'weekly' ? h.weekly : true))
    .sort((a, b) => (tab === 'recent' ? b.last.localeCompare(a.last) : 0))
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal sheet-lite">
        <h3>Add from history</h3>
        <div className="ls-filter">{[['often', 'Often'], ['recent', 'Recent'], ['weekly', 'Weekly']].map(([id, l]) => <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}</div>
        <input className="ls-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
        <div className="ls-box">
          {list.map((h) => (
            <div key={h.name} className="ls-row">
              <span className="ls-n"><span>{h.name}</span><small>bought {h.times} {h.times === 1 ? 'time' : 'times'}{h.qty ? ` · ${h.qty}` : ''}</small></span>
              {h.onList ? <span className="ls-q">on the list</span> : <button type="button" className="ls-chip" onClick={() => onAdd(h)}>＋ Add</button>}
            </div>
          ))}
          {!list.length && <div className="ls-empty">Nothing found.</div>}
        </div>
        <div className="actions"><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  )
}
