import { HomePage, OnlineBooking } from '../shop/ShopSettings'
import ProductsAdmin from '../shop/ProductsAdmin'
import Vacancies from '../shop/Vacancies'

// Portal → Website: everything customers see at grandxgamer.vercel.app in one place — home page picture,
// contact number and social links, PC parts for sale, online booking, job openings. Events are in Bookings & events.
export default function Website({ shop, householdId, toast, onOpen }) {
  return (
    <section className="gx-split even">
      <div className="gx-col">
        <div className="card">
          <div className="card-head"><h3>Your website</h3><a className="btn small" href="/" target="_blank" rel="noreferrer">Open site</a></div>
          <p className="muted small" style={{ margin: 0 }}>Customers see the home page, Book your slots, events, PC parts for sale and job openings. Events and tournaments are set in <a href="#/admin/bookings" onClick={(e) => { e.preventDefault(); onOpen('bookings') }}>Bookings &amp; events</a>.</p>
        </div>
        <HomePage shop={shop} householdId={householdId} toast={toast} />
        <OnlineBooking shop={shop} householdId={householdId} toast={toast} />
      </div>
      <div className="gx-col">
        <ProductsAdmin shop={shop} householdId={householdId} toast={toast} />
        <Vacancies householdId={householdId} toast={toast} />
      </div>
    </section>
  )
}
