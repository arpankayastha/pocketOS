import { useState } from 'react'
import { Toggle } from './ListParts'

// Edit one item. Fields shown depend on the tab: quantity + section + weekly repeat (lists, samagri), a due date (tasks),
// the group + reply (people).
export default function ItemSheet({ item, tab, sections = [], onSave, onRemove, onClose }) {
  const [f, setF] = useState({ name: item.name, qty: item.qty || '', note: item.note || '', section: item.section || '', assignee: item.assignee || '',
    due_date: item.due_date || '', rsvp: item.rsvp || '', repeat_weekly: !!item.repeat_weekly })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function submit(e) {
    e.preventDefault()
    if (!f.name.trim()) return
    setBusy(true)
    try {
      await onSave({ name: f.name.trim(), qty: f.qty.trim() || null, note: f.note.trim() || null, section: f.section.trim() || null, assignee: f.assignee.trim() || null,
        due_date: f.due_date || null, rsvp: f.rsvp || null, repeat_weekly: f.repeat_weekly })
      onClose()
    } finally { setBusy(false) }
  }
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card modal" onSubmit={submit}>
        <h3>{item.name}</h3>
        <label>Name<input value={f.name} onChange={set('name')} required /></label>
        {tab !== 'tasks' && tab !== 'people' && (
          <div className="row2">
            <label>Quantity<input value={f.qty} onChange={set('qty')} placeholder="2 kg" /></label>
            <label>Section
              <select value={f.section} onChange={set('section')}><option value="">None</option>{sections.map((s) => <option key={s}>{s}</option>)}</select></label>
          </div>
        )}
        {tab === 'tasks' && (
          <div className="row2">
            <label>Due<input type="date" value={f.due_date} onChange={set('due_date')} /></label>
            <label>Who does it<input value={f.assignee} onChange={set('assignee')} placeholder="Anyone" /></label>
          </div>
        )}
        {tab === 'people' && (
          <div className="row2">
            <label>Group<input list="ls-groups" value={f.section} onChange={set('section')} placeholder="Family" />
              <datalist id="ls-groups">{sections.map((s) => <option key={s} value={s} />)}</datalist></label>
            <label>Reply
              <select value={f.rsvp} onChange={set('rsvp')}><option value="">Not asked yet</option><option value="yes">Coming</option><option value="maybe">Maybe</option><option value="no">Not coming</option></select></label>
          </div>
        )}
        <label>Note<input value={f.note} onChange={set('note')} placeholder={tab === 'people' ? 'Phone, who invites…' : 'the small ones'} /></label>
        {tab !== 'tasks' && tab !== 'people' && <Toggle on={f.repeat_weekly} onChange={(v) => setF({ ...f, repeat_weekly: v })} label="Repeat every week" hint="comes back a week after you tick it" />}
        {tab === 'samagri' && <label>Who brings it<input value={f.assignee} onChange={set('assignee')} placeholder="Anyone" /></label>}
        <div className="actions">
          <button type="button" className="btn danger" onClick={async () => { await onRemove(); onClose() }}>Remove</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </div>
  )
}
