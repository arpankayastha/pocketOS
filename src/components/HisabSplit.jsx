import { useState } from 'react'
import { money } from '../lib/format'
import { addRow, mergeSameCategory, splitStatus, startRows } from '../lib/splitLogic'
import AmountInput from './AmountInput'

// Split one bill across categories (groceries and household on one receipt). The rows must add up to the total on the
// bill; Done hands them back to the entry sheet, which saves one entry per row.
export default function SplitSheet({ total, dir, cats, picked, initial, onDone, onClose }) {
  const names = cats.map((c) => c.name)
  const [rows, setRows] = useState(() => initial || startRows(total, names, picked))
  const st = splitStatus(total, rows)
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const optionsFor = (current) => (names.includes(current) ? names : [current, ...names])

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal hb-split" role="dialog" aria-label="Split the payment">
        <div className="hb-split-head">
          <div>
            <h3 style={{ margin: 0 }}>Split the payment</h3>
            <div className="muted small">Total on the bill · <b>{money(total)}</b> {dir === 'out' ? 'spent' : 'received'}</div>
          </div>
          <button type="button" className="btn small ghost" onClick={onClose}>Cancel</button>
        </div>

        <div className="hb-split-rows">
          {rows.map((r, i) => (
            <div key={i} className="hb-split-row">
              <select value={r.category} onChange={(e) => set(i, { category: e.target.value })} aria-label={`Category ${i + 1}`}>
                {optionsFor(r.category).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <AmountInput value={r.amount === '' ? '' : String(r.amount)} onChange={(e) => set(i, { amount: e.target.value })} aria-label={`Amount for ${r.category}`} placeholder="0" />
              {rows.length > 2 && <button type="button" className="btn icon" aria-label={`Remove ${r.category}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
        </div>

        <button type="button" className="btn hb-split-add" onClick={() => setRows((r) => addRow(r, names, st.left))}>＋ Add a category</button>

        <div role="status" className={`hb-split-status ${st.left === 0 ? 'ok' : ''}`}>
          {st.left === 0 ? `All ${money(total)} placed` : st.left > 0 ? `${money(st.left)} left to place` : `Over by ${money(-st.left)}`}
          {st.left > 0 && rows.length > 0 && (
            <button type="button" className="hb-split-fill" onClick={() => set(rows.length - 1, { amount: (Math.round(Number(rows[rows.length - 1].amount || 0) * 100) + Math.round(st.left * 100)) / 100 })}>
              Put it in {rows[rows.length - 1].category}
            </button>
          )}
        </div>

        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Back</button>
          <button type="button" className="btn primary" disabled={!st.ok} onClick={() => onDone(mergeSameCategory(rows))}>Done</button>
        </div>
      </div>
    </div>
  )
}
