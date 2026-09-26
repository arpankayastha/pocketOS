import { useEffect, useState } from 'react'
import { supabase, isConfigured } from './lib/supabase'
import { useFinanceData } from './lib/useFinanceData'
import Auth from './components/Auth'
import Dashboard from './components/Dashboard'
import Transactions from './components/Transactions'
import Budgets from './components/Budgets'
import Settings from './components/Settings'
import TransactionForm from './components/TransactionForm'
import { BrandMark, DashboardIcon, ListIcon, BudgetIcon, SettingsIcon, PlusIcon } from './lib/icons'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { id: 'transactions', label: 'Transactions', icon: ListIcon },
  { id: 'budgets', label: 'Budgets', icon: BudgetIcon },
  { id: 'settings', label: 'Accounts & Categories', icon: SettingsIcon },
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
  if (session === undefined) return <div className="center muted">Loading…</div>
  if (!session) return <Auth />
  return <Shell session={session} />
}

function Shell({ session }) {
  const [tab, setTab] = useState('dashboard')
  const [fabOpen, setFabOpen] = useState(false)
  const [quickAddKind, setQuickAddKind] = useState(null) // null | 'expense' | 'income'
  const [dataVersion, setDataVersion] = useState(0)
  const data = useFinanceData()

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><BrandMark size={24} /><span className="brand-text">PocketOS</span></div>
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
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon /> {t.label}
            </button>
          ))}
        </nav>
        <div className="user">
          <span className="muted small">{session.user.email}</span>
          <button className="btn ghost small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className="content">
        {data.error && <div className="alert error">Database error: {data.error}. Did you run <code>supabase/schema.sql</code>?</div>}
        {data.loading ? <div className="muted">Loading…</div> : (
          <>
            {tab === 'dashboard' && <Dashboard key={dataVersion} {...data} />}
            {tab === 'transactions' && <Transactions key={dataVersion} {...data} />}
            {tab === 'budgets' && <Budgets {...data} />}
            {tab === 'settings' && <Settings {...data} />}
          </>
        )}
      </main>

      <nav className="bottom-nav">
        {TABS.map((t) => (
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
