import { useState } from 'react'
import Topbar from '../Topbar'
import VaultGate from '../VaultGate'
import { GateSkeleton } from '../Skeleton'
import { useWill } from '../../lib/useWill'
import { useGujaratiFont } from '../../lib/willPrint'
import WillDetails from './WillDetails'
import WillFamily from './WillFamily'
import WillAssets from './WillAssets'
import WillSplit from './WillSplit'
import WillPdf from './WillPdf'
import { UserIcon, UsersIcon, HomeIcon, PieIcon, FileIcon, LockIcon } from '../../lib/icons'

const TABS = [
  { id: 'details', label: 'Details', icon: UserIcon },
  { id: 'family', label: 'Family', icon: UsersIcon },
  { id: 'assets', label: 'Assets', icon: HomeIcon },
  { id: 'distribution', label: 'Split', icon: PieIcon },
  { id: 'pdf', label: 'PDF', icon: FileIcon },
]

// The will is encrypted with the Vault key, so this module needs the vault unlocked.
export default function WillModule({ topbar, vault }) {
  useGujaratiFont()
  const unlocked = vault.status === 'unlocked'

  if (!unlocked) {
    return (
      <div className="app">
        <Topbar {...topbar}><div className="spacer" /></Topbar>
        <main className="content fade-in">
          {vault.status === 'setup' ? (
            <div className="card gate">
              <h2>Set up the Vault first</h2>
              <p className="muted">The will holds Aadhaar numbers, account numbers and family decisions, so it's encrypted with your Vault key. Nobody else, including PocketOS, can read it.</p>
              <button className="btn primary" onClick={() => topbar.setModule('vault')}>Go to Vault</button>
            </div>
          ) : vault.status === 'loading' ? <GateSkeleton /> : (
            <>
              <p className="muted small" style={{ textAlign: 'center' }}>The will is encrypted with your Vault. Unlock to open it.</p>
              <VaultGate vault={vault} onRecovered={() => topbar.setModule('vault')} onRecoveryCode={() => {}} />
            </>
          )}
        </main>
      </div>
    )
  }
  return <WillEditor topbar={topbar} vault={vault} />
}

function WillEditor({ topbar, vault }) {
  const [tab, setTab] = useState('details')
  const will = useWill(vault)
  const { doc, update, saveState, error } = will

  const saved = { saved: 'Saved', pending: 'Saving…', saving: 'Saving…', error: 'Not saved' }[saveState]
  return (
    <div className="app" onPointerDown={vault.touch} onKeyDown={vault.touch}>
      <Topbar {...topbar} right={<>
        <span className={`save-state ${saveState}`} aria-live="polite">{saved}</span>
        <button className="btn icon lock-btn" aria-label="Lock" title="Lock" onClick={vault.lockNow}><LockIcon /></button>
      </>}>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}><t.icon /> {t.label}</button>
          ))}
        </nav>
      </Topbar>
      <main className="content fade-in">
        {error && <div className="alert error">{error}</div>}
        {!doc ? <GateSkeleton /> : (
          <>
            {tab === 'details' && <WillDetails doc={doc} update={update} />}
            {tab === 'family' && <WillFamily doc={doc} update={update} />}
            {tab === 'assets' && <WillAssets doc={doc} update={update} />}
            {tab === 'distribution' && <WillSplit doc={doc} update={update} />}
            {tab === 'pdf' && <WillPdf will={will} goTo={setTab} />}
          </>
        )}
      </main>
      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><t.icon /> {t.label}</button>
        ))}
      </nav>
    </div>
  )
}
