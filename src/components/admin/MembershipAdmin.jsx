import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { rs } from '../../lib/shop'
import { hourlyRate, planDiscount } from '../../lib/membership'
import { Collapsible } from '../Settings'

// Admin → Website → Membership plans (owner, 1 Nov): the plans on the public #membership page and the home page's
// "Join Membership Plan" button. Discounts shown to customers are worked out from the rate card.
const blank = { name: '', pass: '', hours: 10, validity: '', pc: 0, ps5: 0 }
export default function MembershipAdmin({ shop, householdId, toast }) {
  const saved = shop.settings?.membership || { on: false, note: '', plans: [] }
  const [m, setM] = useState(saved)
  const [busy, setBusy] = useState(false)
  const setPlan = (i, k, v) => setM({ ...m, plans: m.plans.map((p, j) => (j === i ? { ...p, [k]: v } : p)) })
  const num = (v) => Math.max(0, Number(String(v).replace(/\D/g, '')) || 0)
  const pc = hourlyRate(shop.rates, 'PC'), ps = hourlyRate(shop.rates, 'PS')
  async function save(e) {
    e.preventDefault()
    const plans = m.plans.filter((p) => p.name.trim()).map((p) => ({ ...p, name: p.name.trim(), pass: p.pass.trim(), validity: p.validity.trim() }))
    setBusy(true)
    const { error } = await supabase.from('shop_settings').upsert({ household_id: householdId, membership: { ...m, plans }, updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) toast(error.message); else { toast('Membership plans saved'); shop.reload() }
  }
  return (
    <Collapsible id="gx-membership" title="Membership plans" summary={saved.on ? `${saved.plans?.length || 0} plans on the website` : 'Hidden from the website'}>
      <form className="stack" onSubmit={save}>
        <label className="check"><input type="checkbox" checked={!!m.on} onChange={(e) => setM({ ...m, on: e.target.checked })} /> Show “Join Membership Plan” on the home page</label>
        {m.plans.map((p, i) => (
          <div key={i} className="gx-box member-edit">
            <div className="card-head" style={{ margin: 0 }}><b>Plan {i + 1}</b><button type="button" className="btn link" style={{ color: 'var(--neg)', padding: 0 }} onClick={() => setM({ ...m, plans: m.plans.filter((_, j) => j !== i) })}>Remove</button></div>
            <div className="grid2">
              <label>Name<input value={p.name} onChange={(e) => setPlan(i, 'name', e.target.value)} placeholder="Basic plan" /></label>
              <label>Pass<input value={p.pass} onChange={(e) => setPlan(i, 'pass', e.target.value)} placeholder="Weekly pass" /></label>
              <label>Hours<input inputMode="numeric" value={p.hours} onChange={(e) => setPlan(i, 'hours', num(e.target.value))} /></label>
              <label>Validity<input value={p.validity} onChange={(e) => setPlan(i, 'validity', e.target.value)} placeholder="Weekly validity" /></label>
              <label>PC price ₹<input inputMode="numeric" value={p.pc} onChange={(e) => setPlan(i, 'pc', num(e.target.value))} /></label>
              <label>PS5 price ₹<input inputMode="numeric" value={p.ps5} onChange={(e) => setPlan(i, 'ps5', num(e.target.value))} /></label>
            </div>
            <div className="muted small">{[p.pc && pc && `PC ${rs(Math.round(p.pc / (p.hours || 1)))}/hr · ${planDiscount(p.pc, p.hours, pc) ?? 0}% off`, p.ps5 && ps && `PS5 ${rs(Math.round(p.ps5 / (p.hours || 1)))}/hr · ${planDiscount(p.ps5, p.hours, ps) ?? 0}% off`].filter(Boolean).join(' · ') || 'Set a price for PC or PS5'}</div>
          </div>
        ))}
        <button type="button" className="btn small" style={{ justifySelf: 'start' }} onClick={() => setM({ ...m, plans: [...m.plans, { ...blank }] })}>+ Add plan</button>
        <label>Key benefit (under the plans)<input value={m.note || ''} onChange={(e) => setM({ ...m, note: e.target.value })} placeholder="Add a friend to your plan and share your hours" /></label>
        <div className="gx-btns">
          <button className="btn small primary" disabled={busy}>{busy ? 'Saving…' : 'Save plans'}</button>
          <a className="btn small ghost" href="/#membership" target="_blank" rel="noreferrer">Open page</a>
        </div>
      </form>
    </Collapsible>
  )
}
