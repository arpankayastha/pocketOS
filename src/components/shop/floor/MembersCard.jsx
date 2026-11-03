import { useState } from 'react'
import { hoursLabel2 } from '../../../lib/shop'
import { telLink } from '../../../lib/products'
import { ActionSheet } from '../ui'
import { MemberLine } from './SessionRows'
import { AddMember } from '../../admin/Members'

// Slots → Members (owner, 3 Nov: "slot ke niche membership ki entry alag rakhna · kaun kaun membership me hai"):
// every active plan with its hours left; + Add member for one paid at the counter. Online ones to check stay in Bookings.
export default function MembersCard({ shop, householdId, toast }) {
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState(false)
  const list = [...(shop.members || [])].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="card gx-members">
      <div className="card-head"><h3>Members <span className="muted">{list.length}</span></h3><button className="btn small" onClick={() => setAdding(true)}>+ Add member</button></div>
      {list.length === 0 ? <div className="muted small">No active memberships. Customers join on the website (Membership plans) or here at the counter.</div> : list.map((m) => (
        <button key={m.id} type="button" className="line gx-linebtn" onClick={() => setOpen(m)}>
          <span>★ {m.name} <span className="muted small">· {m.plan_name} · {m.kind === 'PS' ? 'PS5' : 'PC'}</span></span>
          <b className={m.left_minutes ? 'pos' : 'muted'}>{hoursLabel2(m.left_minutes)} left</b>
        </button>
      ))}
      {open && (
        <ActionSheet title={`★ ${open.name}`} sub={open.phone || 'no mobile'} onClose={() => setOpen(null)}
          primary={open.phone ? <a className="btn primary" href={telLink(open.phone)}>Call</a> : null}>
          <MemberLine m={open} />
          <div className="muted small">To use it: Start a session with this name or mobile (or pick it as a friend’s membership) — the time comes off the plan.</div>
        </ActionSheet>
      )}
      {adding && <AddMember shop={shop} householdId={householdId} onClose={() => setAdding(false)} onDone={(msg) => { setAdding(false); toast(msg); shop.reload() }} />}
    </div>
  )
}
