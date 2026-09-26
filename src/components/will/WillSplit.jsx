import { allocations, isMinor, personById, uid } from '../../lib/willModel'
import { assetDescription } from '../../lib/willText'
import { ASSET_TYPE } from '../../lib/willModel'
import { SharesEditor, GuInput } from './WillParts'
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
        <h3>Who gets what</h3>
        <p className="muted small" style={{ marginTop: -6 }}>Everything each person receives under this will: the transparency view for the family.</p>
        <div className="summary-grid">
          {doc.people.map((p) => {
            const items = alloc[p.id]
            return (
              <div className="summary-person" key={p.id}>
                <div className="summary-name">{p.name} <span className="muted small">{p.relation}{isMinor(p) ? ' · minor' : ''}</span></div>
                {items.length ? (
                  <ul>
                    {items.map((x, i) => (
                      <li key={i}>
                        {x.residuary ? <b>Everything else (બાકી મિલકત)</b> : <>{assetDescription(x.asset) || ASSET_TYPE[x.asset.type].en} <span className="muted small">· {ASSET_TYPE[x.asset.type].en}</span></>}
                        <span className="summary-pct">{x.percent}%</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted small" style={{ margin: 0 }}>Receives nothing under this will.</p>}
              </div>
            )
          })}
          {!doc.people.length && <p className="muted small">Add family members and assets to see the split.</p>}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Everything else (બાકી રહેતી મિલકત)</h3>
          <p className="muted small" style={{ marginTop: -6 }}>Anything not listed in Assets, or received after the will is signed, goes to:</p>
          <SharesEditor people={doc.people} shares={doc.residuary} onChange={(residuary) => update((d) => ({ ...d, residuary }))} />
        </div>

        <div className="card">
          <h3>Executors (અમલકર્તા)</h3>
          <p className="muted small" style={{ marginTop: -6 }}>Carry out the will, in this order of priority. The next one steps in only if the one before can't.</p>
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
            <option value="">+ Add executor…</option>
            {doc.people.filter((p) => !doc.executors.includes(p.id) && !isMinor(p)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.relation})</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <h3>Wishes (ઇચ્છાઓ)</h3>
        <p className="muted small" style={{ marginTop: -6 }}>Guidance for the family, e.g. taking care of each other. These don't give away property; use Assets and "Everything else" for that.</p>
        {doc.wishes.map((w, i) => (
          <div className="wish-row" key={w.id}>
            <GuInput label={`Wish ${i + 1}`} value={w.text} multiline onChange={(text) => update((d) => ({ ...d, wishes: d.wishes.map((x) => (x.id === w.id ? { ...x, text } : x)) }))} />
            <button className="btn icon" aria-label="Remove wish" onClick={() => update((d) => ({ ...d, wishes: d.wishes.filter((x) => x.id !== w.id) }))}><TrashIcon /></button>
          </div>
        ))}
        <button className="btn small ghost" onClick={() => update((d) => ({ ...d, wishes: [...d.wishes, { id: uid(), text: '' }] }))}>+ Add wish</button>
      </div>
    </section>
  )
}
