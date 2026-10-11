import { useCallback, useRef, useState } from 'react'
import Topbar from '../Topbar'
import PillNav from '../PillNav'
import { ListSkeleton } from '../Skeleton'
import { useBackAction } from '../../lib/backNav'
import { useSwipe } from '../../lib/useSwipe'
import { useShop, useShopId } from '../../lib/shop'
import { CalendarIcon, CashIcon, ClockIcon, HomeIcon, MonitorIcon, SettingsIcon, UsersIcon } from '../../lib/icons'
import Floor from './Floor'
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
  { id: 'floor', label: 'Floor', icon: MonitorIcon },
  { id: 'events', label: 'Events', icon: CalendarIcon },
  { id: 'cash', label: 'Cash', icon: CashIcon },
  { id: 'staff', label: 'Staff', icon: UsersIcon },
]
const STAFF_TABS = [
  { id: 'shift', label: 'Shift', icon: ClockIcon },
  { id: 'floor', label: 'Floor', icon: MonitorIcon },
  { id: 'events', label: 'Events', icon: CalendarIcon },
  { id: 'cash', label: 'Cash', icon: CashIcon },
]

export default function ShopModule({ topbar, member, memberHouseholdId, userId, email, vault, appLock }) {
  const householdId = useShopId(memberHouseholdId)
  const shop = useShop(householdId)
  const tabs = member ? STAFF_TABS : ADMIN_TABS
  const home = tabs[0].id
  const [tab, setTab] = useState(home)
  useBackAction(tab !== home, () => setTab(home), 2)
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  const toast = useCallback((m) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 2800) }, [])

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
  else if (tab === 'today') body = <Today {...props} onOpen={setTab} />
  else if (tab === 'floor') body = <Floor {...props} />
  else if (tab === 'shift') body = <Shift householdId={householdId} userId={userId} toast={toast} />
  else if (tab === 'cash') body = <Cash {...props} />
  else if (tab === 'events') body = <Events householdId={householdId} admin={!member} toast={toast} />
  else if (tab === 'staff') body = <Staff householdId={householdId} toast={toast} />
  else if (tab === 'settings') body = <ShopSettings {...props} admin={!member} email={email} member={member} appLock={appLock} vault={vault} />

  return (
    <div className="app">
      <Topbar {...topbar} right={
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
