import { useState } from 'react'
import { useDialog } from '../../lib/dialog'
import { templateFromList } from '../../lib/lists'
import { ICONS } from '../../lib/listTemplates'
import { ShareChips, Toggle } from './ListParts'

// ⋮ on a list or occasion: name, icon, sections, date, sharing, auto-clear, and the bigger moves (occasion, archive, delete).
export default function SettingsSheet({ list, households, member, onSave, onDelete, onClose }) {
  const dialog = useDialog()
  const occasion = list.kind === 'occasion'
  const [f, setF] = useState({ name: list.name, icon: list.icon, sections: (list.sections || []).join(', '), event_date: list.event_date || '', event_time: list.event_time || '',
    place: list.place || '', shared: list.shared_with || [], clear: list.auto_clear_days ? String(list.auto_clear_days) : '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const fields = () => ({ name: f.name.trim() || list.name, icon: f.icon, shared_with: f.shared,
    ...(occasion ? { event_date: f.event_date || null, event_time: f.event_time || null, place: f.place.trim() || null }
      : { sections: f.sections.split(',').map((s) => s.trim()).filter(Boolean), auto_clear_days: Number(f.clear) || null }) })

  async function run(fn) { setBusy(true); try { await fn(); onClose() } catch (e) { dialog.alert(e.message || String(e)) } finally { setBusy(false) } }
  async function makeOccasion() {
    if (!await dialog.confirm({ title: 'Make it an occasion?', message: 'It gets a date, tasks, samagri, people and money tabs. Your current items stay, in Tasks.', confirmLabel: 'Make occasion', danger: false })) return
    run(() => onSave({ ...fields(), kind: 'occasion', tabs: ['tasks', 'samagri', 'people', 'money'] }, { toTasks: true }))
  }
  async function remove() {
    if (await dialog.confirm({ title: `Delete “${list.name}”?`, message: 'This deletes the list and everything in it for the whole family.', confirmLabel: 'Delete', danger: true })) run(onDelete)
  }

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card modal" onSubmit={(e) => { e.preventDefault(); run(() => onSave(fields())) }}>
        <h3>{occasion ? 'Occasion settings' : 'List settings'}</h3>
        <label>Name<input value={f.name} onChange={set('name')} required /></label>
        <div className="ls-icons">{ICONS.map((i) => <button key={i} type="button" className={f.icon === i ? 'on' : ''} onClick={() => setF({ ...f, icon: i })}>{i}</button>)}</div>
        {occasion ? (<>
          <div className="row2">
            <label>Date<input type="date" value={f.event_date} onChange={set('event_date')} /></label>
            <label>Time<input type="time" value={f.event_time} onChange={set('event_time')} /></label>
          </div>
          <label>Where<input value={f.place} onChange={set('place')} /></label>
        </>) : (<>
          <label>Sections (comma separated)<input value={f.sections} onChange={set('sections')} placeholder="Veg, Dairy, Dry & oil" /></label>
          <Toggle on={!!f.clear} onChange={(v) => setF({ ...f, clear: v ? '3' : '' })} label="Clear ticked items automatically" hint="after the days below; they stay in history" />
          {f.clear && <label>After how many days<input type="number" min="1" value={f.clear} onChange={set('clear')} /></label>}
        </>)}
        {!member && <ShareChips households={households} homeId={list.household_id} value={f.shared} onChange={(shared) => setF({ ...f, shared })} />}
        {!member && !occasion && <button type="button" className="btn" onClick={makeOccasion}>Make it an occasion…</button>}
        {!member && occasion && <button type="button" className="btn" onClick={() => run(async () => { await templateFromList(list); dialog.alert('Saved. Find it under Customise templates when you make a new occasion.') })}>Save as a template</button>}
        <button type="button" className="btn" onClick={() => run(() => onSave({ archived: !list.archived }))}>{list.archived ? 'Move out of archive' : 'Archive'}</button>
        {!member && <button type="button" className="btn danger" onClick={remove}>Delete {occasion ? 'occasion' : 'list'}</button>}
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div>
      </form>
    </div>
  )
}
