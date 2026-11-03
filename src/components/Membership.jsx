import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hoursLabel2, rs } from '../lib/shop'
import { hourlyRate, planDiscount } from '../lib/membership'
import { signInWithGoogle } from '../lib/mine'
import { telLink } from '../lib/products'
import PublicNav, { useCustomerSession } from './PublicNav'
import { PayCard } from './EventPage'
import ContactFields from './ContactFields'

// Public page #membership (owner, 1 + 3 Nov: "Join Membership Plan" on the home page; the customer signs in, pays
// by UPI and the shop sees it in its list like a booking — rpc public_membership_join; staff Received starts it).
const day = (d) => new Date(`${d}T00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function Membership() {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const customer = useCustomerSession()
  const [mine, setMine] = useState([])
  const loadMine = useCallback(() => { if (customer) supabase.rpc('my_memberships').then(({ data }) => setMine(data || [])) }, [customer])
  useEffect(() => { supabase.rpc('public_home').then(({ data, error }) => (error ? setError(error.message) : setInfo(data))) }, [])
  useEffect(() => { loadMine() }, [loadMine])
  const [pick, setPick] = useState(null) // { i, kind }
  const [ref, setRef] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [payError, setPayError] = useState(null)
  const [done, setDone] = useState(null)
  const m = info?.membership
  const pc = hourlyRate(info?.rates, 'PC'), ps = hourlyRate(info?.rates, 'PS')
  const plan = pick && m?.plans?.[pick.i]
  const price = plan ? (pick.kind === 'PS' ? plan.ps5 : plan.pc) : 0
  // Owner, 3 Nov: name + mobile required on the payment, like a booking (prefilled from the account).
  const contactOk = name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10

  async function send() {
    setBusy(true); setPayError(null)
    if (!contactOk) { setPayError('Enter your name and 10-digit mobile number.'); return }
    const { data, error } = await supabase.rpc('public_membership_join', { p_plan: pick.i, p_kind: pick.kind, p_upi_ref: ref.trim() || null, p_name: name.trim(), p_phone: phone })
    setBusy(false)
    if (error) { setPayError(error.message); return }
    setDone({ ...data, plan: plan.name, kind: pick.kind }); setPick(null); setRef(''); loadMine()
  }
  const join = (i, kind) => { setDone(null); if (!customer) { signInWithGoogle('#membership'); return } setPick({ i, kind }); window.scrollTo({ top: 0 }) }

  return (
    <div className="pub-page member-page">
      <PublicNav active="membership" />
      <a className="pub-back" href="#">‹ Home</a>
      {plan ? (<>
        <div className="card stack" style={{ margin: 0 }}><b>Your details</b><ContactFields name={name} setName={setName} phone={phone} setPhone={setPhone} /></div>
        <PayCard amount={price} info={info} note={`Membership ${plan.name} ${pick.kind === 'PS' ? 'PS5' : 'PC'}`} what={`${plan.name} · ${pick.kind === 'PS' ? 'PS5' : 'PC'} · ${plan.hours} hours · ${plan.validity || `${plan.days} days`}`}
          refValue={ref} setRef={setRef} onBack={() => setPick(null)} busy={busy} error={payError} onSend={send}
          footer="Your plan starts when the shop sees your payment. Membership fees are non-refundable." />
      </>) : (<>
        <header className="member-head">
          <div className="home-kicker">GRANDXGAMER</div>
          <h1>Choose your gaming <span>membership plan</span></h1>
          <p className="muted">Join today and get special membership benefits.</p>
        </header>
        {error && <div className="alert error">{error}</div>}
        {done && <div className="card member-done"><b>Payment sent · code {done.code}</b><span>The shop confirms your {done.plan} ({done.kind === 'PS' ? 'PS5' : 'PC'}) once the {rs(done.amount)} shows up. It starts then.</span></div>}
        {mine.length > 0 && (
          <div className="card member-mine">
            <b>My membership</b>
            {mine.map((x) => (
              <div key={x.id} className="line"><span>{x.plan} · {x.kind === 'PS' ? 'PS5' : 'PC'}{x.status === 'active' ? ` · played ${hoursLabel2(x.used_minutes)} of ${x.hours} h` : ''}</span>
                {(() => {
                  const left = Math.max(0, x.hours * 60 - x.used_minutes)
                  if (x.status !== 'active') return <b>Payment being checked</b>
                  if (x.ends_on && x.ends_on < new Date().toLocaleDateString('en-CA')) return <b className="muted">Ended {day(x.ends_on)}</b>
                  if (!left) return <b className="muted">All hours played</b>
                  return <b className="pos">{hoursLabel2(left)} left · till {day(x.ends_on)}</b>
                })()}</div>
            ))}
          </div>
        )}
        {!info ? <div className="card muted">Loading…</div> : !m ? <div className="card muted">Membership plans are coming soon. Ask at the counter.</div> : (<>
          <div className="member-plans">
            {(m.plans || []).map((p, i) => {
              const dPc = planDiscount(p.pc, p.hours, pc), dPs = planDiscount(p.ps5, p.hours, ps)
              return (
                <article key={i} className="card member-plan">
                  <div className="member-num">{String(i + 1).padStart(2, '0')}.</div>
                  <div className="member-main">
                    <h2>{p.name}</h2>
                    {p.pass && <div className="member-pass">{p.pass}</div>}
                    <div className="member-prices">
                      {p.pc > 0 && <div><span>PC</span><b>{rs(p.pc)}</b><em>{p.hours} hours</em></div>}
                      {p.ps5 > 0 && <div><span>PS5</span><b>{rs(p.ps5)}</b><em>{p.hours} hours</em></div>}
                    </div>
                  </div>
                  <ul className="member-incl">
                    <li>{p.hours} hours play time</li>
                    {p.validity && <li>{p.validity}</li>}
                    {dPc && p.pc > 0 && <li>Get {dPc}% discount for PC</li>}
                    {dPs && p.ps5 > 0 && <li>Get {dPs}% discount for PS5</li>}
                  </ul>
                  <div className="member-cta">
                    {p.pc > 0 && <button className="btn primary" onClick={() => join(i, 'PC')}>Pay {rs(p.pc)} · PC</button>}
                    {p.ps5 > 0 && <button className="btn" onClick={() => join(i, 'PS')}>Pay {rs(p.ps5)} · PS5</button>}
                  </div>
                </article>
              )
            })}
          </div>
          {!customer && <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>You sign in with Google first, so your membership is saved to your account.</p>}
          {m.note && <div className="card member-note"><b>Membership key benefit</b><span>{m.note}</span></div>}
          {info.phone && <div className="member-contact muted small">Questions? <a href={telLink(info.phone)}>Call {info.phone}</a></div>}
        </>)}
      </>)}
    </div>
  )
}
