import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BrandMark } from '../lib/icons'

// Public jobs page (/#jobs): open vacancies, readable without a login (RLS lets anon read open rows).
export default function Jobs() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    supabase.from('shop_vacancies').select('id, title, details, timing, pay, contact').eq('open', true).order('created_at', { ascending: false })
      .then(({ data, error }) => { if (error) setError(error.message); else setRows(data) })
  }, [])
  const digits = (n) => (n || '').replace(/\D/g, '')
  const wa = (n) => { const d = digits(n); return `https://wa.me/${d.length === 10 ? `91${d}` : d}` }
  return (
    <div className="jobs-page">
      <header className="jobs-head">
        <a className="brand big" href="#"><BrandMark size={34} />GRANDXGAMER</a>
        <h1>We’re hiring</h1>
        <p className="muted">Gaming café · Pune</p>
      </header>
      {error && <div className="alert error">Couldn’t load the jobs: {error}</div>}
      {rows === null && !error && <div className="card muted">Loading…</div>}
      {rows?.length === 0 && <div className="card"><b>No openings right now.</b><p className="muted small" style={{ margin: '6px 0 0' }}>Check back soon, or follow us on Instagram @grandxgamer.</p></div>}
      <div className="jobs-list">
        {rows?.map((v) => (
          <article key={v.id} className="card jobs-card">
            <h2>{v.title}</h2>
            {(v.timing || v.pay) && <div className="jobs-meta">{v.timing && <span>🕒 {v.timing}</span>}{v.pay && <span>💰 {v.pay}</span>}</div>}
            {v.details && <p className="jobs-details">{v.details}</p>}
            {v.contact && (
              <div className="jobs-apply">
                <span className="muted small">Apply: call or WhatsApp <b className="mono">{v.contact}</b></span>
                <div className="gx-btns">
                  <a className="btn primary" href={wa(v.contact)} target="_blank" rel="noreferrer">WhatsApp</a>
                  <a className="btn" href={`tel:${digits(v.contact)}`}>Call</a>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
      <p className="muted small" style={{ textAlign: 'center' }}><a href="#">‹ Home</a></p>
    </div>
  )
}
