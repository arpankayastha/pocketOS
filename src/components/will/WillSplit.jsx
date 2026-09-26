import { allocations, isMinor, personById, uid } from '../../lib/willModel'
import { assetDescription } from '../../lib/willText'
import { ASSET_TYPE } from '../../lib/willModel'
import { SharesEditor, GuInput, Help } from './WillParts'
import { TrashIcon } from '../../lib/icons'

export default function WillSplit({ doc, update }) {
  const alloc = allocations(doc)
  const addExecutor = (id) => id && update((d) => ({ ...d, executors: [...d.executors, id] }))
  const moveExec = (i, dir) => update((d) => {
    const ex = [...d.executors]; const j = i + dir
    if (j < 0 || j >= ex.length) return d
    ;[ex[i], ex[j]] = [ex[j], ex[i]]
    return { ...d, executors: ex }
  })

  return (
    <section>
      <div className="card">
        <h3>કોને શું મળશે · Who gets what</h3>
        <Help>આ વસિયતનામા મુજબ દરેક વ્યક્તિને શું શું મળશે — આખા કુટુંબને એક નજરમાં સ્પષ્ટ દેખાય તે માટે.</Help>
        <div className="summary-grid">
          {doc.people.map((p) => {
            const items = alloc[p.id]
            return (
              <div className="summary-person" key={p.id}>
                <div className="summary-name">{p.name} <span className="muted small">{p.relation}{isMinor(p) ? ' · સગીર' : ''}</span></div>
                {items.length ? (
                  <ul>
                    {items.map((x, i) => (
                      <li key={i}>
                        {x.residuary ? <b>બાકી રહેતી બધી મિલકત</b> : <>{assetDescription(x.asset) || ASSET_TYPE[x.asset.type].gu}</>}
                        <span className="summary-pct">{x.percent}%</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted small" style={{ margin: 0 }}>આ વસિયતનામામાં કંઈ આપેલ નથી.</p>}
              </div>
            )
          })}
          {!doc.people.length && <p className="muted small">કુટુંબ અને મિલકત ઉમેર્યા પછી અહીં દેખાશે.</p>}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>બાકી રહેતી મિલકત · Everything else</h3>
          <Help>"મિલકત" ટેબમાં લખવાની રહી ગયેલી કે સહી કર્યા પછી મળેલી કોઈપણ મિલકત કોને મળશે. આ ખૂબ જરૂરી છે — નહીં તો એવી મિલકત કાયદા મુજબ વહેંચાય.</Help>
          <SharesEditor people={doc.people} shares={doc.residuary} onChange={(residuary) => update((d) => ({ ...d, residuary }))} />
          <div className="note-box" style={{ marginTop: 12 }}>
            <GuInput label="ખાસ સૂચના · Special instruction" value={doc.residuaryNote} multiline onChange={(v) => update((d) => ({ ...d, residuaryNote: v }))}
              hint="બાકી મિલકત વિશે કોઈ ખાસ ઇચ્છા હોય તો. ધ્યાન રાખો કે તે ઉપરની ટકાવારી સાથે મેળ ખાય." />
          </div>
        </div>

        <div className="card">
          <h3>અમલકર્તા · Executors</h3>
          <Help>મારા પછી આ વસિયતનામા મુજબ બધું વહેંચવાની જવાબદારી જેમની રહેશે. પહેલી વ્યક્તિ ન કરી શકે તો જ બીજી વ્યક્તિ કરશે.</Help>
          {doc.executors.map((id, i) => (
            <div className="line" key={id}>
              <span>{i + 1}. {personById(doc, id)?.name}</span>
              <span className="reorder">
                <button className="btn icon" aria-label="Move up" disabled={i === 0} onClick={() => moveExec(i, -1)}>↑</button>
                <button className="btn icon" aria-label="Move down" disabled={i === doc.executors.length - 1} onClick={() => moveExec(i, 1)}>↓</button>
                <button className="btn icon" aria-label="Remove" onClick={() => update((d) => ({ ...d, executors: d.executors.filter((x) => x !== id) }))}><TrashIcon /></button>
              </span>
            </div>
          ))}
          <select value="" onChange={(e) => addExecutor(e.target.value)} style={{ marginTop: 10 }}>
            <option value="">+ અમલકર્તા ઉમેરો…</option>
            {doc.people.filter((p) => !doc.executors.includes(p.id) && !isMinor(p)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.relation})</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <h3>મારી ઇચ્છાઓ · Wishes</h3>
        <Help>કુટુંબ માટે માર્ગદર્શન, દા.ત. એકબીજાનું ધ્યાન રાખવું, પ્રસંગો સાથે ઉજવવા. અહીં મિલકત વહેંચવાની વાત ન લખવી — તે માટે "મિલકત" અને "બાકી મિલકત" વાપરો.</Help>
        {doc.wishes.map((w, i) => (
          <div className="wish-row" key={w.id}>
            <GuInput label={`ઇચ્છા ${i + 1}`} value={w.text} multiline onChange={(text) => update((d) => ({ ...d, wishes: d.wishes.map((x) => (x.id === w.id ? { ...x, text } : x)) }))} />
            <button className="btn icon" aria-label="Remove wish" onClick={() => update((d) => ({ ...d, wishes: d.wishes.filter((x) => x.id !== w.id) }))}><TrashIcon /></button>
          </div>
        ))}
        <button className="btn small ghost" onClick={() => update((d) => ({ ...d, wishes: [...d.wishes, { id: uid(), text: '' }] }))}>+ ઇચ્છા ઉમેરો</button>
      </div>
    </section>
  )
}
