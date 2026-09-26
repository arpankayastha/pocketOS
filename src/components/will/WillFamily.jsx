import { useState } from 'react'
import { RELATIONS, RELATION_EN, uid, isMinor, ageOn } from '../../lib/willModel'
import { fmtDate } from '../../lib/willText'
import { useDialog } from '../../lib/dialog'
import { GuInput } from './WillParts'
import { PencilIcon, TrashIcon, UserIcon } from '../../lib/icons'

export default function WillFamily({ doc, update }) {
  const [editing, setEditing] = useState(null) // person, or {} for new
  const dialog = useDialog()

  async function remove(p) {
    const uses = doc.assets.filter((a) => a.shares.some((s) => s.personId === p.id)).length + (doc.residuary.some((s) => s.personId === p.id) ? 1 : 0)
    if (!await dialog.confirm({ title: `Remove ${p.name}?`, message: uses ? `Their shares in ${uses} item${uses === 1 ? '' : 's'} are removed too — re-check those splits afterwards.` : 'They are not receiving anything yet.', confirmLabel: 'Remove' })) return
    update((d) => ({
      ...d,
      people: d.people.filter((x) => x.id !== p.id).map((x) => (x.guardianId === p.id ? { ...x, guardianId: '' } : x)),
      executors: d.executors.filter((id) => id !== p.id),
      assets: d.assets.map((a) => ({ ...a, shares: a.shares.filter((s) => s.personId !== p.id) })),
      residuary: d.residuary.filter((s) => s.personId !== p.id),
    }))
  }

  function move(i, dir) {
    update((d) => {
      const people = [...d.people]
      const j = i + dir
      if (j < 0 || j >= people.length) return d
      ;[people[i], people[j]] = [people[j], people[i]]
      return { ...d, people }
    })
  }

  return (
    <section>
      <div className="toolbar">
        <p className="muted small grow" style={{ margin: 0 }}>Everyone mentioned in the will: children and their families, and anyone else receiving something. Relations are written in Gujarati, relative to the person making the will.</p>
        <button className="btn primary" onClick={() => setEditing({})}>+ Add person</button>
      </div>
      <div className="card list">
        {doc.people.map((p, i) => (
          <div className="txn" key={p.id}>
            <span className="site-badge type" aria-hidden="true"><UserIcon /></span>
            <button type="button" className="line-btn grow" onClick={() => setEditing(p)}>
              <div className="ellipsis">{p.name}</div>
              <div className="muted small">{p.relation}{p.note && ` · ${p.note}`}{p.dob && ` · ${fmtDate(p.dob)}`}{isMinor(p) && <span className="pill warn-pill"> minor, {ageOn(p.dob)}</span>}</div>
            </button>
            <span className="reorder">
              <button className="btn icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn icon" aria-label="Move down" disabled={i === doc.people.length - 1} onClick={() => move(i, 1)}>↓</button>
            </span>
            <button className="btn icon" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><PencilIcon /></button>
            <button className="btn icon" aria-label={`Remove ${p.name}`} onClick={() => remove(p)}><TrashIcon /></button>
          </div>
        ))}
        {!doc.people.length && <p className="muted pad">No one added yet. Start with the children and their families.</p>}
      </div>
      {editing && <PersonForm doc={doc} person={editing} onClose={() => setEditing(null)}
        onSave={(p) => {
          update((d) => ({ ...d, people: p.id && d.people.some((x) => x.id === p.id) ? d.people.map((x) => (x.id === p.id ? p : x)) : [...d.people, { ...p, id: uid() }] }))
          setEditing(null)
        }} />}
    </section>
  )
}

function PersonForm({ doc, person, onClose, onSave }) {
  const [p, setP] = useState({ name: '', relation: 'પુત્ર', note: '', dob: '', address: '', idNumber: '', guardianId: '', alternate: '', ...person })
  const set = (k) => (v) => setP((x) => ({ ...x, [k]: v }))
  const custom = !RELATIONS.includes(p.relation)
  const adults = doc.people.filter((x) => x.id !== p.id && !isMinor(x))

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (p.name.trim()) onSave({ ...p, name: p.name.trim() }) }}>
        <h3>{person.id ? 'Edit person' : 'Add person'}</h3>
        <GuInput label="Full name" value={p.name} onChange={set('name')} required autoFocus />
        <div className="row2">
          <label>Relation (to the person making the will)
            <select value={custom ? '__custom' : p.relation} onChange={(e) => set('relation')(e.target.value === '__custom' ? '' : e.target.value)}>
              {RELATIONS.map((r) => <option key={r} value={r}>{r} · {RELATION_EN[r]}</option>)}
              <option value="__custom">Other (type it)…</option>
            </select>
          </label>
          {custom ? <GuInput label="Relation (Gujarati)" value={p.relation} onChange={set('relation')} /> : <GuInput label="Note (optional)" value={p.note} onChange={set('note')} placeholder="પુત્રી સમાન" />}
        </div>
        {custom && <GuInput label="Note (optional)" value={p.note} onChange={set('note')} placeholder="પુત્રી સમાન" />}
        <div className="row2">
          <label>Date of birth<input type="date" value={p.dob} onChange={(e) => set('dob')(e.target.value)} /></label>
          <GuInput label="Aadhaar (optional)" value={p.idNumber} onChange={set('idNumber')} inputMode="numeric" hint="Printed masked." />
        </div>
        <GuInput label="Address (optional)" value={p.address} onChange={set('address')} />
        {isMinor(p) && (
          <label>Guardian / trustee until 18
            <select value={p.guardianId} onChange={(e) => set('guardianId')(e.target.value)}>
              <option value="">— choose —</option>
              {adults.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.relation})</option>)}
            </select>
          </label>
        )}
        <GuInput label="If they die before the will-maker, their share goes to (optional)" value={p.alternate} onChange={set('alternate')} hint="Blank = their children (વંશજો), in equal shares." />
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!p.name.trim() || !p.relation.trim()}>Save</button>
        </div>
      </form>
    </div>
  )
}
