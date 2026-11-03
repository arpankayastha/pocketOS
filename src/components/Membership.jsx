import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rs } from '../lib/shop'
import { hourlyRate, planDiscount } from '../lib/membership'
import { telLink, waLink } from '../lib/products'
import PublicNav from './PublicNav'

// Public page #membership (owner, 1 Nov: "Join Membership Plan" button on the home page, the plans inside).
// Joining is at the counter or by call / WhatsApp; the plans come from Admin → Website → Membership plans.
export default function Membership() {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { supabase.rpc('public_home').then(({ data, error }) => (error ? setError(error.message) : setInfo(data))) }, [])
  const m = info?.membership
  const pc = hourlyRate(info?.rates, 'PC'), ps = hourlyRate(info?.rates, 'PS')
  return (
    <div className="pub-page member-page">
      <PublicNav active="membership" />
      <a className="pub-back" href="#">‹ Home</a>
      <header className="member-head">
        <div className="home-kicker">GRANDXGAMER</div>
        <h1>Choose your gaming <span>membership plan</span></h1>
        <p className="muted">Join today and get special membership benefits.</p>
      </header>
      {error && <div className="alert error">{error}</div>}
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
                {info.phone ? (
                  <div className="member-cta">
                    <a className="btn primary" href={waLink(info.phone, `Hi GRANDXGAMER, I want to join the ${p.name} (${p.pass || ''}).`)} target="_blank" rel="noreferrer">Join on WhatsApp</a>
                    <a className="btn" href={telLink(info.phone)}>Call</a>
                  </div>
                ) : <div className="muted small">Join at the counter.</div>}
              </article>
            )
          })}
        </div>
        {m.note && <div className="card member-note"><b>Membership key benefit</b><span>{m.note}</span></div>}
        {info.phone && <div className="member-contact muted small">Contact us · <a href={telLink(info.phone)}>{info.phone}</a> · pay at the counter or by UPI</div>}
      </>)}
    </div>
  )
}
