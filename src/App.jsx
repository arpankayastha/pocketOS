import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { supabase, isConfigured } from './lib/supabase'
import { useFinanceData } from './lib/useFinanceData'
import { useVault, fingerprintHere } from './lib/useVault'
import { platformAuthenticatorAvailable, deviceName, describeWebAuthnError } from './lib/webauthn'
import { useAppLock } from './lib/useAppLock'
import { clearVaultSession } from './lib/vaultSession'
import Auth from './components/Auth'
import PendingApproval from './components/PendingApproval'
import ErrorBoundary from './components/ErrorBoundary'
import { loadSignupRequests, useApproval } from './lib/signups'
import TransactionForm from './components/TransactionForm'
import TransferForm from './components/TransferForm'
import VaultGate, { RecoveryCode } from './components/VaultGate'
import AppLockScreen, { MemberLockScreen, FingerprintSetup } from './components/AppLockScreen'
import { isMember, memberName, markFingerprint } from './lib/members'
import { firstName } from './lib/homeLogic'
import { useSwipe } from './lib/useSwipe'
import { demoIsStale, demoOwnerEmail, isDemo, leaveDemo } from './lib/demo'
import Topbar, { HouseholdMenu } from './components/Topbar'
import PillNav from './components/PillNav'
import { MODULES, memberModules } from './lib/modules'
import { useDialog } from './lib/dialog'
import { useBackAction, useBackButton } from './lib/backNav'
import { DashboardSkeleton, ListSkeleton } from './components/Skeleton'
import { BrandMark, HomeIcon, LoansIcon, BookIcon, PlanIcon, SettingsIcon, PlusIcon, KeyIcon, ShieldIcon, LockIcon, UmbrellaIcon } from './lib/icons'

// Tabs and modules load on demand (code-split), so the first screen only downloads the shell.
// The Home tab and the chart chunk are preloaded as soon as the app starts (see preloadBudget).
const loadDashboard = () => import('./components/Home')
const Home = lazy(loadDashboard)
const Transactions = lazy(() => import('./components/Transactions'))
const Plan = lazy(() => import('./components/Plan'))
const Dues = lazy(() => import('./components/Dues'))
const Loans = lazy(() => import('./components/Loans'))
const Hisab = lazy(() => import('./components/Hisab'))
const Settings = lazy(() => import('./components/Settings'))
const CaptureInbox = lazy(() => import('./components/CaptureInbox'))
const VaultItems = lazy(() => import('./components/VaultItems'))
const Emergency = lazy(() => import('./components/Emergency'))
const VaultSecurity = lazy(() => import('./components/VaultSecurity'))
const ChangePassword = lazy(() => import('./components/VaultSecurity').then((m) => ({ default: m.ChangePassword })))
const Lists = lazy(() => import('./components/Lists'))
const WillModule = lazy(() => import('./components/will/WillModule'))
function preloadBudget() {
  loadDashboard()
  import('./components/Charts')
}

// eChopdo is a shell of independent modules (see components/Topbar.jsx); each renders its own tabs.
const ACTIVE_MODULE_KEY = 'pocketos.activeModule'

// Budget has four tabs; the other screens are segments inside them (Month: Plan | Entries, Loans: Loans | Dues | Deals).
// Screen ids stay the same as before ('plan', 'transactions', 'dues', 'loans'…), so each household's saved
// "Opens on" setting keeps working. Accounts & Categories ('settings') isn't a tab: it opens from the ⚙ button.
const BUDGET_GROUPS = [
  { id: 'dashboard', label: 'Home', icon: HomeIcon, subs: [['dashboard', 'Home']] },
  { id: 'month', label: 'Month', icon: PlanIcon, subs: [['plan', 'Plan'], ['transactions', 'Entries']] },
  { id: 'loans', label: 'Loans', icon: LoansIcon, subs: [['loans', 'Loans'], ['dues', 'Dues'], ['deals', 'Deals']] },
  { id: 'hisab', label: 'Hisab', icon: BookIcon, subs: [['hisab', 'Hisab']] },
]
const groupOf = (route) => BUDGET_GROUPS.find((g) => g.subs.some(([id]) => id === route))?.id || null

const VAULT_TABS = [
  { id: 'items', label: 'Passwords', icon: KeyIcon },
  { id: 'emergency', label: 'Emergency', icon: UmbrellaIcon },
  { id: 'security', label: 'Security', icon: ShieldIcon },
]

