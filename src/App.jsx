import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { supabase, isConfigured } from './lib/supabase'
import { useFinanceData } from './lib/useFinanceData'
import { useVault, fingerprintHere } from './lib/useVault'
import { platformAuthenticatorAvailable, deviceName, describeWebAuthnError } from './lib/webauthn'
import { useAppLock } from './lib/useAppLock'
import { clearVaultSession } from './lib/vaultSession'
import Auth from './components/Auth'
import TransactionForm from './components/TransactionForm'
import TransferForm from './components/TransferForm'
import VaultGate, { RecoveryCode } from './components/VaultGate'
import { isMember, memberName } from './lib/members'
import { isCustomer } from './lib/mine'
import { usePinLock } from './lib/usePinLock'
import PinLock from './components/PinLock'
import Topbar, { HouseholdMenu } from './components/Topbar'
import PillNav from './components/PillNav'
import { MODULES, SHOP, VAULT } from './lib/modules'
import { useDialog } from './lib/dialog'
import { routeHas, useRouteState } from './lib/route'
import { useBackAction, useBackButton } from './lib/backNav'
import { DashboardSkeleton, ListSkeleton } from './components/Skeleton'
import { BrandMark, HomeIcon, DuesIcon, BookIcon, ListIcon, PlanIcon, SettingsIcon, PlusIcon, KeyIcon, DiceIcon, ShieldIcon, LockIcon } from './lib/icons'

// Tabs and modules load on demand (code-split), so the first screen only downloads the shell.
// The Home tab and the chart chunk are preloaded as soon as the app starts (see preloadBudget).
const loadDashboard = () => import('./components/Dashboard')
const Dashboard = lazy(loadDashboard)
const Transactions = lazy(() => import('./components/Transactions'))
const Plan = lazy(() => import('./components/Plan'))
const Dues = lazy(() => import('./components/Dues'))
const Hisab = lazy(() => import('./components/Hisab'))
const Settings = lazy(() => import('./components/Settings'))
const VaultItems = lazy(() => import('./components/VaultItems'))
const PasswordGenerator = lazy(() => import('./components/PasswordGenerator'))
const VaultSecurity = lazy(() => import('./components/VaultSecurity'))
const ChangePassword = lazy(() => import('./components/VaultSecurity').then((m) => ({ default: m.ChangePassword })))
const Jobs = lazy(() => import('./components/Jobs'))
const Book = lazy(() => import('./components/Book'))
const Poster = lazy(() => import('./components/Poster'))
const Home = lazy(() => import('./components/Home'))
const EventPage = lazy(() => import('./components/EventPage'))
const Timer = lazy(() => import('./components/Timer'))
const loadShop = () => import('./components/shop/ShopModule')
const ShopModule = lazy(loadShop)
function preloadBudget() {
  loadShop()
  loadDashboard()
}

// GRANDXGAMER is a shell of independent modules (Shop, Money, Vault — lib/modules.js); each renders its own tabs.
const ACTIVE_MODULE_KEY = 'pocketos.activeModule'

// Accounts & Categories ('settings') isn't a tab: it opens from the ⚙ button in the header.
const BUDGET_TABS = [
  { id: 'dashboard', label: 'Home', icon: HomeIcon },
  { id: 'transactions', label: 'Entries', icon: ListIcon },
  { id: 'plan', label: 'Plan', icon: PlanIcon },
  { id: 'dues', label: 'Dues', icon: DuesIcon },
  { id: 'hisab', label: 'Cashbook', icon: BookIcon },
]

