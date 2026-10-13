import { useCallback, useEffect, useState } from 'react'

// Owner (13 Oct): the counter PC opened on Today showed the day's takings to everyone. On Today and every
// Money page, amounts show as "₹ •••" until the 👁 in the top bar is tapped — for this visit only (sessionStorage),
// so the app always reopens hidden.
// money() / moneyShort() / rs() read this flag; ShopModule and BudgetModule set it before rendering.
let masked = false
export const setMoneyMasked = (v) => { masked = !!v }
export const moneyMasked = () => masked
export const MASK = '₹ •••'

const KEY = 'gx.hideMoney'
const read = () => { try { return sessionStorage.getItem(KEY) !== '0' } catch { return true } }
export function useHideMoney() {
  const [hidden, setHidden] = useState(read)
  useEffect(() => {
    const on = () => setHidden(read())
    window.addEventListener('gx-hide-money', on)
    return () => window.removeEventListener('gx-hide-money', on)
  }, [])
  const toggle = useCallback(() => {
    try { sessionStorage.setItem(KEY, read() ? '0' : '1') } catch { /* ignore */ }
    window.dispatchEvent(new Event('gx-hide-money'))
  }, [])
  return [hidden, toggle]
}
