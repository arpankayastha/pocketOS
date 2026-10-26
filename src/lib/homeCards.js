// Which cards Home shows (Settings → Home cards). Stored on this phone only; everything is on by default.
export const HOME_CARDS = [
  ['kept', 'Kept this month', 'Income minus what has been spent so far'],
  ['week', 'This week', 'What is coming up in the next 7 days'],
  ['newhome', 'Our new home', 'A property deal: paid so far and papers in hand'],
  ['loan', 'Home loan journey', 'How far along your home loan is'],
  ['households', 'Households this month', 'Each household’s spending, tap to switch'],
  ['people', 'With family & friends', 'Dues lent and being settled'],
]
const KEY = 'pocketos.homeCardsOff'
export const homeCardsOff = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
export function setHomeCardOn(id, on) {
  const off = new Set(homeCardsOff())
  if (on) off.delete(id); else off.add(id)
  try { localStorage.setItem(KEY, JSON.stringify([...off])) } catch { /* ignore */ }
}
