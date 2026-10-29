import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import Topbar, { MoneyEye } from '../Topbar'
import PillNav from '../PillNav'
import { ListSkeleton } from '../Skeleton'
import { useBackAction } from '../../lib/backNav'
import { useRouteState } from '../../lib/route'
import { setMoneyMasked, useHideMoney } from '../../lib/privacy'
import { useNow, useShop, useShopId } from '../../lib/shop'
import { BookIcon, CalendarIcon, CashIcon, DashboardIcon, HomeIcon, ListIcon, PieIcon, SettingsIcon, UserIcon, UsersIcon } from '../../lib/icons'
import { useTimeUpAlarm } from '../shop/Floor'
import { useOnlineAlerts } from '../shop/ShopModule'
import Dashboard from './Dashboard'

const Sales = lazy(() => import('./Sales'))
const BookingsSection = lazy(() => import('./BookingsSection'))
const Customers = lazy(() => import('./Customers'))
const Website = lazy(() => import('./Website'))
const Reports = lazy(() => import('./Reports'))
const Staff = lazy(() => import('../shop/Staff'))
const ShopSettings = lazy(() => import('../shop/ShopSettings'))

// The admin portal (owner, 29 Oct: "a specific admin portal with the same login, a whole new admin-level
// experience"; plan: claude.ai/artifact/KYAMN6brLfZ74APehi17yU). Admins land here; the counter app (Shop) is one
// tap away in the module switcher. Laptop: every section in the left sidebar. Phone: four in the pill + More.
export const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: DashboardIcon },
  { id: 'sales', label: 'Sales', icon: CashIcon },
  { id: 'bookings', label: 'Bookings & events', short: 'Bookings', icon: CalendarIcon },
  { id: 'staff', label: 'Staff', icon: UsersIcon },
  { id: 'customers', label: 'Customers', icon: UserIcon },
  { id: 'website', label: 'Website', icon: HomeIcon },
  { id: 'reports', label: 'Reports', icon: PieIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]
const PHONE = ['dashboard', 'sales', 'bookings', 'staff']
const MORE = { id: 'more', label: 'More', icon: ListIcon }
const MASKED = ['dashboard', 'sales', 'reports', 'customers'] // amounts hidden until the 👁 is tapped

export default function AdminModule({ topbar, email, vault, appLock, pinLock }) {
  const householdId = useShopId()
  const shop = useShop(householdId)
  const [tab, setTab] = useRouteState(1, 'dashboard', (v) => SECTIONS.some((t) => t.id === v))
  const [more, setMore] = useState(false)
  useBackAction(tab !== 'dashboard', () => setTab('dashboard'), 2)
  const [hideMoney, toggleHideMoney] = useHideMoney()
  setMoneyMasked(hideMoney && MASKED.includes(tab))
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  const toast = useCallback((m) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 2800) }, [])
  // The counter's alarms and payment alerts ring here too: the admin may be working from the portal.
  useOnlineAlerts(householdId, toast)
  const alarmNow = useNow(5_000)
  useTimeUpAlarm(shop.sessions.filter((x) => x.status === 'running'), alarmNow, (m) => toast(m))

  const go = (id) => { setMore(false); setTab(id); window.scrollTo({ top: 0 }) }
  const props = { shop, householdId, toast }
  let body
  if (!householdId || shop.loading) body = <ListSkeleton />
  else if (shop.error) body = <div className="alert error">Couldn’t load the shop: {shop.error}</div>
  else if (tab === 'dashboard') body = <Dashboard {...props} onOpen={go} onCounter={() => topbar.setModule('shop')} />
  else if (tab === 'sales') body = <Sales {...props} />
  else if (tab === 'bookings') body = <BookingsSection {...props} />
  else if (tab === 'staff') body = <Staff householdId={householdId} toast={toast} portal />
  else if (tab === 'customers') body = <Customers householdId={householdId} toast={toast} />
  else if (tab === 'website') body = <Website {...props} onOpen={go} />
  else if (tab === 'reports') body = <Reports householdId={householdId} />
  else if (tab === 'settings') body = <ShopSettings {...props} admin portal email={email} appLock={appLock} vault={vault} pinLock={pinLock} />
  const section = SECTIONS.find((t) => t.id === tab)
  const pill = [...SECTIONS.filter((t) => PHONE.includes(t.id)), MORE]

  return (
    <div className="app admin-app">
      <Topbar {...topbar} title={section?.short || section?.label} right={MASKED.includes(tab) && <MoneyEye hidden={hideMoney} onToggle={toggleHideMoney} />}>
        <nav className="tabs">
          {SECTIONS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => go(t.id)}><t.icon /> {t.label}</button>
          ))}
        </nav>
      </Topbar>
      <main className="content fade-in gx admin" key={MASKED.includes(tab) ? `${tab}-${hideMoney}` : tab}>
        <Suspense fallback={<ListSkeleton />}>{body}</Suspense>
      </main>
      <PillNav tabs={pill} tab={PHONE.includes(tab) ? tab : 'more'} setTab={(id) => (id === 'more' ? setMore(true) : go(id))} />
      {more && (
        <div className="modal-bg" onMouseDown={() => setMore(false)}>
          <div className="card modal gx-actsheet" onMouseDown={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>More</h3>
            <div className="admin-more">
              {SECTIONS.filter((t) => !PHONE.includes(t.id)).map((t) => (
                <button key={t.id} type="button" className={`admin-more-btn ${tab === t.id ? 'on' : ''}`} onClick={() => go(t.id)}><t.icon /><span>{t.label}</span></button>
              ))}
              <button type="button" className="admin-more-btn" onClick={() => { setMore(false); topbar.setModule('shop') }}><BookIcon /><span>Counter (Slots)</span></button>
            </div>
          </div>
        </div>
      )}
      {msg && <div className="toast" role="status">{msg}</div>}
    </div>
  )
}
