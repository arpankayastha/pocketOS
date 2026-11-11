import { useState } from 'react'
import { Chips } from '../shop/ui'
import Floor from '../shop/Floor'
import Events from '../shop/Events'
import { CancelledBookings } from '../shop/floor/Cancelled'
import { MonthPicker } from './MonthPicker'
import { pendingArrival } from '../../lib/shop'

// Portal → Bookings & events: online payments to confirm + the booking calendar (+ Book, change time, cancel,
// Arrived), then the events (GTA VI slots, tournaments).
export default function BookingsSection({ shop, householdId, toast }) {
  const [view, setView] = useState('slots')
  const [offset, setOffset] = useState(0)
  const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0); from.setMonth(from.getMonth() + offset)
  const to = new Date(from); to.setMonth(to.getMonth() + 1)
  return (
    <section className="admin-sec">
      <Chips options={[['slots', 'Slot bookings'], ['events', 'Events & tournaments'], ['cancelled', 'Cancelled']]} value={view} onChange={setView} />
      {view === 'cancelled' ? (<div className="gx admin-embed">
        <div className="admin-month-row"><MonthPicker offset={offset} setOffset={setOffset} label={from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} /></div>
        <CancelledBookings householdId={householdId} systems={shop.systems} from={from} to={to} title="Cancelled slot bookings" empty="No cancelled bookings this month." />
      </div>) : view === 'slots' ? <div className="gx admin-embed"><Floor shop={shop} householdId={householdId} toast={toast} fixedView="calendar" /></div>
        : <div className="gx admin-embed"><Events householdId={householdId} admin settings={shop.settings} toast={toast} onArrived={(x) => { pendingArrival.current = x; setView('slots') }} /></div>}
    </section>
  )
}
