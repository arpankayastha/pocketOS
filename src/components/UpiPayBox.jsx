import { useState } from 'react'
import { qrSvg, upiLink } from '../lib/upi'
import { rs } from '../lib/shop'

// The customer's UPI payment (booking, event advance, tournament fee, membership): QR, "Pay in UPI app", and the
// UPI ID to copy. Owner, 3 Nov: a customer's app refused the payment link ("bank account not permitting"); some UPI
// apps block links / QR codes with an amount to a personal UPI ID, so the fallback is paying to the ID by hand.
export default function UpiPayBox({ info, amount, note }) {
  const [copied, setCopied] = useState(false)
  if (!info?.upi_id) return null
  const copy = () => navigator.clipboard?.writeText(info.upi_id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }, () => {})
  return (<>
    <div className="gx-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg(upiLink(info, amount, note)) }} />
    <a className="btn primary block" href={upiLink(info, amount, note)}>Pay in UPI app</a>
    <div className="upi-id-row">
      <span className="small">or pay to <b className="mono">{info.upi_id}</b></span>
      <button type="button" className="btn small" onClick={copy}>{copied ? 'Copied' : 'Copy UPI ID'}</button>
    </div>
    <p className="muted small" style={{ margin: 0 }}>If your UPI app shows an error (for example “bank account not permitting”): open your UPI app → <b>Pay to UPI ID</b> → paste the ID above → pay <b>{rs(amount)}</b>, then come back and send.</p>
  </>)
}
