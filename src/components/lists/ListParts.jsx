import { useState } from 'react'
import { parseQuick } from '../../lib/listLogic'

// One compact checklist row: tick, name (+ small note), quantity / right-hand text. Tapping the name opens the item.
export function Row({ item, onTick, onOpen, right, sub }) {
  return (
    <div className={`ls-row ${item.done ? 'done' : ''}`}>
      <button type="button" className={`ls-cb ${item.done ? 'on' : ''}`} aria-label={item.done ? `Untick ${item.name}` : `Tick ${item.name}`} onClick={() => onTick(item)}>{item.done ? '✓' : ''}</button>
      <button type="button" className="ls-n" onClick={() => onOpen(item)}>
        <span>{item.name}{item.repeat_weekly && <i title="Repeats weekly"> ↻</i>}</span>
        {(sub || item.note) && <small>{sub || item.note}</small>}
      </button>
      {right !== undefined ? right : item.qty ? <span className="ls-q">{item.qty}</span> : null}
    </div>
  )
}

export function Group({ title, count, children, action }) {
  return (
    <div className="ls-box">
      <div className="ls-sh"><span>{title}</span><b>{count}{action}</b></div>
      {children}
    </div>
  )
}

// The "Add an item…" bar. `parse` turns "milk 2 L" into name + quantity; `onAdd({ name, qty })` may return a promise.
// With `sections` (and `section` / `onSection`) a small picker sets where the next item goes; "Auto" leaves it to the list.
export function AddBar({ placeholder = 'Add an item…', parse = true, onAdd, sections = [], section = '', onSection }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    const v = parse ? parseQuick(text) : { name: text.trim(), qty: '' }
    if (!v.name || busy) return
    setBusy(true)
    try { await onAdd(v); setText('') } finally { setBusy(false) }
  }
  return (
    <form className="ls-add" onSubmit={submit}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} enterKeyHint="done" autoComplete="off" />
      {sections.length > 0 && onSection && (
        <select className="ls-secsel" value={section} onChange={(e) => onSection(e.target.value)} aria-label="Section for the next item">
          <option value="">Auto</option>
          {sections.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      )}
      <button className="btn primary" type="submit" aria-label="Add" disabled={busy || !text.trim()}>＋</button>
    </form>
  )
}

// Which of the owner's other households can see (and tick) a list.
export function ShareChips({ households, homeId, value, onChange }) {
  const others = households.filter((h) => h.id !== homeId)
  if (!others.length) return null
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div className="ls-share">
      <div className="ls-label">Share with</div>
      <div className="ls-chips">
        {others.map((h) => <button key={h.id} type="button" className={value.includes(h.id) ? 'on' : ''} onClick={() => toggle(h.id)}>{value.includes(h.id) ? '✓ ' : ''}{h.name}</button>)}
        <button type="button" className={!value.length ? 'on' : ''} onClick={() => onChange([])}>Only me</button>
      </div>
    </div>
  )
}

export const Toggle = ({ on, onChange, label, hint }) => (
  <label className="ls-tg"><span>{label}{hint && <small>{hint}</small>}</span>
    <input type="checkbox" className="ls-switch" checked={on} onChange={(e) => onChange(e.target.checked)} /></label>
)
