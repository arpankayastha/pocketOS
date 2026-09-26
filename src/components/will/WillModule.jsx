import { useRef, useState } from 'react'
import { useDialog } from '../../lib/dialog'
import { emptyWill } from '../../lib/willModel'
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
  { id: 'details', label: 'વિગત', icon: UserIcon },
  { id: 'family', label: 'કુટુંબ', icon: UsersIcon },
  { id: 'assets', label: 'મિલકત', icon: HomeIcon },
  { id: 'distribution', label: 'વહેંચણી', icon: PieIcon },
  { id: 'pdf', label: 'PDF', icon: FileIcon },
]
const IMPORT_NOTE = 'ફાઇલમાંથી વિગત લાવ્યા (import)'

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
              <h2>પહેલાં Vault ચાલુ કરો · Set up the Vault first</h2>
              <p className="muted">વસિયતનામામાં આધાર, ખાતા નંબર અને કુટુંબના નિર્ણયો હોય છે, એટલે તે તમારી Vault ચાવીથી સુરક્ષિત (encrypted) રહે છે — તમારા સિવાય કોઈ વાંચી ન શકે.</p>
              <button className="btn primary" onClick={() => topbar.setModule('vault')}>Vault પર જાઓ</button>
            </div>
          ) : vault.status === 'loading' ? <GateSkeleton /> : (
            <>
              <p className="muted small" style={{ textAlign: 'center' }}>વસિયતનામું સુરક્ષિત (encrypted) છે. ખોલવા માટે Vault અનલૉક કરો. · Unlock to open it.</p>
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
  const { doc, update, saveState, error, importDoc } = will
  const dialog = useDialog()
  const fileRef = useRef(null)

  // Import a will prepared as JSON: { pocketosWill: 1, doc } (or a bare doc). Replaces the current will.
  async function onFile(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    let data
    try { data = JSON.parse(await file.text()) } catch { return dialog.alert('આ ફાઇલ વાંચી શકાઈ નહીં (.json હોવી જોઈએ).') }
    const incoming = data?.pocketosWill ? data.doc : data
    if (!incoming || !incoming.testator || !Array.isArray(incoming.people)) return dialog.alert('આ ફાઇલમાં વસિયતનામાની વિગત નથી.')
    const hasContent = doc.testator.name || doc.people.length || doc.assets.length
    if (hasContent && !await dialog.confirm({ title: 'હાલની વિગત બદલવી છે?', message: `હાલનું વસિયતનામું "${file.name}" ની વિગતથી બદલાઈ જશે. જૂની વિગત રાખવી હોય તો પહેલાં "આવૃત્તિ સાચવો".`, confirmLabel: 'બદલો', cancelLabel: 'રદ કરો' })) return
    importDoc({ ...emptyWill(), ...incoming }, IMPORT_NOTE)
    setTab('details')
  }

  const saved = { saved: 'સચવાયું', pending: 'સાચવે છે…', saving: 'સાચવે છે…', error: 'સચવાયું નથી' }[saveState]
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
            {tab === 'details' && <WillDetails doc={doc} update={update} onImport={() => fileRef.current.click()} />}
            {tab === 'family' && <WillFamily doc={doc} update={update} />}
            {tab === 'assets' && <WillAssets doc={doc} update={update} />}
            {tab === 'distribution' && <WillSplit doc={doc} update={update} />}
            {tab === 'pdf' && <WillPdf will={will} goTo={setTab} onImport={() => fileRef.current.click()} />}
          </>
        )}
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
      </main>
      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><t.icon /> {t.label}</button>
        ))}
      </nav>
    </div>
  )
}
