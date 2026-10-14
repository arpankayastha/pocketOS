import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCustomerSession } from './PublicNav'

// Name + mobile on the public booking forms (slots, event hours, tournament entry). A signed-in customer
// whose profile already has both isn't asked again (owner, 12 Oct): "Booking as Rahul · 98…" with Change.
export default function ContactFields({ name, setName, phone, setPhone }) {
  const customer = useCustomerSession()
  const [me, setMe] = useState(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!customer) return
    supabase.rpc('public_my_status', { p_bookings: [], p_event_bookings: [], p_entries: [] }).then(({ data }) => {
      const p = data?.me
      if (!p?.phone) return
      setMe(p)
      setName((v) => v || p.name || ''); setPhone((v) => v || p.phone)
    })
  }, [customer?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (me && !editing) return (
    <div className="contact-me">
      <span className="grow">Booking as <b>{name}</b> · <span className="mono">{phone}</span></span>
      <button type="button" className="btn link" onClick={() => setEditing(true)}>Change</button>
    </div>
  )
  return (
    <div className="grid2">
      <label><span>Name <span className="req">*</span></span><input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
      <label><span>Mobile <span className="req">*</span></span><input required value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))} inputMode="tel" autoComplete="tel" placeholder="10 digits" /></label>
    </div>
  )
}
