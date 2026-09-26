import { useState } from 'react'
import { RELATIONS, RELATION_EN, uid, isMinor, ageOn } from '../../lib/willModel'
import { fmtDate } from '../../lib/willText'
import { useDialog } from '../../lib/dialog'
import { GuInput, Help } from './WillParts'
import { PencilIcon, TrashIcon, UserIcon } from '../../lib/icons'

export default function WillFamily({ doc, update }) {
  const [editing, setEditing] = useState(null) // person, or {} for new
  const dialog = useDialog()

  async function remove(p) {
    const uses = doc.assets.filter((a) => a.shares.some((s) => s.personId === p.id)).length + (doc.residuary.some((s) => s.personId === p.id) ? 1 : 0)
    if (!await dialog.confirm({ title: `${p.name}ને યાદીમાંથી કાઢવા છે?`, message: uses ? `${uses} મિલકતમાં તેમનો હિસ્સો પણ નીકળી જશે — પછી એ વહેંચણી ફરી તપાસી લેજો.` : 'તેમને હજુ કંઈ આપેલું નથી.', confirmLabel: 'કાઢો' })) return
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
        <div className="grow">
          <h3 style={{ margin: 0 }}>કુટુંબ · Family</h3>
          <Help>વસિયતનામામાં જેમનો ઉલ્લેખ થશે તે બધા: બાળકો, તેમનું કુટુંબ અને જેને કંઈ આપવું હોય તે. સંબંધ વસિયત કરનાર સાથેનો લખવો (દા.ત. પુત્ર, પૌત્રી).</Help>
        </div>
        <button className="btn primary" onClick={() => setEditing({})}>+ વ્યક્તિ ઉમેરો</button>
      </div>
      <div className="card list">
        {doc.people.map((p, i) => (
          <div className="txn" key={p.id}>
            <span className="site-badge type" aria-hidden="true"><UserIcon /></span>
            <button type="button" className="line-btn grow" onClick={() => setEditing(p)}>
              <div className="ellipsis">{p.name}</div>
              <div className="muted small">{p.relation}{p.note && ` · ${p.note}`}{p.dob && ` · ${fmtDate(p.dob)}`}{isMinor(p) && <span className="pill warn-pill"> સગીર, {ageOn(p.dob)} વર્ષ</span>}</div>
            </button>
            <span className="reorder">
              <button className="btn icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn icon" aria-label="Move down" disabled={i === doc.people.length - 1} onClick={() => move(i, 1)}>↓</button>
            </span>
            <button className="btn icon" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><PencilIcon /></button>
            <button className="btn icon" aria-label={`Remove ${p.name}`} onClick={() => remove(p)}><TrashIcon /></button>
          </div>
        ))}
        {!doc.people.length && <p className="muted pad">હજુ કોઈ ઉમેર્યું નથી. પહેલાં બાળકો અને તેમના કુટુંબથી શરૂ કરો.</p>}
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
        <h3>{person.id ? 'વ્યક્તિની વિગત બદલો' : 'વ્યક્તિ ઉમેરો'}</h3>
        <GuInput label="પૂરું નામ · Full name" value={p.name} onChange={set('name')} required autoFocus hint="સરકારી દસ્તાવેજ (આધાર) પ્રમાણે પૂરું નામ, જેથી ઓળખમાં ગૂંચવણ ન થાય." />
        <div className="row2">
          <label>સંબંધ (વસિયત કરનાર સાથે) · Relation
            <select value={custom ? '__custom' : p.relation} onChange={(e) => set('relation')(e.target.value === '__custom' ? '' : e.target.value)}>
              {RELATIONS.map((r) => <option key={r} value={r}>{r} · {RELATION_EN[r]}</option>)}
              <option value="__custom">બીજો સંબંધ લખો…</option>
            </select>
          </label>
          {custom ? <GuInput label="સંબંધ (ગુજરાતીમાં)" value={p.relation} onChange={set('relation')} /> : <GuInput label="નોંધ (જરૂર હોય તો)" value={p.note} onChange={set('note')} placeholder="પુત્રી સમાન" hint="દા.ત. સગી દીકરી નથી પણ દીકરી જેવી માનીએ છીએ." />}
        </div>
        {custom && <GuInput label="નોંધ (જરૂર હોય તો)" value={p.note} onChange={set('note')} placeholder="પુત્રી સમાન" />}
        <div className="row2">
          <label>જન્મ તારીખ · Date of birth<input type="date" value={p.dob} onChange={(e) => set('dob')(e.target.value)} /><span className="help">૧૮ વર્ષથી નાની વ્યક્તિ માટે વાલી નક્કી કરવા પડે છે.</span></label>
          <GuInput label="આધાર (જરૂર હોય તો)" value={p.idNumber} onChange={set('idNumber')} inputMode="numeric" hint="ફક્ત છેલ્લા ૪ આંકડા છપાશે." />
        </div>
        <GuInput label="સરનામું (જરૂર હોય તો) · Address" value={p.address} onChange={set('address')} />
        {isMinor(p) && (
          <label>વાલી / ટ્રસ્ટી (૧૮ વર્ષ સુધી) · Guardian
            <select value={p.guardianId} onChange={(e) => set('guardianId')(e.target.value)}>
              <option value="">— પસંદ કરો —</option>
              {adults.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.relation})</option>)}
            </select>
            <span className="help">આ બાળક ૧૮ વર્ષનું થાય ત્યાં સુધી તેને મળેલી મિલકત કોણ સાચવશે. સામાન્ય રીતે માતા કે પિતા.</span>
          </label>
        )}
        <GuInput label="જો આ વ્યક્તિનું અવસાન પહેલાં થાય તો તેમનો ભાગ કોને મળે" value={p.alternate} onChange={set('alternate')} hint="ખાલી રાખો તો તેમનાં સંતાનો (વંશજો)ને સરખા ભાગે મળશે." />
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>રદ કરો</button>
          <button className="btn primary" disabled={!p.name.trim() || !p.relation.trim()}>સાચવો</button>
        </div>
      </form>
    </div>
  )
}
