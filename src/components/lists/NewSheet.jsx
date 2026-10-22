import { useEffect, useState } from 'react'
import { useDialog } from '../../lib/dialog'
import { createList, createOccasion, loadTemplates } from '../../lib/lists'
import { EVENT_TEMPLATES, LIST_PRESETS, OCCASION_TABS } from '../../lib/listTemplates'
import { ShareChips, Toggle } from './ListParts'

// + on the Lists home: "A list" (quick) or "An occasion" (date, countdown, tasks, samagri, people, money).
export default function NewSheet({ homeId, households, member, initialKind = 'list', onCreated, onClose }) {
  const dialog = useDialog()
  const others = households.filter((h) => h.id !== homeId).map((h) => h.id)
  const [kind, setKind] = useState(initialKind)
  const [preset, setPreset] = useState(LIST_PRESETS[0])
  const [saved, setSaved] = useState([])
  const blank = EVENT_TEMPLATES.find((t) => !t.name)
  const templates = [...(saved.length ? saved : EVENT_TEMPLATES.filter((t) => t.name)), blank]
  const [tpl, setTpl] = useState(EVENT_TEMPLATES[0])
  const [name, setName] = useState(initialKind === 'list' ? LIST_PRESETS[0].name : EVENT_TEMPLATES[0].name)
  useEffect(() => { loadTemplates().then((t) => {
    setSaved(t)
    if (t.length) { setTpl(t[0]); setName((n) => (kind === 'occasion' && EVENT_TEMPLATES.some((b) => b.name === n) ? t[0].name : n)) }
  }).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [place, setPlace] = useState('')
  const [tabs, setTabs] = useState(OCCASION_TABS.map((t) => t.id))
  const [shared, setShared] = useState(others)
  const [busy, setBusy] = useState(false)

  const pickKind = (k) => { setKind(k); setName(k === 'list' ? preset.name : tpl.name) }
  const toggleTab = (id) => setTabs((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]))

  async function create(e) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const list = kind === 'list'
        ? await createList(homeId, { name: name.trim(), icon: preset.icon, sections: preset.sections, shared_with: shared })
        : await createOccasion(homeId, { name: name.trim(), icon: tpl.icon, eventDate: date, eventTime: time, place, tabs, shared, template: tpl })
      onCreated(list)
    } catch (err) { dialog.alert(err.message || String(err)); setBusy(false) }
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card modal" onSubmit={create}>
        <h3>What do you want to make?</h3>
        <div className="seg">
          <button type="button" className={kind === 'list' ? 'on' : ''} onClick={() => pickKind('list')}>📝 A list</button>
          <button type="button" className={kind === 'occasion' ? 'on' : ''} onClick={() => pickKind('occasion')}>🪔 An occasion</button>
        </div>
        <p className="muted small">{kind === 'list' ? 'Groceries, shopping, to-do. Quick to add, tick as you go.' : 'A date and countdown, with tasks, samagri, people and money.'}</p>
        <div className="ls-label">{kind === 'list' ? 'Start with' : 'Start from'}</div>
        <div className="ls-chips">
          {kind === 'list'
            ? LIST_PRESETS.map((p) => <button key={p.id} type="button" className={preset.id === p.id ? 'on' : ''} onClick={() => { setPreset(p); setName(p.name) }}>{p.icon} {p.name || 'Blank'}</button>)
            : templates.map((t) => <button key={t.id} type="button" className={tpl.id === t.id ? 'on' : ''} onClick={() => { setTpl(t); setName(t.name) }}>{t.icon} {t.name || 'Blank'}</button>)}
        </div>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
        {kind === 'occasion' && (<>
          <div className="row2">
            <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label>Time (muhurat)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>
          <label>Where<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="New home" /></label>
          <div className="ls-label">Include</div>
          <div className="ls-box">
            {OCCASION_TABS.map((t) => <Toggle key={t.id} on={tabs.includes(t.id)} onChange={() => toggleTab(t.id)} label={`${t.icon} ${t.label}`} />)}
          </div>
        </>)}
        {!member && <ShareChips households={households} homeId={homeId} value={shared} onChange={setShared} />}
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim()}>Create</button></div>
      </form>
    </div>
  )
}
