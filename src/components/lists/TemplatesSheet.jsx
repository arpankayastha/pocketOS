import { useCallback, useEffect, useState } from 'react'
import { useDialog } from '../../lib/dialog'
import { deleteTemplate, loadTemplates, saveTemplate, seedTemplates } from '../../lib/lists'
import { EVENT_TEMPLATES, ICONS } from '../../lib/listTemplates'

const EMPTY = { name: '', icon: '🪔', tasks: [], samagri: [], people: [] }

// Customise the occasion starters (Lists ⚙ settings): edit the built-in ones (copied in on first use), add your own, delete.
export default function TemplatesPanel({ homeId }) {
  const dialog = useDialog()
  const [tpls, setTpls] = useState(null)
  const [editing, setEditing] = useState(null)
  const load = useCallback(async () => {
    try { setTpls(await loadTemplates()) } catch (e) { dialog.alert(e.message || String(e)); setTpls([]) }
  }, [dialog])
  useEffect(() => { load() }, [load])

  const [seeding, setSeeding] = useState(false)
  async function seed() {
    if (seeding) return
    setSeeding(true)
    try { await seedTemplates(homeId, EVENT_TEMPLATES); await load() } catch (e) { dialog.alert(e.message || String(e)) } finally { setSeeding(false) }
  }
  async function remove(t) {
    if (await dialog.confirm({ title: `Delete “${t.name}”?`, message: 'Occasions already made from it are not affected.', confirmLabel: 'Delete', danger: true })) { await deleteTemplate(t.id); load() }
  }

  return (
    <>
      <div className="ls-panel">
        <h3>Occasion templates</h3>
        <p className="muted small">The starting tasks, samagri and people for a new occasion. Change them to fit your family.</p>
        {!tpls && <div className="ls-empty">Loading…</div>}
        {tpls && !tpls.length && (
          <div className="ls-box ls-money-empty">
            <p>You are using the built-in starters. Copy them in to edit them.</p>
            <button type="button" className="btn primary" disabled={seeding} onClick={seed}>{seeding ? 'Copying…' : 'Copy the built-in starters to edit'}</button>
          </div>
        )}
        {tpls?.length > 0 && <div className="ls-box">{tpls.map((t) => (
          <div key={t.id} className="ls-row">
            <span className="ls-ic">{t.icon}</span>
            <span className="ls-n"><span>{t.name}</span><small>{t.tasks.length} tasks · {t.samagri.length} samagri · {t.people.length} people</small></span>
            <button type="button" className="ls-chip" onClick={() => setEditing(t)}>Edit</button>
            <button type="button" className="ls-x" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}>✕</button>
          </div>
        ))}</div>}
        <button type="button" className="btn" onClick={() => setEditing({ ...EMPTY })}>＋ New template</button>
      </div>
      {editing && <Editor start={editing} homeId={homeId} onClose={(changed) => { setEditing(null); if (changed) load() }} />}
    </>
  )
}

const TABS = [['tasks', 'Tasks'], ['samagri', 'Samagri'], ['people', 'People']]
// Column shape per tab: tasks [name, daysBefore], samagri [section, name, qty], people [group, name].
const BLANK = { tasks: ['', 7], samagri: ['', '', ''], people: ['Family', ''] }
const COLS = {
  tasks: [{ i: 0, ph: 'Task', grow: true }, { i: 1, ph: 'Days before', num: true }],
  samagri: [{ i: 0, ph: 'Section' }, { i: 1, ph: 'Item', grow: true }, { i: 2, ph: 'Qty' }],
  people: [{ i: 0, ph: 'Group' }, { i: 1, ph: 'Person / family', grow: true }],
}

function Editor({ start, homeId, onClose }) {
  const dialog = useDialog()
  const [t, setT] = useState(start)
  const [tab, setTab] = useState('tasks')
  const [busy, setBusy] = useState(false)
  const rows = t[tab]
  const setRows = (r) => setT({ ...t, [tab]: r })
  const setCell = (ri, ci, v) => setRows(rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)))

  async function save() {
    if (!t.name.trim()) return dialog.alert('Give the template a name.')
    setBusy(true)
    try { await saveTemplate(homeId, { ...t, name: t.name.trim() }); onClose(true) } catch (e) { dialog.alert(e.message || String(e)); setBusy(false) }
  }
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="card modal sheet-lite">
        <h3>{t.id ? 'Edit template' : 'New template'}</h3>
        <label>Name<input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="Griha pravesh" /></label>
        <div className="ls-icons">{ICONS.map((i) => <button key={i} type="button" className={t.icon === i ? 'on' : ''} onClick={() => setT({ ...t, icon: i })}>{i}</button>)}</div>
        <div className="ls-seg">{TABS.map(([id, l]) => <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l} · {t[id].length}</button>)}</div>
        <div className="ls-tplrows">
          {rows.map((r, ri) => (
            <div key={ri} className="ls-tplrow">
              {COLS[tab].map((c) => (
                <input key={c.i} className={c.grow ? 'grow' : c.num ? 'num' : ''} type={c.num ? 'number' : 'text'} min={c.num ? 0 : undefined} placeholder={c.ph} value={r[c.i]}
                  onChange={(e) => setCell(ri, c.i, c.num ? e.target.value : e.target.value)} />
              ))}
              <button type="button" className="ls-x" aria-label="Remove" onClick={() => setRows(rows.filter((_, i) => i !== ri))}>✕</button>
            </div>
          ))}
          <button type="button" className="ls-linkbtn" onClick={() => setRows([...rows, [...BLANK[tab]]])}>＋ Add {tab === 'tasks' ? 'a task' : tab === 'samagri' ? 'an item' : 'a person'}</button>
        </div>
        {tab === 'tasks' && <p className="muted small">“Days before” sets each task’s due date from the occasion’s date.</p>}
        <div className="actions"><button type="button" className="btn" onClick={() => onClose(false)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button></div>
      </div>
    </div>
  )
}
