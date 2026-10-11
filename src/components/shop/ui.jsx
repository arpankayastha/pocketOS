// Small building blocks shared by the Shop screens: a bottom sheet with a form, and a chip row.

export function Sheet({ title, sub, onClose, onSubmit, children }) {
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit?.() }}>
        <div>
          <h3 style={{ marginBottom: 2 }}>{title}</h3>
          {sub && <div className="muted small">{sub}</div>}
        </div>
        {children}
      </form>
    </div>
  )
}

export function Chips({ options, value, onChange, scroll }) {
  return (
    <div className={`chips ${scroll ? 'gx-scroll' : ''}`}>
      {options.map(([v, label]) => (
        <button type="button" key={String(v)} className={`chip chip-btn ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

export function SumRow({ label, value, strong, tone }) {
  return (
    <div className={`gx-sum ${strong ? 'strong' : ''}`}>
      <span className={strong ? '' : 'muted'}>{label}</span>
      <span className={`amt ${tone || ''}`}>{value}</span>
    </div>
  )
}

export function SheetActions({ onClose, label, busy, disabled, danger }) {
  return (
    <div className="actions">
      <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || disabled}>{busy ? 'Saving…' : label}</button>
    </div>
  )
}
