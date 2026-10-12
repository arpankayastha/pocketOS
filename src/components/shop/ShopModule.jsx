import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Topbar from '../Topbar'
import PillNav from '../PillNav'
import { ListSkeleton } from '../Skeleton'
import { useBackAction } from '../../lib/backNav'
import { useSwipe } from '../../lib/useSwipe'
import { useRouteState } from '../../lib/route'
import { useNow, useShop, useShopId } from '../../lib/shop'
import { CalendarIcon, CashIcon, ClockIcon, HomeIcon, MonitorIcon, SettingsIcon, UsersIcon } from '../../lib/icons'
import Floor, { useTimeUpAlarm } from './Floor'
import Shift from './Shift'
import Cash from './Cash'
import Today from './Today'
import Staff from './Staff'
import Events from './Events'
import ShopSettings from './ShopSettings'

// The café itself. Admin: Today · Floor · Events · Cash · Staff. Staff: Shift · Floor · Events · Cash.
// ⚙ (top right) holds systems & rates (admin) and each login's own settings.
const ADMIN_TABS = [
  { id: 'today', label: 'Today', icon: HomeIcon },
  { id: 'floor', label: 'Slots', icon: MonitorIcon },
  { id: 'events', label: 'Events', icon: CalendarIcon },
  { id: 'cash', label: 'Cash', icon: CashIcon },
  { id: 'staff', label: 'Staff', icon: UsersIcon },
]
const STAFF_TABS = [
  { id: 'shift', label: 'Shift', icon: ClockIcon },
  { id: 'floor', label: 'Slots', icon: MonitorIcon },
  { id: 'events', label: 'Events', icon: CalendarIcon },
  { id: 'cash', label: 'Cash', icon: CashIcon },
]

export default function ShopModule({ topbar, member, memberHouseholdId, userId, email, vault, appLock, pinLock }) {
  const householdId = useShopId(memberHouseholdId)
  const shop = useShop(householdId)
  const tabs = member ? STAFF_TABS : ADMIN_TABS
  const home = tabs[0].id
  const [tab, setTab] = useRouteState(1, home, (v) => v === 'settings' || tabs.some((t) => t.id === v))
  useBackAction(tab !== home, () => setTab(home), 2)
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  const toast = useCallback((m) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 2800) }, [])

  useOnlineAlerts(householdId, toast)
  // 5-min-left / time-up alarm on every Shop tab, not only Slots (owner: "the PS5 5-minute sound didn't ring").
  const alarmNow = useNow(5_000)
  useTimeUpAlarm(shop.sessions.filter((x) => x.status === 'running'), alarmNow, (m) => toast(m))

  // Swipe left/right anywhere moves between tabs; date headers (.gx-dateswipe) and sideways chip rows swipe themselves.
  const at = tabs.findIndex((t) => t.id === tab)
  const swipe = useSwipe({
    ignore: '.gx-dateswipe, .gx-scroll',
    onLeft: () => { if (at >= 0 && at < tabs.length - 1) setTab(tabs[at + 1].id) },
    onRight: () => { if (at > 0) setTab(tabs[at - 1].id) },
  })
  const props = { shop, householdId, toast }
  let body
  if (!householdId || shop.loading) body = <ListSkeleton />
  else if (shop.error) body = <div className="alert error">Couldn’t load the shop: {shop.error}</div>
  else if (tab === 'today') body = <Today {...props} onOpen={setTab} toast={toast} />
  else if (tab === 'floor') body = <Floor {...props} admin={!member} />
  else if (tab === 'shift') body = <Shift householdId={householdId} userId={userId} toast={toast} />
  else if (tab === 'cash') body = <Cash {...props} admin={!member} />
  else if (tab === 'events') body = <Events householdId={householdId} admin={!member} settings={shop.settings} toast={toast} />
  else if (tab === 'staff') body = <Staff householdId={householdId} toast={toast} />
  else if (tab === 'settings') body = <ShopSettings {...props} admin={!member} email={email} member={member} appLock={appLock} vault={vault} pinLock={pinLock} />

  return (
    <div className="app">
      <Topbar {...topbar} title={tab === 'settings' ? 'Settings' : tabs.find((t) => t.id === tab)?.label} right={
        <button className={`btn icon settings-btn ${tab === 'settings' ? 'on' : ''}`} aria-label="Shop settings" title="Shop settings"
          onClick={() => setTab(tab === 'settings' ? home : 'settings')}><SettingsIcon /></button>
      }>
        <nav className="tabs">
          {tabs.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}><t.icon /> {t.label}</button>
          ))}
        </nav>
      </Topbar>
      <main className="content fade-in gx" {...swipe}>{body}</main>
      <PillNav tabs={tabs} tab={tab} setTab={setTab} />
      {msg && <div className="toast" role="status">{msg}</div>}
    </div>
  )
}

// Owner: "online payment notification should be shown to staff also — received or not". Every phone with
// the shop open hears about new online bookings, event advances and tournament entries at once: a toast,
// a buzz, a short beep, and a phone notification if allowed (⚙ → Payment alerts). They're then checked on the Floor.
function useOnlineAlerts(householdId, onAlert) {
  const cb = useRef(onAlert)
  useEffect(() => { cb.current = onAlert })
  useEffect(() => {
    if (!householdId) return
    const say = (title, body) => {
      cb.current(`${title} · ${body}`)
      try { navigator.vibrate?.([200, 100, 200]) } catch { /* ignore */ }
      beep()
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        navigator.serviceWorker?.getRegistration().then((reg) => {
          const opts = { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `gx-${Date.now()}` }
          if (reg) reg.showNotification(title, opts); else new Notification(title, opts)
        }).catch(() => {})
      }
    }
    const rs = (n) => `₹${Math.round(Number(n) || 0)}`
    const ch = supabase.channel(`alerts:${householdId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shop_bookings', filter: `household_id=eq.${householdId}` }, ({ new: b }) => {
        if (b.source === 'online') say('New online booking', `${b.customer_name} · ${b.kind === 'PS' ? 'PS5' : 'PC'} · ${rs(b.amount)} paid? Check UPI`)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shop_event_bookings', filter: `household_id=eq.${householdId}` }, ({ new: b }) => {
        if (b.source === 'online') say('New event booking', `${b.customer_name} · advance ${rs(b.advance_paid)} · check UPI`)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shop_entries', filter: `household_id=eq.${householdId}` }, ({ new: x }) => {
        say('New tournament entry', `${x.name} · ${x.rank}${Number(x.fee) ? ` · fee ${rs(x.fee)} · check UPI` : ''}`)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [householdId])
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = 880; g.gain.value = 0.15
    o.connect(g); g.connect(ctx.destination)
    o.start(); o.stop(ctx.currentTime + 0.25)
    setTimeout(() => ctx.close(), 500)
  } catch { /* ignore */ }
}
