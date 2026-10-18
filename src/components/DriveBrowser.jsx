import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderIcon, FileIcon } from '../lib/icons'
import { FOLDER_MIME, clearDriveToken, driveFolderId, driveFileId, getCachedIndex, indexDrive, markDriveConnected, wasDriveConnected, pathNames, setCachedIndex, subtreeOf } from '../lib/drive'
import { guessCategory, guessFromPath } from '../lib/docs'

const DocPreview = lazy(() => import('./DocPreview'))

const sizeLabel = (n) => (n ? (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`) : '')
const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const countLabel = (list) => { const n = list?.length || 0; return n ? `${n} item${n === 1 ? '' : 's'}` : 'Empty' }
const stripExt = (n) => n.replace(/\.[a-z0-9]{2,5}$/i, '')

// A live window onto the Drive folder the family documents live in: nothing is copied. Names come
// from Google each time (kept in memory only), files preview in place, and any file can get a
// note / renewal date ("Add details") that is stored in eChopdo, tied to the Drive file.
export default function DriveBrowser({ vault, onAddDetails, onOpenDetails }) {
  const root = vault.driveRoot
  const [index, setIndex] = useState(getCachedIndex)
  const [state, setState] = useState({ status: getCachedIndex() ? 'ready' : 'idle' }) // idle | loading | ready | error
  const [trail, setTrail] = useState([]) // folder ids below the root
  const [query, setQuery] = useState('')
  const [previewing, setPreviewing] = useState(null)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState(null)

  // `silent`: reconnect without any prompt (Google remembers the permission); if it needs a tap, stay on the button.
  const load = useCallback(async (silent = false) => {
    setState({ status: 'loading', count: 0 })
    try {
      const idx = await indexDrive((count) => setState({ status: 'loading', count }), { interactive: !silent })
      markDriveConnected(true)
      setCachedIndex(idx); setIndex(idx); setState({ status: 'ready' })
    } catch (err) { setState(silent ? { status: 'idle' } : { status: 'error', message: err.message }) }
  }, [])
  // Connected before on this device: reconnect quietly as soon as the tab opens.
  const triedSilent = useRef(false)
  useEffect(() => {
    if (!root || index || triedSilent.current || !wasDriveConnected()) return
    triedSilent.current = true
    load(true)
  }, [root, index, load])

  // parent id → its children (folders first, then by name): one pass, reused by every list.
  const kids = useMemo(() => {
    const m = new Map()
    if (!index) return m
    for (const f of index.values()) for (const p of f.parents || []) (m.get(p) || m.set(p, []).get(p)).push(f)
    for (const list of m.values()) list.sort((a, b) => (b.mimeType === FOLDER_MIME) - (a.mimeType === FOLDER_MIME) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    return m
  }, [index])

  const known = useMemo(() => {
    const m = new Map()
    for (const d of vault.docs) { const id = driveFileId(d.link); if (id) m.set(id, d) }
    return m
  }, [vault.docs])

  async function saveRoot(e, whole) {
    e.preventDefault()
    const id = whole ? 'root' : driveFolderId(link)
    if (!id) return setLinkError('That doesn’t look like a Drive folder link. In Drive: ⋮ on the folder → Share → Copy link.')
    setLinkError(null)
    await vault.saveItem({ type: 'driveroot', title: 'Drive folder', folderId: id }, vault.driveRoot?.id)
    setTrail([]); setLink('')
  }

  if (!root) {
    return (
      <form className="card" onSubmit={saveRoot}>
        <h3>Choose your documents folder</h3>
        <p className="muted small">Browse your whole Google Drive, or paste the link of one folder that holds your documents. eChopdo only reads names and shows files — nothing is copied.</p>
        <button type="button" className="btn primary drive-whole" onClick={(e) => saveRoot(e, true)}>Use my whole Drive</button>
        <div className="muted small drive-or">or only one folder</div>
        <div className="field-row">
          <input className="grow" inputMode="url" autoCapitalize="none" placeholder="Paste the folder link" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="btn" disabled={!link.trim()}>Save</button>
        </div>
        {linkError && <div className="alert error">{linkError}</div>}
      </form>
    )
  }

  if (!index) {
    return (
      <div className="card">
        <h3>Your Drive documents</h3>
        {state.status === 'loading' ? <p className="muted">Reading your Drive… {state.count ? `${state.count} items` : ''}</p> : (
          <>
            <p className="muted small">Sign in with Google to browse and preview your folder here. It is read-only, and the file names stay in memory only.</p>
            {state.status === 'error' && <div className="alert error">{state.message}</div>}
            <button className="btn primary" onClick={() => load()}>Connect Google Drive</button>
          </>
        )}
        <div className="actions"><button className="btn link small" onClick={() => vault.deleteItem(root.id)}>Use a different folder</button></div>
      </div>
    )
  }

  const rootId = root.folderId === 'root' ? index.rootId : root.folderId
  const rootFolder = index.get(rootId)
  if (!rootFolder) {
    return (
      <div className="card">
        <p className="muted">This Google account can't see the saved folder. Sign in with the account that owns it, or choose another folder.</p>
        <div className="actions">
          <button className="btn" onClick={() => { clearDriveToken(); setIndex(null); setState({ status: 'idle' }) }}>Try another account</button>
          <button className="btn ghost" onClick={() => vault.deleteItem(root.id)}>Choose another folder</button>
        </div>
      </div>
    )
  }

  const current = trail.length ? trail[trail.length - 1] : rootId
  const q = query.trim().toLowerCase()
  const rows = q.length >= 2
    ? subtreeOf(index, rootId).filter((f) => f.name.toLowerCase().includes(q)).slice(0, 100)
    : (kids.get(current) || [])
  const crumbs = [{ id: rootId, name: rootFolder.name }, ...trail.map((id) => ({ id, name: index.get(id)?.name || '…' }))]

  function addDetails(f) {
    const names = pathNames(index, f, rootId)
    onAddDetails({ link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`, title: stripExt(f.name), category: guessCategory([...names, f.name].join(' ')), ...guessFromPath(names) })
  }

  return (
    <section>
      <div className="drive-bar">
        <input type="search" placeholder={`Search ${rootFolder.name}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn icon" onClick={() => load()} title="Read Drive again" aria-label="Refresh">↻</button>
      </div>
      {q.length < 2 && (
        <div className="drive-crumbs no-swipe">
          {crumbs.map((c, i) => (
            <button key={c.id} type="button" className={i === crumbs.length - 1 ? 'on' : ''} onClick={() => setTrail(trail.slice(0, i))}>{i > 0 && '› '}{c.name}</button>
          ))}
        </div>
      )}
      <div className="card list">
        {rows.map((f) => {
          const isFolder = f.mimeType === FOLDER_MIME
          const detail = known.get(f.id)
          const where = q.length >= 2 ? pathNames(index, f, rootId).join(' › ') : ''
          return (
            <div className="txn vault-row" key={f.id} role="button" tabIndex={0}
              onClick={() => (isFolder ? (setQuery(''), setTrail(q.length >= 2 ? [...pathIds(index, f, rootId), f.id] : [...trail, f.id])) : setPreviewing(f))}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}>
              <span className="site-badge type" aria-hidden="true">{isFolder ? <FolderIcon /> : <FileIcon />}</span>
              <span className="grow">
                <div className="ellipsis">{f.name}</div>
                <div className="muted small ellipsis">{where || (isFolder ? countLabel(kids.get(f.id)) : [dateLabel(f.modifiedTime), sizeLabel(Number(f.size))].filter(Boolean).join(' · '))}</div>
              </span>
              {!isFolder && (detail
                ? <button type="button" className="drive-tag" onClick={(e) => { e.stopPropagation(); onOpenDetails(detail) }}>Details</button>
                : <button type="button" className="drive-add" onClick={(e) => { e.stopPropagation(); addDetails(f) }} aria-label="Add details">+ Details</button>)}
              {isFolder && <span className="drive-caret" aria-hidden="true">›</span>}
            </div>
          )
        })}
        {rows.length === 0 && <p className="muted pad">{q.length >= 2 ? 'Nothing matches.' : 'This folder is empty.'}</p>}
      </div>
      <button className="btn link small drive-change" onClick={() => vault.deleteItem(root.id)}>Use a different folder</button>
      {previewing && <Suspense fallback={null}><DocPreview id={previewing.id} link={previewing.webViewLink || `https://drive.google.com/file/d/${previewing.id}/view`} title={previewing.name} onClose={() => setPreviewing(null)} /></Suspense>}
    </section>
  )
}

// Folder ids from just below the root down to an item's parent (to open a search hit's folder).
function pathIds(index, item, rootId) {
  const ids = []
  let cur = item
  for (let i = 0; i < 12 && cur; i++) {
    const parent = cur.parents?.[0]
    if (!parent || parent === rootId) break
    ids.unshift(parent)
    cur = index.get(parent)
  }
  return ids
}
