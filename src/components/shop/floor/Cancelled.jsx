import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { rs, shortCode, timeLabel } from '../../../lib/shop'
import { ActionGrid, ActionSheet } from '../ui'
import { PhoneIcon } from '../../../lib/icons'
import { timeHistory } from './common'

// Owner, 6 Nov ("cancel booking karne pe history me dikhata hai kya?"): cancelled slot bookings stay in the records
// (status 'cancelled', cancelled_at / cancelled_by / cancelled_from (the status before) stamped by trigger shop_bookings_cancelled_by) and are listed here —
// Slots → Calendar per day, Admin → Bookings & events → Cancelled per month.
const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const money = (b) => (b.source === 'counter'
  ? (Number(b.paid) > 0 ? `${rs(b.paid)} advance (${b.paid_mode}) · stays as their deposit` : 'nothing paid')
  : b.cancelled_from === 'requested' ? `${rs(b.amount)} online · payment not received (Not received)`
    : b.cancelled_from ? `${rs(b.amount)} paid online · non-refundable` : `${rs(b.amount)} online`)

export function CancelledBookings({ householdId, systems = [], from, to, kind, title = 'Cancelled', version, empty }) {
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)
  useEffect(() => {
    let live = true
    let q = supabase.from('shop_bookings').select('*').eq('household_id', householdId).eq('status', 'cancelled')
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at', { ascending: false })
    if (kind) q = q.eq('kind', kind)
    q.then(({ data }) => { if (live) setList(data || []) })
    return () => { live = false }
  }, [householdId, from.getTime(), to.getTime(), kind, version]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!list || (!list.length && !empty)) return null
  const where = (b) => (b.kind === 'PS' ? 'PS5' : systems.find((x) => x.id === b.system_id)?.name || 'PC')
  return (
    <div className="card gx-bookings">
      <div className="card-head"><h3>{title} <span className="muted">{list.length}</span></h3></div>
      {!list.length ? <div className="muted small">{empty}</div> : list.map((b) => (
        <div key={b.id} className="gx-brow" role="button" tabIndex={0} onClick={() => setOpen(b)}>
          <span className={`gx-badge sm ${b.kind === 'PS' ? 'ps' : ''}`}>{where(b)}</span>
          <div className="gx-run-main">
            <div className="gx-name">{b.customer_name}{b.players > 1 ? <span className="muted"> · {b.players}</span> : ''}</div>
            <div className="muted small">{new Date(b.starts_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {timeLabel(b.starts_at)} – {timeLabel(new Date(b.starts_at).getTime() + b.minutes * 60_000)} · cancelled{b.cancelled_by ? ` by ${b.cancelled_by}` : ''}</div>
          </div>
          <span className="pill gx-pill">Cancelled</span>
        </div>
      ))}
      {open && (
        <ActionSheet title={`${open.customer_name} · cancelled`} sub={`${new Date(open.starts_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · ${timeLabel(open.starts_at)} – ${timeLabel(new Date(open.starts_at).getTime() + open.minutes * 60_000)}`} onClose={() => setOpen(null)}>
          <div className="gx-details">
            {[['Cancelled', open.cancelled_at ? `${when(open.cancelled_at)}${open.cancelled_by ? ` · by ${open.cancelled_by}` : ''}` : 'before 6 Nov (who / when not recorded)'],
              ['Where', where(open)], ['Players', open.players > 1 ? String(open.players) : null], ['Amount', rs(open.amount)], ['Money', money(open)],
              ...timeHistory(open), ['Mobile', open.customer_phone], ['Booked', `${when(open.created_at)} · ${open.source === 'online' ? 'online' : `by ${open.entered_by || 'staff'}`}`], ['Note', open.note], ['Code', shortCode(open.id)]]
              .filter(([, v]) => v).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
          </div>
          {open.customer_phone && <ActionGrid items={[{ label: 'Call', icon: <PhoneIcon />, href: `tel:${open.customer_phone}` }]} />}
        </ActionSheet>
      )}
    </div>
  )
}
