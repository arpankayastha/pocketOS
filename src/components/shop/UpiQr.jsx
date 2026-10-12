import { useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { rs } from '../../lib/shop'

// UPI QR with the amount filled in: upi://pay?pa=<UPI ID>&pn=<name>&am=<amount>&cu=INR&tn=<note>.
// Any UPI app (GPay, PhonePe, Paytm, BHIM) scans it. There's no payment gateway, so the app can't see the
// money arrive — staff check the shop's phone / soundbox before saving.
function upiLink(settings, amount, note) {
  // '@' in the UPI ID stays as it is and the note is plain ASCII: some UPI apps reject anything else.
  const enc = (t) => encodeURIComponent(t)
  const ascii = (t) => t.replace(/[^\x20-\x7E]/g, '-').replace(/\s*-\s*/g, ' - ').trim().slice(0, 50)
  let url = `upi://pay?pa=${settings.upi_id.trim()}&pn=${enc(settings.upi_name?.trim() || 'GRANDXGAMER')}&am=${Number(amount).toFixed(2)}&cu=INR`
  if (note) url += `&tn=${enc(ascii(note))}`
  return url
}

export function UpiQrButton({ settings, amount, note }) {
  const [open, setOpen] = useState(false)
  if (!(amount > 0)) return null
  if (!settings?.upi_id) return <div className="muted small">Add the shop’s UPI ID in ⚙ → Payments to show a QR here.</div>
  return (<>
    <button type="button" className="btn gx-qr-btn" onClick={() => setOpen(true)}>Show UPI QR · {rs(amount)}</button>
    {open && <UpiQrSheet settings={settings} amount={amount} note={note} onClose={() => setOpen(false)} />}
  </>)
}

function UpiQrSheet({ settings, amount, note, onClose }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(upiLink(settings, amount, note))
    qr.make()
    return qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true })
  }, [settings, amount, note])
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal gx-qr" onMouseDown={(e) => e.stopPropagation()}>
        <div className="gx-qr-amount">{rs(amount)}</div>
        <div className="muted small">{note}</div>
        <div className="gx-qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="small">Pay to <b className="mono">{settings.upi_id}</b>{settings.upi_name ? ` · ${settings.upi_name}` : ''}</div>
        <p className="muted small" style={{ margin: 0 }}>Scan with any UPI app. Check the payment has arrived on the shop’s phone before saving.</p>
        <button type="button" className="btn primary block" onClick={onClose}>Done</button>
      </div>
    </div>
  )
}
