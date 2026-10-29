import { useState } from 'react'
import { Chips } from '../shop/ui'
import Floor from '../shop/Floor'
import Events from '../shop/Events'

// Portal → Bookings & events: online payments to confirm + the booking calendar (+ Book, change time, cancel,
// Arrived), then the events (GTA VI slots, tournaments).
export default function BookingsSection({ shop, householdId, toast }) {
  const [view, setView] = useState('slots')
  return (
    <section className="admin-sec">
      <Chips options={[['slots', 'Slot bookings'], ['events', 'Events & tournaments']]} value={view} onChange={setView} />
      {view === 'slots' ? <div className="gx admin-embed"><Floor shop={shop} householdId={householdId} toast={toast} fixedView="calendar" /></div>
        : <div className="gx admin-embed"><Events householdId={householdId} admin settings={shop.settings} toast={toast} /></div>}
    </section>
  )
}
