import { sumPercent } from '../../lib/willModel'
import { TrashIcon, PlusIcon } from '../../lib/icons'

// Text input bound to a value; `lang="gu"` hints Gujarati keyboards/spellcheck.
// `label` is Gujarati first (e.g. "નામ · Name"); `hint` explains the field in plain Gujarati.
export function GuInput({ label, value, onChange, multiline, hint, ...rest }) {
  const props = { value: value ?? '', onChange: (e) => onChange(e.target.value), lang: 'gu', ...rest }
  return (
    <label>{label}
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
      {hint && <span className="help">{hint}</span>}
    </label>
  )
}

// A short plain-language explanation under a heading, so the family knows what a section means.
export function Help({ children }) {
  return <p className="help">{children}</p>
}

// Who gets an asset (or the residuary): rows of person + percent, with a running total.
export function SharesEditor({ people, shares, onChange }) {
  const total = sumPercent(shares)
  const used = new Set(shares.map((s) => s.personId))
  const free = people.filter((p) => !used.has(p.id))
  const set = (i, patch) => onChange(shares.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  function splitEqually() {
    if (!shares.length) return
    const base = Math.floor((100 / shares.length) * 100) / 100
    const last = Math.round((100 - base * (shares.length - 1)) * 100) / 100
    onChange(shares.map((s, i) => ({ ...s, percent: i === shares.length - 1 ? last : base })))
  }

  return (
    <div className="shares">
      {shares.map((s, i) => (
        <div className="share-row" key={s.personId}>
          <select value={s.personId} onChange={(e) => set(i, { personId: e.target.value })} aria-label="Person">
            {people.filter((p) => p.id === s.personId || !used.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.relation})</option>)}
          </select>
          <div className="pct"><input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={s.percent} onChange={(e) => set(i, { percent: e.target.value })} aria-label="Percent" /><span>%</span></div>
          <button type="button" className="btn icon" aria-label="Remove" onClick={() => onChange(shares.filter((_, j) => j !== i))}><TrashIcon /></button>
        </div>
      ))}
      <div className="share-actions">
        {free.length > 0 && (
          <button type="button" className="btn small ghost" onClick={() => onChange([...shares, { personId: free[0].id, percent: shares.length ? 0 : 100 }])}><PlusIcon /> વ્યક્તિ ઉમેરો · Add person</button>
        )}
        {shares.length > 1 && <button type="button" className="btn small ghost" onClick={splitEqually}>સરખા ભાગે · Split equally</button>}
        {shares.length > 0 && <span className={`share-total ${Math.abs(total - 100) > 0.01 ? 'neg' : 'pos'}`}>કુલ {total}%</span>}
      </div>
      {!people.length && <p className="help">પહેલાં "કુટુંબ" ટેબમાં કુટુંબના સભ્યો ઉમેરો. · Add family members first.</p>}
    </div>
  )
}
