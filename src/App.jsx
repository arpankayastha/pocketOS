import { useEffect, useState } from 'react'
import { supabase, isConfigured } from './lib/supabase'
import { useFinanceData } from './lib/useFinanceData'
import { useVault } from './lib/useVault'
import { useAppLock } from './lib/useAppLock'
import Auth from './components/Auth'
import Dashboard from './components/Dashboard'
import Transactions from './components/Transactions'
import Plan from './components/Plan'
import Settings from './components/Settings'
import TransactionForm from './components/TransactionForm'
import VaultGate, { RecoveryCode } from './components/VaultGate'
import VaultItems from './components/VaultItems'
import PasswordGenerator from './components/PasswordGenerator'
import VaultSecurity, { ChangePassword } from './components/VaultSecurity'
import AppLockScreen from './components/AppLockScreen'
import { DashboardSkeleton, ListSkeleton } from './components/Skeleton'
import { BrandMark, DashboardIcon, ListIcon, PlanIcon, SettingsIcon, PlusIcon, KeyIcon, DiceIcon, ShieldIcon } from './lib/icons'

// PocketOS is a shell of independent modules; each one renders its own tabs under the shared topbar.
const MODULES = [
  { id: 'budget', label: 'Budget' },
  { id: 'vault', label: 'Vault' },
]
const ACTIVE_MODULE_KEY = 'pocketos.activeModule'

const BUDGET_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { id: 'transactions', label: 'Transactions', icon: ListIcon },
  { id: 'plan', label: 'Plan', icon: PlanIcon },
  { id: 'settings', label: 'Accounts & Categories', icon: SettingsIcon },
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
  const setModule = (id) => { setModuleState(id); localStorage.setItem(ACTIVE_MODULE_KEY, id) }
  // Vault state lives here, not in VaultModule, so switching modules doesn't lock the vault.
  const vault = useVault(session)
  const appLock = useAppLock(session)
  const topbar = { session, module, setModule }

  if (appLock.locked) return <AppLockScreen appLock={appLock} vault={vault} />
  return module === 'vault' ? <VaultModule topbar={topbar} vault={vault} appLock={appLock} /> : <BudgetModule topbar={topbar} />
}

// Shared across modules: brand, module switcher, account. `children` is the module's own topbar content.
function Topbar({ session, module, setModule, children }) {
  return (
    <header className="topbar">
      <div className="brand"><BrandMark size={24} /><span className="brand-text">PocketOS</span></div>
      <select className="module-select" aria-label="Module" value={module} onChange={(e) => setModule(e.target.value)}>
        {MODULES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      {children}
      <div className="user">
        <span className="muted small">{session.user.email}</span>
        <button className="btn ghost small" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </header>
  )
}

function BudgetModule({ topbar }) {
  const [tab, setTab] = useState('dashboard')
  const [fabOpen, setFabOpen] = useState(false)
  const [quickAddKind, setQuickAddKind] = useState(null) // null | 'expense' | 'income'
  const [dataVersion, setDataVersion] = useState(0)
  const data = useFinanceData()

  return (
    <div className="app">
      <Topbar {...topbar}>
        {data.households.length > 0 && (
          <select className="household-select" value={data.activeHouseholdId || ''} onChange={(e) => {
            if (e.target.value === '__new__') {
              const name = prompt('New household name')
              if (name && name.trim()) data.createHousehold(name.trim())
            } else {
              data.setActiveHouseholdId(e.target.value)
            }
          }}>
            {data.households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            <option value="__new__">+ New household…</option>
          </select>
        )}
        <nav className="tabs">
          {BUDGET_TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon /> {t.label}
            </button>
          ))}
        </nav>
      </Topbar>
      <main className="content">
        {data.error && <div className="alert error">Database error: {data.error}. Did you run <code>supabase/schema.sql</code>?</div>}
        {data.loading ? (tab === 'dashboard' ? <DashboardSkeleton /> : <ListSkeleton />) : (
          <>
            {tab === 'dashboard' && <Dashboard key={dataVersion} {...data} />}
            {tab === 'transactions' && <Transactions key={dataVersion} {...data} />}
            {tab === 'plan' && <Plan {...data} />}
            {tab === 'settings' && <Settings {...data} />}
          </>
        )}
      </main>

      <nav className="bottom-nav">
        {BUDGET_TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <t.icon /> {t.label.split(' ')[0]}
          </button>
        ))}
      </nav>

      {fabOpen && <div className="fab-backdrop" onClick={() => setFabOpen(false)} />}
      <div className="fab-wrap">
        {fabOpen && (
          <div className="fab-menu">
            <button className="fab-option income" onClick={() => { setFabOpen(false); setQuickAddKind('income') }}>Income</button>
            <button className="fab-option expense" onClick={() => { setFabOpen(false); setQuickAddKind('expense') }}>Expense</button>
          </div>
        )}
        <button className={`fab ${fabOpen ? 'open' : ''}`} aria-label="Add transaction" onClick={() => setFabOpen((v) => !v)}><PlusIcon /></button>
      </div>

      {quickAddKind && !data.loading && (
        <TransactionForm accounts={data.accounts} categories={data.categories} householdId={data.activeHouseholdId} presetKind={quickAddKind}
          onClose={() => setQuickAddKind(null)}
          onSaved={() => { setQuickAddKind(null); setDataVersion((v) => v + 1); data.refresh() }} />
      )}
    </div>
  )
}

function VaultModule({ topbar, vault, appLock }) {
  const [tab, setTab] = useState('items')
  const [recoveryCode, setRecoveryCode] = useState(null) // { code, firstTime } shown once
  const [mustResetPassword, setMustResetPassword] = useState(false) // after unlocking with the recovery code
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
  else body = <VaultSecurity vault={vault} appLock={appLock} onRecoveryCode={(code) => setRecoveryCode({ code, firstTime: false })} onOpenItem={(item) => { setTab('items'); setOpenItem(item) }} />

  return (
    <div className="app" onPointerDown={vault.touch} onKeyDown={vault.touch}>
      <Topbar {...topbar}>
        {ready ? (
          <nav className="tabs">
            {VAULT_TABS.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <t.icon /> {t.label}
              </button>
            ))}
          </nav>
        ) : <div className="spacer" />}
        {unlocked && <button className="btn ghost small" onClick={vault.lockNow}>Lock</button>}
      </Topbar>
      <main className="content">{body}</main>

      {ready && (
        <nav className="bottom-nav">
          {VAULT_TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              <t.icon /> {t.label}
            </button>
          ))}
        </nav>
      )}
      {ready && tab === 'items' && (
        <div className="fab-wrap">
          <button className="fab" aria-label="Add item" onClick={() => setEditing({})}><PlusIcon /></button>
        </div>
      )}
    </div>
  )
}