const VAULT_TABS = [
  { id: 'items', label: 'Passwords', icon: KeyIcon },
  { id: 'generator', label: 'Generator', icon: DiceIcon },
  { id: 'security', label: 'Security', icon: ShieldIcon },
]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [hash, setHash] = useState(() => location.hash)
  useEffect(() => { const on = () => setHash(location.hash); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on) }, [])

  useEffect(() => {
    if (!isConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (!s) clearVaultSession(); setSession(s) })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!isConfigured) {
    return (
      <div className="auth-wrap">
        <div className="card auth">
          <h2>Supabase not configured</h2>
          <p>Copy <code>.env.example</code> to <code>.env</code>, add your project URL and anon key, then restart <code>npm run dev</code>.</p>
        </div>
      </div>
    )
  }
  // Public pages: open to anyone with the link, signed in or not.
  if (hash === '#jobs') return <Suspense fallback={<Splash />}><Jobs /></Suspense>
  if (hash === '#book') return <Suspense fallback={<Splash />}><Book /></Suspense>
  if (hash === '#poster') return <Suspense fallback={<Splash />}><Poster /></Suspense>
  if (hash === '#timer') return <Suspense fallback={<Splash />}><Timer /></Suspense>
  if (session === undefined) return <Splash />
  if (hash.startsWith('#event/')) return <Suspense fallback={<Splash />}><EventPage id={hash.slice(7)} session={session} /></Suspense>
  // Signed out: the café's home page (owner's brief); staff sign in from its "Staff login" link (#staff).
  // Customers signed in with Google stay on the home page (their bookings and time left).
  // #staff works for a signed-in customer too (e.g. a Google account not linked to a staff login yet).
  if (!session || isCustomer(session)) return hash === '#staff' ? <Auth customer={session && isCustomer(session) ? session : null} /> : <Suspense fallback={<Splash />}><Home session={session} /></Suspense>
  return isMember(session) ? <MemberShell session={session} /> : <Shell session={session} />
}

// Same look as the pre-JS splash in index.html (classes styled there), shown while the session loads.
function Splash() {
  return <div className="splash" aria-label="Loading GRANDXGAMER"><BrandMark size={76} /><span>GRANDXGAMER</span></div>
}

