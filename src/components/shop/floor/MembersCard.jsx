import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useDialog } from '../../../lib/dialog'
import { hoursLabel2, rs } from '../../../lib/shop'
import { telLink } from '../../../lib/products'
import { ActionSheet } from '../ui'
import { MemberLine } from './SessionRows'
import { AddMember } from '../../admin/Members'

// Slots → Members (owner, 3 Nov: "slot ke niche membership ki entry alag rakhna · kaun kaun membership me hai"):
// every active plan with its hours left; + Add member for one paid at the counter. Online ones to check stay in Bookings.
// Owner, 4 Nov: a member's entry starts only from here (so staff can't forget the plan): tap the member → pick a
// free PC / PS5 like Free now → the Start sheet opens with the plan already picked and no Payment choice.
// Live status stays in Slots → Playing.
export default function MembersCard({ shop, householdId, toast, freeTiles = [], onStart }) {
  const [open, setOpen] = useState(null)
  const dialog = useDialog()
  async function remove(m) {
    if (!await dialog.confirm({ title: `Delete ${m.name}’s ${m.plan_name}?`, message: `For one added by mistake or as a test. ${rs(m.amount)} comes off the day it was paid; it's kept as cancelled.`, confirmLabel: 'Delete', danger: true })) return
    const { error } = await supabase.from('shop_memberships').update({ status: 'cancelled' }).eq('id', m.id)
    if (error) { toast(error.message); return }
    setOpen(null); toast('Membership deleted'); shop.reload()
  }
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
      {open && (() => {
        const tiles = freeTiles.filter((t) => t.sys.kind === open.kind)
        return (
          <ActionSheet title={`★ ${open.name}`} sub={`${open.plan_name} · ${open.kind === 'PS' ? 'PS5' : 'PC'}${open.phone ? ` · ${open.phone}` : ''}`} onClose={() => setOpen(null)}
            primary={open.phone ? <a className="btn" href={telLink(open.phone)}>Call</a> : null}>
            <MemberLine m={open} />
            <div className="caps muted">Start · pick a free {open.kind === 'PS' ? 'PS5' : 'PC'}</div>
            {!open.left_minutes ? <div className="muted small">No hours left on this plan.</div>
              : tiles.length === 0 ? <div className="muted small">No {open.kind === 'PS' ? 'PS5 controller' : 'PC'} free right now.</div> : (
              <div className="gx-freegrid">
                {tiles.map((t) => (
                  <button key={t.sys.id} type="button" className={`gx-freetile ${t.sys.kind === 'PS' ? 'ps' : ''}`} onClick={() => { const m = open; setOpen(null); onStart?.(t.sys, t.seats.slice(0, 1), m) }}>
                    <b>{t.sys.name}</b><span>{t.sub}</span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn danger-ghost" onClick={() => remove(open)}>Delete membership (added by mistake)</button>
          </ActionSheet>
        )
      })()}
      {adding && <AddMember shop={shop} householdId={householdId} onClose={() => setAdding(false)} onDone={(msg) => { setAdding(false); toast(msg); shop.reload() }} />}
    </div>
  )
}
