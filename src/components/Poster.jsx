import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { qrSvg } from '../lib/upi'

// Printable counter banner (/#poster): the QR opens the café's home page (owner, 13 Oct) — book a slot,
// events and tournaments, the timer, jobs, social links. Print or save as PDF from the browser (A4).
export default function Poster() {
  const [info, setInfo] = useState(null)
  useEffect(() => { supabase.rpc('public_shop_info').then(({ data }) => setInfo(data)) }, [])
  const url = `${window.__posterOrigin || location.origin}/`
  const rate = (kind, minutes, happy = false) => info?.rates?.find((r) => r.kind === kind && r.minutes === minutes && !!r.happy === happy)?.price
  const days = (info?.happy_days || [3, 4, 5]).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(' · ')
  return (
    <div className="poster-wrap">
      <div className="poster">
        <img className="poster-mark" src="/brand/mark.png" alt="" />
        <div className="poster-brand">GRANDXGAMER</div>
        <div className="poster-title">Scan &amp; play</div>
        <div className="poster-sub">book your PC or PS5 · events · your timer</div>
        <div className="poster-qr" dangerouslySetInnerHTML={{ __html: qrSvg(url, 2) }} />
        <div className="poster-steps">
          <span><b>1</b> Book your slot</span><span><b>2</b> Join events &amp; tournaments</span><span><b>3</b> Track your time left</span>
        </div>
        {info && (
          <div className="poster-rates">
            <div><b>PC</b> ₹{rate('PC', 30)} / 30 min · ₹{rate('PC', 60)} / hr</div>
            <div><b>PS5</b> ₹{rate('PS', 30)} / 30 min · ₹{rate('PS', 60)} / hr <i>per head</i></div>
            {rate('PC', 60, true) && <div className="poster-happy">Happy hours {days} · PC ₹{rate('PC', 60, true)}/hr · PS5 ₹{rate('PS', 60, true)}/hr</div>}
          </div>
        )}
        <div className="poster-url">{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</div>
      </div>
      <button className="btn primary poster-print" onClick={() => window.print()}>Print / save as PDF</button>
    </div>
  )
}
