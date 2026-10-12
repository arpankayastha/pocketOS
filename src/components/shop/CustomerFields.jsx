import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Customer name + mobile, with a drop-down of past customers (owner: "typing the name should list everyone by
// that name with their number — we can't keep asking the number"). Type 2+ letters of a name or 3+ digits of
// a mobile; tap a row to fill both. From rpc shop_customer_search (sessions, bookings, deposits, sign-ups).
export default function CustomerFields({ householdId, name, setName, phone, setPhone, autoFocus, phonePlaceholder = 'Optional', required }) {
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const picked = useRef(false)
  const listRef = useRef(null)
  useEffect(() => { if (open && rows.length) listRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [open, rows.length])
  useEffect(() => {
    if (!open || (q.trim().length < 2 && q.replace(/\D/g, '').length < 3)) { setRows([]); return }
    const t = setTimeout(() => {
      supabase.rpc('shop_customer_search', { p_household: householdId, p_q: q }).then(({ data }) => setRows(data || []))
    }, 200)
    return () => clearTimeout(t)
  }, [q, open, householdId])
  const pick = (r) => { picked.current = true; setName(r.name); setPhone(r.phone); setOpen(false); setRows([]) }
  const ago = (d) => {
    const days = Math.floor((Date.now() - new Date(d)) / 86_400_000)
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  }
  const list = open && rows.length > 0 && (
    <div className="gx-cust-list" role="listbox" ref={listRef}>
      {rows.map((r) => (
        <button type="button" key={r.phone} className="gx-cust-row" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
          <span className="grow"><b>{r.name}</b> <span className="mono">{r.phone}</span></span>
          <span className="muted small">{r.visits} visit{r.visits === 1 ? '' : 's'} · {ago(r.last)}</span>
        </button>
      ))}
    </div>
  )
  return (
    <div className="gx-cust">
      <label>Customer<input autoFocus={autoFocus} required={required} value={name} placeholder="Name" autoComplete="off"
        onChange={(e) => { setName(e.target.value); setQ(e.target.value); setOpen(true) }}
        onFocus={() => { if (name && !picked.current) { setQ(name); setOpen(true) } }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} /></label>
      {list}
      <label>Mobile<input required={required} value={phone} placeholder={phonePlaceholder} inputMode="tel" autoComplete="off"
        onChange={(e) => { const v = e.target.value.replace(/[^\d+ ]/g, ''); setPhone(v); setQ(v); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} /></label>
    </div>
  )
}