function Shell({ session }) {
  const [module, setModuleState] = useRouteState(0, () => {
    const saved = localStorage.getItem(ACTIVE_MODULE_KEY)
    return MODULES.some((m) => m.id === saved) ? saved : 'shop'
  }, (v) => MODULES.some((m) => m.id === v))
  const setModule = (id) => { setModuleState(id); localStorage.setItem(ACTIVE_MODULE_KEY, id) }
  // Vault state lives here, not in VaultModule, so switching modules doesn't lock the vault.
  const vault = useVault(session)
  useEffect(() => { preloadBudget() }, []) // fetch Home while the unlock screen is up
  const pinLock = usePinLock(session)
  const appLock = useAppLock(session)
  const dialog = useDialog()
  const [mustResetPassword, setMustResetPassword] = useState(false) // after unlocking with the recovery code
  const [toast, setToast] = useState(null)

  // Once the vault exists, ONE fingerprint (the vault unlock) opens the whole app. The older,
  // separate app lock would ask a second time, so it's switched off.
  const { enabled: appLockOn, disable: disableAppLock } = appLock
  useEffect(() => {
    if (appLockOn && (vault.status === 'locked' || vault.status === 'unlocked')) disableAppLock()
  }, [appLockOn, disableAppLock, vault.status])

  useBackButton(() => { setToast('Press back again to close GRANDXGAMER'); setTimeout(() => setToast(null), 2000) })
  useOfferFingerprint(vault, dialog, setToast)
  useBackAction(module !== 'shop', () => setModule('shop'), 1)

  if (vault.status === 'loading') {
    return vault.error ? (
      <div className="auth-wrap"><div className="card auth">
        <div className="brand big"><BrandMark size={28} />GRANDXGAMER</div>
        <div className="alert error">Couldn't reach the server: {vault.error}</div>
        <button className="btn primary" onClick={() => location.reload()}>Try again</button>
      </div></div>
    ) : <Splash />
  }
  // Owner (12 Oct): no master-password screen in front of the app (that's only for the Vault), but a 4-digit
  // app PIN when the app is opened / after 15 min idle, so nobody else can open it on the shop PC.
  if (pinLock.state === 'loading') return <Splash />
  if (pinLock.state !== 'open') return <PinLock lock={pinLock} session={session} />

  const topbar = { module, setModule }
  return (
    // Any tap or key press counts as activity for the vault's idle auto-lock, in every module.
    <div className="shell" onPointerDownCapture={vault.touch} onKeyDownCapture={vault.touch}>
      {module === 'vault' ? <VaultModule topbar={topbar} vault={vault} mustResetPassword={mustResetPassword} setMustResetPassword={setMustResetPassword} />
        : module === 'budget' ? <BudgetModule topbar={topbar} email={memberName(session)} vault={vault} />
        : <Suspense fallback={<Splash />}><ShopModule topbar={topbar} userId={session.user.id} email={memberName(session)} vault={vault} appLock={appLock} pinLock={pinLock} /></Suspense>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

// A staff login's app: the Shop (no Money), plus the shop Vault once the admin enables it for them
// (then ONE vault fingerprint opens both, like the admin's app). Without a vault they're behind the
// per-device app lock (fingerprint, PIN as backup).
const MEMBER_INFO_KEY = 'pocketos.memberInfo'
function MemberShell({ session }) {
  useEffect(() => { preloadBudget() }, [])
  // Which tab the app opens on (chosen by the owner) and the member's household. Cached per
  // device so the app opens instantly; refreshed from the server on every start.
  const [info, setInfo] = useState(() => { try { return JSON.parse(localStorage.getItem(MEMBER_INFO_KEY)) } catch { return null } })
  useEffect(() => {
    supabase.from('household_members').select('household_id, role').eq('user_id', session.user.id).maybeSingle().then(({ data }) => {
      if (!data) return
      try { localStorage.setItem(MEMBER_INFO_KEY, JSON.stringify(data)) } catch { /* ignore */ }
      setInfo(data)
    })
  }, [session.user.id])
  const vault = useVault(session, { householdId: info?.household_id })
  const pinLock = usePinLock(session)
  const appLock = useAppLock(session)
  const dialog = useDialog()
  const [module, setModule] = useRouteState(0, 'shop', (v) => v === 'shop' || v === 'vault')
  const [toast, setToast] = useState(null)
  const vaultOn = vault.status === 'locked' || vault.status === 'unlocked'

  // With a vault, its fingerprint is the one lock — switch the separate app lock off.
  const { enabled: appLockOn, disable: disableAppLock } = appLock
  useEffect(() => { if (appLockOn && vaultOn) disableAppLock() }, [appLockOn, vaultOn, disableAppLock])
  useBackButton(() => { setToast('Press back again to close GRANDXGAMER'); setTimeout(() => setToast(null), 2000) })
  useOfferFingerprint(vault, dialog, setToast)
  useBackAction(module !== 'shop', () => setModule('shop'), 1)

  if (vault.status === 'loading' || !info) return <Splash />
  if (pinLock.state === 'loading') return <Splash />
  if (pinLock.state !== 'open') return <PinLock lock={pinLock} session={session} />
  // Same for staff: no app lock after signing in; the Vault asks only when it's opened.
  const topbar = { module, setModule, modules: vaultOn ? [SHOP, VAULT] : [SHOP] }
  return (
    <div className="shell" onPointerDownCapture={vault.touch} onKeyDownCapture={vault.touch}>
      {module === 'vault' && vaultOn ? <VaultModule topbar={topbar} vault={vault} member />
        : <Suspense fallback={<Splash />}><ShopModule topbar={topbar} member memberHouseholdId={info.household_id} userId={session.user.id} email={memberName(session)} appLock={null} vault={vaultOn ? vault : null} pinLock={pinLock} /></Suspense>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

// After an unlock WITHOUT fingerprint (master password / recovery code) on a phone that has no
// fingerprint for this address yet, offer to set one up. "Not now" is remembered per device;
// it can still be turned on from ⚙ → Security.
const FP_OFFER_KEY = 'pocketos.fingerprintOfferDismissed'
function useOfferFingerprint(vault, dialog, setToast) {
  const prev = useRef(vault.status)
  const { status, unlockers, addFingerprint } = vault
  useEffect(() => {
    const was = prev.current
    prev.current = status
    if (was !== 'locked' || status !== 'unlocked' || fingerprintHere(unlockers)) return
    try { if (localStorage.getItem(FP_OFFER_KEY)) return } catch { /* ignore */ }
    platformAuthenticatorAvailable().then(async (ok) => {
      if (!ok) return
      const yes = await dialog.confirm({ title: 'Use your fingerprint next time?', message: 'Unlock GRANDXGAMER on this phone with your fingerprint instead of typing the master password. You can change this any time in ⚙ → Security.', confirmLabel: 'Use fingerprint', cancelLabel: 'Not now', danger: false })
      if (!yes) { try { localStorage.setItem(FP_OFFER_KEY, '1') } catch { /* ignore */ } return }
      try { await addFingerprint(deviceName()); setToast('Fingerprint unlock is on'); setTimeout(() => setToast(null), 2500) }
      catch (err) { dialog.alert({ title: "Couldn't turn on fingerprint", message: describeWebAuthnError(err) }) }
    })
  }, [status, unlockers, addFingerprint, dialog, setToast])
}

function BudgetModule({ topbar, email, member, appLock, vault, startTab = 'dashboard', hisabOnly = false }) {
  // A member login the owner set to "Only Hisab" sees just that tab (⚙ stays for their own settings).
  const tabs = hisabOnly ? BUDGET_TABS.filter((t) => t.id === 'hisab') : BUDGET_TABS
  // The "home" tab: where the app opens and where Android back returns to. A member's comes from
  // their login (`startTab`); the owner picks one per household ("Opens on" in the HouseholdSheet).
  const [tab, setTab] = useRouteState(1, startTab, (v) => v === 'settings' || BUDGET_TABS.some((t) => t.id === v))
  const [fromAddress] = useState(() => routeHas(1))
  const [fabOpen, setFabOpen] = useState(false)
  const [quickAddKind, setQuickAddKind] = useState(null) // null | 'expense' | 'income' | 'transfer'
  const [dataVersion, setDataVersion] = useState(0)
  const [hisabAdd, setHisabAdd] = useState(0) // the + on the Hisab tab adds a Hisab entry instead
  const data = useFinanceData()
  const dialog = useDialog()
  const household = data.households.find((h) => h.id === data.activeHouseholdId)
  const home = member ? startTab : household?.start_tab || 'dashboard'
  useBackAction(tab !== home, () => setTab(home), 2)
  // Switched to "Only Hisab" after the app opened (the setting is refreshed on start): leave hidden tabs.
  useEffect(() => { if (hisabOnly && tab !== 'hisab' && tab !== 'settings') setTab('hisab') }, [hisabOnly, tab])
  // Opening the app or switching household lands on that household's home (not while in Settings).
  const seenHousehold = useRef(null)
  useEffect(() => {
    if (member || !household || seenHousehold.current === household.id) return
    const first = seenHousehold.current === null
    seenHousehold.current = household.id
    if (first && fromAddress) return // opened on a tab from the address (refresh): stay there
    if (first || tab !== 'settings') setTab(household.start_tab || 'dashboard')
  }, [member, household, tab])

  return (
    <div className="app">
      <Topbar {...topbar} right={data.households.length > 0 && (<>
        {data.households.length > 1 && <HouseholdMenu member={member} households={data.households} activeId={data.activeHouseholdId} onSelect={data.setActiveHouseholdId}
          onCreate={async () => {
            const name = await dialog.prompt({ title: 'New household', label: 'Name', placeholder: "e.g. Parents' Home", confirmLabel: 'Create' })
            if (name) data.createHousehold(name)
          }}
          onManage={() => setTab('settings')} />}
        <button className={`btn icon settings-btn ${tab === 'settings' ? 'on' : ''}`} aria-label="Accounts & Categories" title="Accounts & Categories"
          onClick={() => setTab(tab === 'settings' ? home : 'settings')}><SettingsIcon /></button>
      </>)}>
        <nav className="tabs">
          {tabs.length > 1 && tabs.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon /> {t.label}
            </button>
          ))}
        </nav>
      </Topbar>
      <main className="content fade-in">
        {data.error && <div className="alert error">Database error: {data.error}. Did you run <code>supabase/schema.sql</code>?</div>}
        {data.loading ? (tab === 'dashboard' ? <DashboardSkeleton /> : <ListSkeleton />) : (
          <Suspense fallback={tab === 'dashboard' ? <DashboardSkeleton /> : <ListSkeleton />}>
            {tab === 'dashboard' && <Dashboard key={dataVersion} {...data} />}
            {tab === 'transactions' && <Transactions key={dataVersion} {...data} />}
            {tab === 'plan' && <Plan {...data} />}
            {tab === 'hisab' && <Hisab key={`${data.activeHouseholdId}:${dataVersion}`} activeHouseholdId={data.activeHouseholdId} accounts={data.accounts} addSignal={hisabAdd} />}
            {tab === 'dues' && <Dues {...data} onChanged={() => { setDataVersion((v) => v + 1); data.refresh() }} />}
            {tab === 'settings' && <Settings {...data} email={email} member={member} appLock={appLock} vault={vault} />}
          </Suspense>
        )}
      </main>

      {tabs.length > 1 && <PillNav tabs={tabs} tab={tab} setTab={setTab} withFab />}

      {fabOpen && <div className="fab-backdrop" onClick={() => setFabOpen(false)} />}
      <div className="fab-wrap">
        {fabOpen && (
          <div className="fab-menu">
            {data.households.length > 1 && (
              <button className="fab-option transfer" onClick={() => { setFabOpen(false); setQuickAddKind('transfer') }}>⇄ Transfer</button>
            )}
            <button className="fab-option income" onClick={() => { setFabOpen(false); setQuickAddKind('income') }}>Income</button>
            <button className="fab-option expense" onClick={() => { setFabOpen(false); setQuickAddKind('expense') }}>Expense</button>
          </div>
        )}
        <button className={`fab ${fabOpen ? 'open' : ''}`} aria-label={tab === 'hisab' ? 'Add cash book entry' : 'Add transaction'}
          onClick={() => (tab === 'hisab' ? setHisabAdd((n) => n + 1) : setFabOpen((v) => !v))}><PlusIcon /></button>
      </div>

      {quickAddKind === 'transfer' && !data.loading && (
        <TransferForm households={data.households} fromHouseholdId={data.activeHouseholdId}
          onClose={() => setQuickAddKind(null)}
          onSaved={() => { setQuickAddKind(null); setDataVersion((v) => v + 1); data.refresh() }} />
      )}
      {quickAddKind && quickAddKind !== 'transfer' && !data.loading && (
        <TransactionForm accounts={data.accounts} categories={data.categories} householdId={data.activeHouseholdId} presetKind={quickAddKind}
          onClose={() => setQuickAddKind(null)}
          onSaved={() => { setQuickAddKind(null); setDataVersion((v) => v + 1); data.refresh() }} />
      )}
    </div>
  )
}

function VaultModule({ topbar, vault, mustResetPassword, setMustResetPassword, member }) {
  const [tab, setTab] = useRouteState(1, 'items', (v) => VAULT_TABS.some((t) => t.id === v))
  useBackAction(tab !== 'items', () => setTab('items'), 2)
  const [recoveryCode, setRecoveryCode] = useState(null) // { code, firstTime } shown once
  const [openItem, setOpenItem] = useState(null)
  const [editing, setEditing] = useState(null) // item being edited, {} for a new one
  const unlocked = vault.status === 'unlocked'
  // Close any open item when the vault locks, so nothing reappears after unlocking.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked)
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked)
    if (!unlocked) { setOpenItem(null); setEditing(null) }
  }
  const ready = unlocked && !recoveryCode && !mustResetPassword

  let body
  if (vault.error && vault.status === 'loading') body = <div className="alert error">Database error: {vault.error}</div>
  else if (recoveryCode) body = <RecoveryCode code={recoveryCode.code} firstTime={recoveryCode.firstTime} onDone={() => setRecoveryCode(null)} />
  else if (mustResetPassword && unlocked) body = (
    <div className="gate-wrap">
      <ChangePassword vault={vault} title="Set a new master password" hint="You unlocked with your recovery code. Choose a new master password so you can get back in next time." onDone={() => setMustResetPassword(false)} />
    </div>
  )
  else if (!unlocked) body = <VaultGate vault={vault} onRecovered={() => setMustResetPassword(true)} onRecoveryCode={(code) => setRecoveryCode({ code, firstTime: true })} />
  else if (tab === 'items') body = <VaultItems vault={vault} member={member} open={openItem} setOpen={setOpenItem} editing={editing} setEditing={setEditing} />
  else if (tab === 'generator') body = <PasswordGenerator />
  else body = <VaultSecurity vault={vault} member={member} onRecoveryCode={(code) => setRecoveryCode({ code, firstTime: false })} onOpenItem={(item) => { setTab('items'); setOpenItem(item) }} />

  return (
    <div className="app">
      <Topbar {...topbar} right={unlocked && (
        <button className="btn icon lock-btn" aria-label="Lock vault" title="Lock vault" onClick={vault.lockNow}><LockIcon /></button>
      )}>
        {ready ? (
          <nav className="tabs">
            {VAULT_TABS.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <t.icon /> {t.label}
              </button>
            ))}
          </nav>
        ) : <div className="spacer" />}
      </Topbar>
      <main className="content fade-in"><Suspense fallback={<ListSkeleton />}>{body}</Suspense></main>

      {ready && (
        <PillNav tabs={VAULT_TABS} tab={tab} setTab={setTab} withFab={tab === 'items'} />
      )}
      {ready && tab === 'items' && (
        <div className="fab-wrap">
          <button className="fab" aria-label="Add item" onClick={() => setEditing({})}><PlusIcon /></button>
        </div>
      )}
    </div>
  )
}