export default function App() {
  const [session, setSession] = useState(undefined)

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
  if (session === undefined) return <Splash />
  if (!session) return <Auth />
  if (isDemo(session) && demoIsStale()) { leaveDemo(); return <Splash /> } // the app was closed while on demo: back to the owner
  return isMember(session) ? <MemberShell session={session} /> : <ApprovalGate session={session} />
}

// A new Google sign-in gets nothing until the owner approves it (Settings → Sign-up requests).
function ApprovalGate({ session }) {
  const approval = useApproval(session, false)
  if (approval.status === 'approved') return <Shell session={session} />
  if (approval.status === 'loading') return <Splash />
  return <PendingApproval session={session} approval={approval} />
}

// Same look as the pre-JS splash in index.html (classes styled there), shown while the session loads.
function Splash() {
  return <div className="splash" aria-label="Loading eChopdo"><BrandMark size={76} /><span>eChopdo</span></div>
}

function Shell({ session }) {
  const [module, setModuleState] = useState(() => {
    const saved = localStorage.getItem(ACTIVE_MODULE_KEY)
    return MODULES.some((m) => m.id === saved) ? saved : 'budget'
  })
  // The hidden Will module is never remembered, so the app always reopens on Budget / Vault.
  const setModule = (id) => { setModuleState(id); if (MODULES.some((m) => m.id === id)) localStorage.setItem(ACTIVE_MODULE_KEY, id) }
  // Vault state lives here, not in VaultModule, so switching modules doesn't lock the vault.
  const vault = useVault(session)
  useEffect(() => { preloadBudget() }, []) // fetch Home while the unlock screen is up
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

  useBackButton(() => { setToast('Press back again to close eChopdo'); setTimeout(() => setToast(null), 2000) })
  useOfferFingerprint(vault, dialog, setToast)
  useBackAction(module !== 'budget', () => setModule('budget'), 1)

  // Hidden Will: press and hold the logo, then confirm with a fingerprint (master password if
  // this device has no fingerprint set up).
  async function openWill() {
    if (module === 'will' || vault.status !== 'unlocked') return
    try {
      if (!await vault.verifyUser()) {
        const pw = await dialog.prompt({ title: 'Confirm it’s you', label: 'Vault master password', inputType: 'password', confirmLabel: 'Open' })
        if (!pw || !await vault.checkPassword(pw)) return
      }
      setModule('will')
    } catch { /* fingerprint cancelled */ }
  }

  if (vault.status === 'loading') {
    return vault.error ? (
      <div className="auth-wrap"><div className="card auth">
        <div className="brand big"><BrandMark size={28} />eChopdo</div>
        <div className="alert error">Couldn't reach the server: {vault.error}</div>
        <button className="btn primary" onClick={() => location.reload()}>Try again</button>
      </div></div>
    ) : <Splash />
  }
  if (vault.status === 'locked') return <UnlockScreen vault={vault} onRecovered={() => { setMustResetPassword(true); setModule('vault') }} />
  if (vault.status === 'setup' && appLock.locked) return <AppLockScreen appLock={appLock} vault={vault} />

  const topbar = { module, setModule, onSecret: openWill }
  return (
    // Any tap or key press counts as activity for the vault's idle auto-lock, in every module.
    <div className="shell" onPointerDownCapture={vault.touch} onKeyDownCapture={vault.touch}>
      {module === 'vault' ? <VaultModule topbar={topbar} vault={vault} mustResetPassword={mustResetPassword} setMustResetPassword={setMustResetPassword} />
        : module === 'lists' ? <ListsModule topbar={topbar} />
        : module === 'will' ? <Suspense fallback={<Splash />}><WillModule topbar={topbar} vault={vault} /></Suspense>
        : <BudgetModule topbar={topbar} email={isDemo(session) ? demoOwnerEmail() : session.user.email} fullName={isDemo(session) ? '' : session.user.user_metadata?.full_name || session.user.user_metadata?.name || ''} vault={vault} demo={isDemo(session)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

// A household member's app: their household's Budget, plus the family Vault once the owner
// enables it for them (then ONE vault fingerprint opens both, like the owner's app). Without a
// vault they're behind the per-device app lock (fingerprint, PIN as backup). No Will.
const SETUP_SKIPPED_KEY = 'pocketos.fingerprintSkipped'
const MEMBER_INFO_KEY = 'pocketos.memberInfo'
function MemberShell({ session }) {
  useEffect(() => { preloadBudget() }, [])
  // Which tab the app opens on (chosen by the owner) and the member's household. Cached per
  // device so the app opens instantly; refreshed from the server on every start.
  const [info, setInfo] = useState(() => { try { return JSON.parse(localStorage.getItem(MEMBER_INFO_KEY)) } catch { return null } })
  useEffect(() => {
    supabase.from('household_members').select('start_tab, household_id, hisab_only').eq('user_id', session.user.id).maybeSingle().then(({ data }) => {
      if (!data) return
      try { localStorage.setItem(MEMBER_INFO_KEY, JSON.stringify(data)) } catch { /* ignore */ }
      setInfo((cur) => (cur ? { ...cur, household_id: data.household_id, hisab_only: data.hisab_only } : data))
    })
  }, [session.user.id])
  const vault = useVault(session, { householdId: info?.household_id })
  const appLock = useAppLock(session)
  const dialog = useDialog()
  const [module, setModule] = useState('budget')
  const [skipped, setSkipped] = useState(() => { try { return !!sessionStorage.getItem(SETUP_SKIPPED_KEY) } catch { return false } })
  const [toast, setToast] = useState(null)
  const vaultOn = vault.status === 'locked' || vault.status === 'unlocked'

  // With a vault, its fingerprint is the one lock — switch the separate app lock off.
  const { enabled: appLockOn, disable: disableAppLock } = appLock
  useEffect(() => { if (appLockOn && vaultOn) disableAppLock() }, [appLockOn, vaultOn, disableAppLock])
  useBackButton(() => { setToast('Press back again to close eChopdo'); setTimeout(() => setToast(null), 2000) })
  useOfferFingerprint(vault, dialog, setToast)
  useBackAction(module !== 'budget', () => setModule('budget'), 1)

  if (vault.status === 'loading' || !info) return <Splash />
  if (vault.status === 'locked') return <UnlockScreen vault={vault} onRecovered={() => {}} />
  if (!vaultOn) {
    if (!appLock.enabled && !skipped) {
      return <FingerprintSetup appLock={appLock} session={session} onDone={() => markFingerprint(session.user.id)}
        onSkip={() => { try { sessionStorage.setItem(SETUP_SKIPPED_KEY, '1') } catch { /* ignore */ } setSkipped(true) }} />
    }
    if (appLock.locked) return <MemberLockScreen appLock={appLock} session={session} />
  }
  const topbar = { module, setModule, modules: memberModules(vaultOn) }
  return (
    <div className="shell" onPointerDownCapture={vault.touch} onKeyDownCapture={vault.touch}>
      {module === 'vault' && vaultOn ? <VaultModule topbar={topbar} vault={vault} member />
        : module === 'lists' ? <ListsModule topbar={topbar} member homeHouseholdId={info.household_id} />
        : <BudgetModule topbar={topbar} email={memberName(session)} member appLock={vaultOn ? null : appLock} vault={vaultOn ? vault : null} startTab={info.hisab_only ? 'hisab' : info.start_tab || 'dashboard'} hisabOnly={!!info.hisab_only} />}
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
      const yes = await dialog.confirm({ title: 'Use your fingerprint next time?', message: 'Unlock eChopdo on this phone with your fingerprint instead of typing the master password. You can change this any time in ⚙ → Security.', confirmLabel: 'Use fingerprint', cancelLabel: 'Not now', danger: false })
      if (!yes) { try { localStorage.setItem(FP_OFFER_KEY, '1') } catch { /* ignore */ } return }
      try { await addFingerprint(deviceName()); setToast('Fingerprint unlock is on'); setTimeout(() => setToast(null), 2500) }
      catch (err) { dialog.alert({ title: "Couldn't turn on fingerprint", message: describeWebAuthnError(err) }) }
    })
  }, [status, unlockers, addFingerprint, dialog, setToast])
}

// Full-screen lock: one fingerprint unlocks the vault key, which opens Budget, Vault and Will.
function UnlockScreen({ vault, onRecovered }) {
  return (
    <div className="auth-wrap">
      <div className="auth-glow" />
      <div className="unlock-wrap">
        <div className="brand big unlock-brand"><BrandMark size={28} />eChopdo</div>
        <VaultGate vault={vault} title="Unlock eChopdo" onRecovered={onRecovered} onRecoveryCode={() => {}} />
      </div>
    </div>
  )
}

function BudgetModule({ topbar, email, fullName = '', member, appLock, vault, startTab = 'dashboard', hisabOnly = false, demo = false }) {
  // A member login the owner set to "Only Hisab" sees just that tab (⚙ stays for their own settings).
  const tabs = hisabOnly ? BUDGET_GROUPS.filter((g) => g.id === 'hisab') : BUDGET_GROUPS
  // The "home" tab: where the app opens and where Android back returns to. A member's comes from
  // their login (`startTab`); the owner picks one per household ("Opens on" in the HouseholdSheet).
  const [tab, setTab] = useState(startTab)
  const [fabOpen, setFabOpen] = useState(false)
  const [quickAddKind, setQuickAddKind] = useState(null) // null | 'expense' | 'income' | 'transfer'
  const [dataVersion, setDataVersion] = useState(0)
  const [hisabAdd, setHisabAdd] = useState(0) // the + on the Hisab tab adds a Hisab entry instead
  const data = useFinanceData()
  const dialog = useDialog()
  const household = data.households.find((h) => h.id === data.activeHouseholdId)
  // The owner sees a dot on ⚙ while someone is waiting for approval.
  const [waiting, setWaiting] = useState(0)
  useEffect(() => {
    if (member || demo) return
    const load = () => loadSignupRequests().then((r) => setWaiting(r.isAdmin ? r.rows.filter((x) => x.status === 'pending').length : 0)).catch(() => {})
    load()
    window.addEventListener('signups-changed', load)
    return () => window.removeEventListener('signups-changed', load)
  }, [member, demo, tab])
  const home = member ? startTab : household?.start_tab || 'dashboard'
  useBackAction(tab !== home, () => setTab(home), 2)
  // Tapping a tab opens the screen last used in it (Month → Plan or Entries…).
  const group = groupOf(tab)
  const lastScreen = useRef({})
  useEffect(() => { if (group) lastScreen.current[group] = tab }, [group, tab])
  const openGroup = (id) => setTab(lastScreen.current[id] || BUDGET_GROUPS.find((g) => g.id === id).subs[0][0])
  const subs = BUDGET_GROUPS.find((g) => g.id === group)?.subs || []
  // Swipe left / right to move between the segments of a tab (Loans | Dues | Deals, Plan | Entries). Loans swipes anywhere
  // on the page; Month swipes on the segment bar only, because Plan and Entries use page swipes to change month.
  const at = subs.findIndex(([id]) => id === tab)
  const swipeSub = useSwipe({
    onLeft: () => { if (at >= 0 && at < subs.length - 1) setTab(subs[at + 1][0]) },
    onRight: () => { if (at > 0) setTab(subs[at - 1][0]) },
  })
  const pageSwipe = group === 'loans' ? swipeSub : {}
  const barSwipe = group !== 'loans' ? swipeSub : {}
  // Switched to "Only Hisab" after the app opened (the setting is refreshed on start): leave hidden tabs.
  useEffect(() => { if (hisabOnly && tab !== 'hisab' && tab !== 'settings') setTab('hisab') }, [hisabOnly, tab])
  // Opening the app or switching household lands on that household's home (not while in Settings).
  const seenHousehold = useRef(null)
  useEffect(() => {
    if (member || !household || seenHousehold.current === household.id) return
    const first = seenHousehold.current === null
    seenHousehold.current = household.id
    if (first || tab !== 'settings') setTab(household.start_tab || 'dashboard')
  }, [member, household, tab])

  return (
    <div className="app">
      <Topbar {...topbar} right={data.households.length > 0 && (<>
        <HouseholdMenu member={member} households={data.households} activeId={data.activeHouseholdId} onSelect={data.setActiveHouseholdId}
          onCreate={async () => {
            const name = await dialog.prompt({ title: 'New household', label: 'Name', placeholder: "e.g. Parents' Home", confirmLabel: 'Create' })
            if (name) data.createHousehold(name)
          }}
          onManage={() => setTab('settings')} />
        <button className={`btn icon settings-btn ${tab === 'settings' ? 'on' : ''}`} aria-label="Accounts & Categories" title="Accounts & Categories"
          onClick={() => setTab(tab === 'settings' ? home : 'settings')}><SettingsIcon />{waiting > 0 && <span className="badge-dot" aria-label={`${waiting} waiting for approval`} />}</button>
      </>)}>
        <nav className="tabs">
          {tabs.length > 1 && tabs.map((t) => (
            <button key={t.id} className={`tab ${group === t.id ? 'active' : ''}`} onClick={() => openGroup(t.id)}>
              <t.icon /> {t.label}
            </button>
          ))}
        </nav>
      </Topbar>
      <main className="content fade-in" {...pageSwipe}>
        {subs.length > 1 && (
          <div className="subnav" role="tablist" {...barSwipe}>
            {subs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
        )}
        {data.error && <div className="alert error">Database error: {data.error}. Did you run <code>supabase/schema.sql</code>?</div>}
        {data.loading ? (tab === 'dashboard' ? <DashboardSkeleton /> : <ListSkeleton />) : (
          <ErrorBoundary resetKey={tab}>
          <Suspense fallback={tab === 'dashboard' ? <DashboardSkeleton /> : <ListSkeleton />}>
            {['dashboard', 'transactions', 'hisab'].includes(tab) && data.activeHouseholdId && (
              <CaptureInbox householdId={data.activeHouseholdId} categories={data.categories} accounts={data.accounts}
                onFiled={() => { setDataVersion((v) => v + 1); data.refresh() }} />
            )}
            {tab === 'dashboard' && <Home key={dataVersion} {...data} name={firstName(fullName || email)} go={setTab} />}
            {tab === 'transactions' && <Transactions key={dataVersion} {...data} />}
            {tab === 'plan' && <Plan {...data} />}
            {tab === 'hisab' && <Hisab key={`${data.activeHouseholdId}:${dataVersion}`} activeHouseholdId={data.activeHouseholdId} accounts={data.accounts} addSignal={hisabAdd} />}
            {tab === 'dues' && <Dues {...data} onChanged={() => { setDataVersion((v) => v + 1); data.refresh() }} />}
            {(tab === 'loans' || tab === 'deals') && <Loans key={data.activeHouseholdId} activeHouseholdId={data.activeHouseholdId} households={data.households} member={member} view={tab} />}
            {tab === 'settings' && <Settings {...data} email={email} demo={demo} member={member} appLock={appLock} vault={vault} />}
          </Suspense>
          </ErrorBoundary>
        )}
      </main>

      {tabs.length > 1 && <PillNav tabs={tabs} tab={group} setTab={openGroup} withFab />}

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
        <button className={`fab ${fabOpen ? 'open' : ''}`} aria-label={tab === 'hisab' ? 'Add Hisab entry' : 'Add transaction'}
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

// Lists: shared checklists and occasions (see components/Lists.jsx). The + makes a new list or occasion.
function ListsModule({ topbar, member, homeHouseholdId }) {
  const [openId, setOpenId] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const homeId = homeHouseholdId || (() => { try { return localStorage.getItem('pocketos.activeHouseholdId') } catch { return null } })()
  return (
    <div className="app">
      <Topbar {...topbar} right={!member && (
        <button className={`btn icon settings-btn ${settingsOpen ? 'on' : ''}`} aria-label="Lists settings" title="Lists settings"
          onClick={() => { setOpenId(null); setSettingsOpen((v) => !v) }}><SettingsIcon /></button>
      )}><div className="spacer" /></Topbar>
      <main className="content fade-in"><ErrorBoundary resetKey={`${openId}:${settingsOpen}`}><Suspense fallback={<ListSkeleton />}>
        <Lists homeHouseholdId={homeId} member={member} openId={openId} setOpenId={setOpenId} newOpen={newOpen} setNewOpen={setNewOpen} settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen} />
      </Suspense></ErrorBoundary></main>
      {!openId && !settingsOpen && <div className="fab-wrap"><button className="fab" aria-label="New list or occasion" onClick={() => setNewOpen(true)}><PlusIcon /></button></div>}
    </div>
  )
}

function VaultModule({ topbar, vault, mustResetPassword, setMustResetPassword, member }) {
  const [tab, setTab] = useState('items')
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
  else if (tab === 'emergency') body = <Emergency vault={vault} member={member} />
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
      <main className="content fade-in"><ErrorBoundary resetKey={tab}><Suspense fallback={<ListSkeleton />}>{body}</Suspense></ErrorBoundary></main>

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
