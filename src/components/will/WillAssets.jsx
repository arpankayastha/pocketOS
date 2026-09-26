import { useState } from 'react'
import { ASSET_TYPES, ASSET_TYPE, uid, personById, sumPercent } from '../../lib/willModel'
import { assetDescription } from '../../lib/willText'
import { useDialog } from '../../lib/dialog'
import { GuInput, SharesEditor } from './WillParts'
import { PencilIcon, TrashIcon } from '../../lib/icons'

export default function WillAssets({ doc, update }) {
  const [editing, setEditing] = useState(null) // asset, or { type } for new
  const [adding, setAdding] = useState(false)
  const dialog = useDialog()

  async function remove(a) {
    if (!await dialog.confirm({ title: 'Remove this asset?', message: assetDescription(a) || ASSET_TYPE[a.type].en, confirmLabel: 'Remove' })) return
    update((d) => ({ ...d, assets: d.assets.filter((x) => x.id !== a.id) }))
  }

  return (
    <section>
      <div className="toolbar">
        <p className="muted small grow" style={{ margin: 0 }}>List each asset and who gets it. Anything not listed goes by the "everything else" rule in the Split tab.</p>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add asset</button>
      </div>
      {ASSET_TYPES.filter((t) => doc.assets.some((a) => a.type === t.id)).map((t) => (
        <div className="card list" key={t.id}>
          <div className="list-head">{t.gu} <span className="muted small">· {t.en}</span></div>
          {doc.assets.filter((a) => a.type === t.id).map((a) => {
            const total = sumPercent(a.shares)
            return (
              <div className="txn" key={a.id}>
                <button type="button" className="line-btn grow" onClick={() => setEditing(a)}>
                  <div>{assetDescription(a) || <span className="muted">No details yet</span>}</div>
                  <div className="muted small">
                    {a.shares.map((s) => `${personById(doc, s.personId)?.name || '?'} ${s.percent}%`).join(' · ') || 'Not given to anyone yet'}
                    {a.shares.length > 0 && Math.abs(total - 100) > 0.01 && <span className="neg"> · total {total}%</span>}
                    {a.holding === 'joint' && ' · joint'}
                  </div>
                </button>
                <button className="btn icon" aria-label="Edit" onClick={() => setEditing(a)}><PencilIcon /></button>
                <button className="btn icon" aria-label="Remove" onClick={() => remove(a)}><TrashIcon /></button>
              </div>
            )
          })}
        </div>
      ))}
      {!doc.assets.length && <div className="card"><p className="muted" style={{ margin: 0 }}>No assets yet. Add the house, bank accounts, FDs, LIC, gold and anything else.</p></div>}

      {adding && (
        <div className="modal-bg" onMouseDown={() => setAdding(false)}>
          <div className="card modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>What kind of asset?</h3>
            <div className="type-list">
              {ASSET_TYPES.map((t) => (
                <button key={t.id} className="type-option" onClick={() => { setAdding(false); setEditing({ type: t.id }) }}>
                  <span>{t.gu}<span className="muted small"> · {t.en}</span></span>
                </button>
              ))}
            </div>
            <div className="actions"><button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button></div>
          </div>
        </div>
      )}
      {editing && <AssetForm doc={doc} asset={editing} onClose={() => setEditing(null)}
        onSave={(a) => {
          update((d) => ({ ...d, assets: a.id ? d.assets.map((x) => (x.id === a.id ? a : x)) : [...d.assets, { ...a, id: uid() }] }))
          setEditing(null)
        }} />}
    </section>
  )
}

function AssetForm({ doc, asset, onClose, onSave }) {
  const t = ASSET_TYPE[asset.type]
  const [a, setA] = useState({ holding: 'single', jointWith: '', nominee: '', note: '', shares: [], ...asset })
  const set = (k) => (v) => setA((x) => ({ ...x, [k]: v }))

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(a) }}>
        <h3>{t.gu}</h3>
        {t.fields.map((fl) => fl.options ? (
          <label key={fl.key}>{fl.label}
            <select value={a[fl.key] || ''} onChange={(e) => set(fl.key)(e.target.value)}>
              <option value="">—</option>{fl.options.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        ) : fl.type === 'date' ? (
          <label key={fl.key}>{fl.label}<input type="date" value={a[fl.key] || ''} onChange={(e) => set(fl.key)(e.target.value)} /></label>
        ) : (
          <GuInput key={fl.key} label={fl.label} value={a[fl.key]} onChange={set(fl.key)} multiline={fl.multiline} inputMode={fl.inputMode} className={fl.mono ? 'mono' : undefined} />
        ))}
        <div className="row2">
          <label>Ownership
            <select value={a.holding} onChange={(e) => set('holding')(e.target.value)}>
              <option value="single">Owned alone (એકલ)</option><option value="joint">Jointly owned (સંયુક્ત)</option>
            </select>
          </label>
          <GuInput label="Nominee (if any)" value={a.nominee} onChange={set('nominee')} />
        </div>
        {a.holding === 'joint' && <GuInput label="Jointly owned with" value={a.jointWith} onChange={set('jointWith')} hint="The will can only pass on the will-maker's own share." />}
        <div className="form-field">
          <span className="muted small">Who gets it (લાભાર્થી)</span>
          <SharesEditor people={doc.people} shares={a.shares} onChange={set('shares')} />
        </div>
        <GuInput label="Extra note printed with this asset (optional)" value={a.note} onChange={set('note')} multiline />
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </div>
  )
}
