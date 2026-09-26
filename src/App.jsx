import { useEffect, useState } from 'react'
import { supabase, isConfigured } from './lib/supabase'
import { useFinanceData } from './lib/useFinanceData'
import Auth from './components/Auth'
import Dashboard from './components/Dashboard'
import Transactions from './components/Transactions'
import Budgets from './components/Budgets'
import Settings from './components/Settings'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'settings', label: 'Accounts & Categories' },
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
  const data = useFinanceData()

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">PocketOS</div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
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
            {tab === 'dashboard' && <Dashboard {...data} />}
            {tab === 'transactions' && <Transactions {...data} />}
            {tab === 'budgets' && <Budgets {...data} />}
            {tab === 'settings' && <Settings {...data} />}
          </>
        )}
      </main>
    </div>
  )
}
