import qrcode from 'qrcode-generator'

// UPI payment link: upi://pay?pa=<UPI ID>&pn=<name>&am=<amount>&cu=INR&tn=<note>. '@' in the UPI ID stays
// as it is and the note is plain ASCII — some UPI apps reject anything else. Used for QR codes and for the
// "Pay in UPI app" button on phones.
export function upiLink({ upi_id, upi_name }, amount, note) {
  const ascii = (t) => t.replace(/[^\x20-\x7E]/g, '-').replace(/\s*-\s*/g, ' - ').trim().slice(0, 50)
  let url = `upi://pay?pa=${upi_id.trim()}&pn=${encodeURIComponent(upi_name?.trim() || 'GRANDXGAMER')}&am=${Number(amount).toFixed(2)}&cu=INR`
  if (note) url += `&tn=${encodeURIComponent(ascii(note))}`
  return url
}

// A QR <svg> string for any text (a UPI link, the booking page address).
export function qrSvg(text, margin = 3) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 6, margin, scalable: true })
}
