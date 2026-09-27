import { useEffect, useState } from 'react'
import { supabase, isConfigured } from './lib/supabase'
import { useFinanceData } from './lib/useFinanceData'
import { useVault } from './lib/useVault'
import { useAppLock } from './lib/useAppLock'
import Auth from './components/Auth'
import Dashboard from './components/Dashboard'
import Transactions from './components/Transactions'
import Plan from './components/Plan'
import Dues from './components/Dues'
import Hisab from './components/Hisab'
import Settings from './components/Settings'
import TransactionForm from './components/TransactionForm'
import TransferForm from './components/TransferForm'
import VaultGate, { RecoveryCode } from './components/VaultGate'
import VaultItems from './components/VaultItems'
import PasswordGenerator from './components/PasswordGenerator'
import VaultSecurity, { ChangePassword } from './components/VaultSecurity'
import AppLockScreen from './components/AppLockScreen'
import WillModule from './components/will/WillModule'
import Topbar, { HouseholdMenu } from './components/Topbar'
import PillNav from './components/PillNav'
import { MODULES } from './lib/modules'
import { useDialog } from './lib/dialog'
import { useBackAction, useBackButton } from './lib/backNav'
import { DashboardSkeleton, ListSkeleton } from './components/Skeleton'
import { BrandMark, HomeIcon, DuesIcon, BookIcon, ListIcon, PlanIcon, SettingsIcon, PlusIcon, KeyIcon, DiceIcon, ShieldIcon, LockIcon } from './lib/icons'

// PocketOS is a shell of independent modules (see components/Topbar.jsx); each renders its own tabs.
const ACTIVE_MODULE_KEY = 'pocketos.activeModule'

// Accounts & Categories ('settings') isn't a tab: it opens from the ⚙ button in the header.
const BUDGET_TABS = [
  { id: 'dashboard', label: 'Home', icon: HomeIcon },
  { id: 'transactions', label: 'Entries', icon: ListIcon },
  { id: 'plan', label: 'Plan', icon: PlanIcon },
  { id: 'dues', label: 'Dues', icon: DuesIcon },
  { id: 'hisab', label: 'Hisab', icon: BookIcon },
]

const VAULT_TABS = [
  { id: 'items', label: 'Passwords', icon: KeyIcon },
  { id: 'generator', label: 'Generator', icon: DiceIcon },
  { id: 'security', label: 'Security', icon: ShieldIcon },
]

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    if (!isConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
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
  return <Shell session={session} />
}

// Same look as the pre-JS splash in index.html (classes styled there), shown while the session loads.
function Splash() {
  return <div className="splash" aria-label="Loading PocketOS"><BrandMark size={76} /><span>PocketOS</span></div>
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

  useBackButton(() => { setToast('Press back again to close PocketOS'); setTimeout(() => setToast(null), 2000) })
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
        <div className="brand big"><BrandMark size={28} />PocketOS</div>
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
        : module === 'will' ? <WillModule topbar={topbar} vault={vault} />
        : <BudgetModule topbar={topbar} email={session.user.email} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

// Full-screen lock: one fingerprint unlocks the vault key, which opens Budget, Vault and Will.
function UnlockScreen({ vault, onRecovered }) {
  return (
    <div className="auth-wrap">
      <div className="auth-glow" />
      <div className="unlock-wrap">
        <div className="brand big unlock-brand"><BrandMark size={28} />PocketOS</div>
        <VaultGate vault={vault} title="Unlock PocketOS" onRecovered={onRecovered} onRecoveryCode={() => {}} />
      </div>
    </div>
  )
}

function BudgetModule({ topbar, email }) {
  const [tab, setTab] = useState('dashboard')
  useBackAction(tab !== 'dashboard', () => setTab('dashboard'), 2)
  const [fabOpen, setFabOpen] = useState(false)
  const [quickAddKind, setQuickAddKind] = useState(null) // null | 'expense' | 'income' | 'transfer'
  const [dataVersion, setDataVersion] = useState(0)
  const [hisabAdd, setHisabAdd] = useState(0) // the + on the Hisab tab adds a Hisab entry instead
  const data = useFinanceData()
  const dialog = useDialog()

  return (
    <div className="app">
      <Topbar {...topbar} right={data.households.length > 0 && (<>
        <HouseholdMenu households={data.households} activeId={data.activeHouseholdId} onSelect={data.setActiveHouseholdId}
          onCreate={async () => {
            const name = await dialog.prompt({ title: 'New household', label: 'Name', placeholder: "e.g. Parents' Home", confirmLabel: 'Create' })
            if (name) data.createHousehold(name)
          }}
          onManage={() => setTab('settings')} />
        <button className={`btn icon settings-btn ${tab === 'settings' ? 'on' : ''}`} aria-label="Accounts & Categories" title="Accounts & Categories"
          onClick={() => setTab(tab === 'settings' ? 'dashboard' : 'settings')}><SettingsIcon /></button>
      </>)}>
        <nav className="tabs">
          {BUDGET_TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon /> {t.label}
            </button>
          ))}
        </nav>
      </Topbar>
      <main className="content fade-in">
        {data.error && <div className="alert error">Database error: {data.error}. Did you run <code>supabase/schema.sql</code>?</div>}
        {data.loading ? (tab === 'dashboard' ? <DashboardSkeleton /> : <ListSkeleton />) : (
          <>
            {tab === 'dashboard' && <Dashboard key={dataVersion} {...data} />}
            {tab === 'transactions' && <Transactions key={dataVersion} {...data} />}
            {tab === 'plan' && <Plan {...data} />}
            {tab === 'hisab' && <Hisab key={data.activeHouseholdId} activeHouseholdId={data.activeHouseholdId} addSignal={hisabAdd} />}
            {tab === 'dues' && <Dues {...data} onChanged={() => { setDataVersion((v) => v + 1); data.refresh() }} />}
            {tab === 'settings' && <Settings {...data} email={email} />}
          </>
        )}
      </main>

      <PillNav tabs={BUDGET_TABS} tab={tab} setTab={setTab} withFab />

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

function VaultModule({ topbar, vault, mustResetPassword, setMustResetPassword }) {
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
  else if (tab === 'items') body = <VaultItems vault={vault} open={openItem} setOpen={setOpenItem} editing={editing} setEditing={setEditing} />
  else if (tab === 'generator') body = <PasswordGenerator />
  else body = <VaultSecurity vault={vault} onRecoveryCode={(code) => setRecoveryCode({ code, firstTime: false })} onOpenItem={(item) => { setTab('items'); setOpenItem(item) }} />

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
      <main className="content fade-in">{body}</main>

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
