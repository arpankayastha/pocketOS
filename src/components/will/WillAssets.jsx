import { useState } from 'react'
import { ASSET_TYPES, ASSET_TYPE, uid, personById, sumPercent } from '../../lib/willModel'
import { assetDescription } from '../../lib/willText'
import { useDialog } from '../../lib/dialog'
import { GuInput, SharesEditor, Help } from './WillParts'
import { PencilIcon, TrashIcon } from '../../lib/icons'

export default function WillAssets({ doc, update }) {
  const [editing, setEditing] = useState(null) // asset, or { type } for new
  const [adding, setAdding] = useState(false)
  const dialog = useDialog()

  async function remove(a) {
    if (!await dialog.confirm({ title: 'આ મિલકત યાદીમાંથી કાઢવી છે?', message: assetDescription(a).replace(/\u2063/g, '') || ASSET_TYPE[a.type].gu, confirmLabel: 'કાઢો' })) return
    update((d) => ({ ...d, assets: d.assets.filter((x) => x.id !== a.id) }))
  }

  return (
    <section>
      <div className="toolbar">
        <div className="grow">
          <h3 style={{ margin: 0 }}>મિલકત · Assets</h3>
          <Help>દરેક મિલકત (મકાન, બેંક ખાતું, FD, LIC, દાગીના…) અને તે કોને મળશે. જે અહીં લખવાનું રહી જાય તે "વહેંચણી" ટેબના "બાકી મિલકત" નિયમ મુજબ વહેંચાશે.</Help>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ મિલકત ઉમેરો</button>
      </div>
      {ASSET_TYPES.filter((t) => doc.assets.some((a) => a.type === t.id)).map((t) => (
        <div className="card list" key={t.id}>
          <div className="list-head">{t.gu} <span className="muted small">· {t.en}</span></div>
          {doc.assets.filter((a) => a.type === t.id).map((a) => {
            const total = sumPercent(a.shares)
            return (
              <div className="txn" key={a.id}>
                <button type="button" className="line-btn grow" onClick={() => setEditing(a)}>
                  <div>{assetDescription(a) || <span className="muted">વિગત બાકી</span>}</div>
                  <div className="muted small">
                    {a.shares.map((s) => `${personById(doc, s.personId)?.name || '?'} ${s.percent}%`).join(' · ') || 'હજુ કોઈને આપેલ નથી'}
                    {a.shares.length > 0 && Math.abs(total - 100) > 0.01 && <span className="neg"> · કુલ {total}%</span>}
                    {a.holding === 'joint' && ' · સંયુક્ત'}{a.note?.trim() && ' · ખાસ સૂચના'}
                  </div>
                </button>
                <button className="btn icon" aria-label="Edit" onClick={() => setEditing(a)}><PencilIcon /></button>
                <button className="btn icon" aria-label="Remove" onClick={() => remove(a)}><TrashIcon /></button>
              </div>
            )
          })}
        </div>
      ))}
      {!doc.assets.length && <div className="card"><p className="muted" style={{ margin: 0 }}>હજુ કોઈ મિલકત ઉમેરી નથી. મકાન, બેંક ખાતાં, FD, LIC, દાગીના વગેરે ઉમેરો.</p></div>}

      {adding && (
        <div className="modal-bg" onMouseDown={() => setAdding(false)}>
          <div className="card modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>કઈ પ્રકારની મિલકત? · What kind?</h3>
            <div className="type-list">
              {ASSET_TYPES.map((t) => (
                <button key={t.id} className="type-option" onClick={() => { setAdding(false); setEditing({ type: t.id }) }}>
                  <span>{t.gu}<span className="muted small"> · {t.en}</span></span>
                </button>
              ))}
            </div>
            <div className="actions"><button className="btn ghost" onClick={() => setAdding(false)}>રદ કરો</button></div>
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
          <GuInput key={fl.key} label={fl.label} value={a[fl.key]} onChange={set(fl.key)} multiline={fl.multiline} inputMode={fl.inputMode} className={fl.mono ? 'mono' : undefined} placeholder={fl.placeholder} hint={fl.hint} />
        ))}
        <div className="row2">
          <label>માલિકી · Ownership
            <select value={a.holding} onChange={(e) => set('holding')(e.target.value)}>
              <option value="single">એકલ (ફક્ત પોતાના નામે)</option><option value="joint">સંયુક્ત (બીજા સાથે)</option>
            </select>
          </label>
          <GuInput label="નોમિની · Nominee" value={a.nominee} onChange={set('nominee')} hint="બેંક / LICમાં નોંધાવેલ નોમિની. ન હોય તો ખાલી." />
        </div>
        {a.holding === 'joint' && <GuInput label="કોની સાથે સંયુક્ત · Joint with" value={a.jointWith} onChange={set('jointWith')} hint="વસિયતનામાથી ફક્ત પોતાનો હિસ્સો જ આપી શકાય." />}
        <div className="form-field">
          <span className="muted small">કોને મળશે · Who gets it</span>
          <span className="help">એક કે વધુ વ્યક્તિ પસંદ કરો અને દરેકને કેટલા ટકા મળે તે લખો. કુલ ૧૦૦% થવું જોઈએ.</span>
          <SharesEditor people={doc.people} shares={a.shares} onChange={set('shares')} />
        </div>
        <div className="note-box">
          <GuInput label="ખાસ સૂચના · Special instruction" value={a.note} onChange={set('note')} multiline
            placeholder="દા.ત. મારા પછી આ ફ્લેટ પુત્રવધૂના નામે પ્રથમ નામ તરીકે ટ્રાન્સફર કરવો."
            hint="આ મિલકત વિશે કોઈ ખાસ ઇચ્છા કે શરત હોય તો અહીં લખો. PDFમાં આ મિલકતની નીચે અલગથી છપાશે." />
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>રદ કરો</button>
          <button className="btn primary">સાચવો</button>
        </div>
      </form>
    </div>
  )
}
