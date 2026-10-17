import { durLabel, rs, sessionEnd, sessionTotal, timeLabel } from '../../lib/shop'
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

// A sheet of actions for one row (tap a customer / booking / staff card): a header, optional details, a grid
// of secondary actions and one primary action at the bottom. Keeps the lists themselves to one button each.
export function ActionSheet({ title, sub, onClose, children, primary }) {
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal gx-actsheet" onMouseDown={(e) => e.stopPropagation()}>
        <div>
          <h3 style={{ marginBottom: 2 }}>{title}</h3>
          {sub && <div className="muted small">{sub}</div>}
        </div>
        {children}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          {primary}
        </div>
      </div>
    </div>
  )
}
export function ActionGrid({ items }) {
  return (
    <div className="gx-actgrid">
      {items.filter(Boolean).map(({ label, icon, onClick, href, danger }) => href
        ? <a key={label} className={`gx-act ${danger ? 'danger' : ''}`} href={href}>{icon}<span>{label}</span></a>
        : <button type="button" key={label} className={`gx-act ${danger ? 'danger' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>)}
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

// Owner (13 Oct): tap a session line (Cash → Today, Today → Sessions) to see what the bill was made of.
export function SessionBreakdown({ s }) {
  const n = (v) => Number(v) || 0
  const rows = [
    [`Game · ${durLabel(n(s.base_minutes) || n(s.minutes))}${n(s.players) > 1 ? ` × ${s.players} players` : ''}${s.happy ? ' · happy hours' : ''}`, n(s.gaming_amount)],
    [`Extend · ${durLabel(Math.max(0, n(s.minutes) - n(s.base_minutes)))}`, n(s.extend_amount)],
    ['F&B before gaming', n(s.fnb_before)],
    ['F&B while playing', n(s.fnb_while)],
    ['Discount', -n(s.discount)],
  ].filter(([, v]) => v)
  const paid = [['Paid cash', n(s.paid_cash)], ['Paid online', n(s.paid_online)], ['From deposit', n(s.paid_deposit)], ['Owes', n(s.owed)]].filter(([, v]) => v)
  return (
    <div className="gx-breakdown">
      {rows.map(([l, v]) => <SumRow key={l} label={l} value={`${v < 0 ? '−' : ''}${rs(Math.abs(v))}`} />)}
      <SumRow strong label="Bill" value={rs(sessionTotal(s))} />
      {paid.map(([l, v]) => <SumRow key={l} label={l} value={rs(v)} tone={l === 'Owes' ? 'neg' : undefined} />)}
      <div className="muted small">{inOut(s)}{s.collected_at && s.ended_at && new Date(s.collected_at) - new Date(s.ended_at) > 20 * 60_000 ? ` · collected ${new Date(s.collected_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${timeLabel(s.collected_at)}` : ''}{s.entered_by ? ` · started by ${s.entered_by}` : ''}{s.handled_by && s.handled_by !== s.entered_by ? ` · ended by ${s.handled_by}` : ''}{s.customer_phone ? ` · ${s.customer_phone}` : ''}</div>
    </div>
  )
}
// "3:25 pm – 5:25 pm": in and out (owner: both, not only one time).
export const inOut = (s) => s.waiting ? `saved ${timeLabel(s.started_at)} · not started` : `${timeLabel(s.started_at)} – ${s.ended_at ? timeLabel(s.ended_at) : s.status === 'running' ? `ends ${timeLabel(sessionEnd(s))}` : '…'}`
