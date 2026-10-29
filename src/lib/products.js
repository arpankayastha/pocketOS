// PC parts the café sells (owner, 29 Oct: "main components only — motherboard, CPU, GPU… not accessories;
// a call button for the price"). Shown on the public home page; edited by the admin in ⚙ → Products for sale.
export const CATEGORIES = [
  ['cpu', 'Processors'],
  ['gpu', 'Graphics cards'],
  ['motherboard', 'Motherboards'],
  ['ram', 'Memory (RAM)'],
  ['storage', 'SSDs & storage'],
  ['psu', 'Power supplies'],
  ['cabinet', 'Cabinets'],
  ['cooler', 'CPU coolers'],
]
export const categoryLabel = (id) => CATEGORIES.find(([k]) => k === id)?.[1] || id

// 10-digit Indian mobile → tel: / WhatsApp links (other formats are dialled as typed).
const digits = (p) => String(p || '').replace(/\D/g, '')
export const telLink = (p) => `tel:${digits(p).length === 10 ? `+91${digits(p)}` : String(p || '').replace(/\s/g, '')}`
export const waLink = (p, text) => {
  const d = digits(p)
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}?text=${encodeURIComponent(text)}`
}
export const specLines = (specs) => String(specs || '').split('\n').map((s) => s.trim()).filter(Boolean)
