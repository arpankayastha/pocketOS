import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { driveFileId, previewAvailable } from '../lib/drive'
import { CopyIcon, FileIcon, PencilIcon, TrashIcon } from '../lib/icons'
import { copySecret } from '../lib/vaultTools'
import { useDialog } from '../lib/dialog'
import { DOC_CATEGORIES, EVERYONE, REMIND_DAYS, REMIND_OPTIONS, daysUntil, docSearchText, docSubtitle, dueDate, dueLabel, dueSoon, linkHref } from '../lib/docs'
import { today } from '../lib/format'
import { ShareTags, ShareWith, useHouseholds } from './VaultItems'
import { supabase } from '../lib/supabase'

const DocPreview = lazy(() => import('./DocPreview'))

// Row/sharing info added by useVault, never encrypted into the item.
const META = ['id', 'created_at', 'updated_at', 'corrupt', 'owner_id', 'household_ids', 'mine']

// `open` (document being viewed) and `editing` ({} = new) live in DocsModule so its + button can open the form.
export default function Docs({ vault, member, open: openRaw, setOpen, editing, setEditing }) {
  const { households, members } = useHouseholds(!member)
  const [sharedBy, setSharedBy] = useState(null)
  useEffect(() => { if (member) supabase.rpc('family_owner_name').then(({ data }) => setSharedBy(data)) }, [member])
  const dialog = useDialog()
  const docs = vault.docs
  const open = openRaw && (docs.find((d) => d.id === openRaw.id) || openRaw)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('all')
  const [who, setWho] = useState('all')
  const [year, setYear] = useState('all')
  const [toast, setToast] = useState(null)

  const people = useMemo(() => [...new Set(docs.map((d) => d.member).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [docs])
  const years = useMemo(() => [...new Set(docs.map((d) => d.year).filter(Boolean))].sort().reverse(), [docs])
  const categories = useMemo(() => [...new Set([...DOC_CATEGORIES, ...docs.map((d) => d.category).filter(Boolean)])], [docs])
  const usedCats = categories.filter((c) => docs.some((d) => d.category === c))

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return docs
      .filter((d) => !d.corrupt && (cat === 'all' || d.category === cat) && (who === 'all' || d.member === who) && (year === 'all' || d.year === year))
      .filter((d) => !q || docSearchText(d).includes(q))
      .sort((a, b) => (b.year || '').localeCompare(a.year || '') || (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }))
  }, [docs, query, cat, who, year])

  const byHousehold = (d) => {
    if (d.mine) return null
    const m = members.find((x) => x.user_id === d.owner_id)
    return m ? households.find((h) => h.id === m.household_id) : null
  }
  const reminders = useMemo(() => dueSoon(docs).filter((x) => !member || x.doc.mine), [docs, member])
  // Done: a one-off reminder is cleared; a yearly one moves to next year.
  async function markDone({ doc }) {
    const data = {}
    for (const [k, v] of Object.entries(doc)) if (!META.includes(k)) data[k] = v
    if (doc.repeat === 'yearly') { const [y, m, d] = dueDate(doc).split('-'); data.expiry = `${Number(y) + 1}-${m}-${d}` } else delete data.expiry
    await vault.saveItem(data, doc.id)
  }
  async function copy(text, what) {
    try { await copySecret(text); setToast(`${what} copied`) } catch { setToast("Couldn't copy — your browser blocked clipboard access.") }
    setTimeout(() => setToast(null), 2200)
  }

  return (
    <section>
      <div className="toolbar">
        <input type="search" placeholder={`Search ${docs.length} document${docs.length === 1 ? '' : 's'}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {usedCats.length > 1 && (
        <div className="type-chips no-swipe">
          <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>All <span>{docs.length}</span></button>
          {usedCats.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c} <span>{docs.filter((d) => d.category === c).length}</span></button>)}
        </div>
      )}
      {(people.length > 1 || years.length > 1) && (
        <div className="docs-filters">
          {people.length > 1 && (
            <select aria-label="Family member" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">Everyone</option>{people.map((p) => <option key={p}>{p}</option>)}
            </select>
          )}
          {years.length > 1 && (
            <select aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="all">All years</option>{years.map((y) => <option key={y}>{y}</option>)}
            </select>
          )}
        </div>
      )}

      {reminders.length > 0 && !query.trim() && (
        <div className="card">
          <h3>Reminders <span className="muted small">due soon</span></h3>
          <div className="list">
            {reminders.map((r) => (
              <div className="txn" key={r.doc.id}>
                <span className="grow vault-row" role="button" tabIndex={0} onClick={() => setOpen(r.doc)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.doc)}>
                  <div className="ellipsis">{r.doc.title}</div>
                  <div className={`small ${r.days < 0 ? 'neg' : 'warn'}`}>{dueLabel(r.days)}{r.doc.repeat === 'yearly' ? ' · every year' : ''}</div>
                </span>
                <button type="button" className="drive-add" onClick={() => markDone(r)}>Done</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card list">
        {shown.map((d) => {
          const days = daysUntil(dueDate(d))
          const soon = days != null && days <= (Number(d.remindDays) || REMIND_DAYS)
          return (
            <div className="txn vault-row" key={d.id} role="button" tabIndex={0} onClick={() => setOpen(d)} onKeyDown={(e) => e.key === 'Enter' && setOpen(d)}>
              <span className="site-badge type" aria-hidden="true"><FileIcon /></span>
              <span className="grow">
                <div className="ellipsis">{d.title || 'Untitled'}</div>
                <div className="muted small ellipsis">{docSubtitle(d)}</div>
                {soon && <div className={`small ${days < 0 ? 'neg' : 'warn'}`}>{`Reminder ${dueLabel(days)}`}</div>}
              </span>
              <ShareTags item={d} member={member} households={households} by={byHousehold(d)} />
            </div>
          )
        })}
        {shown.length === 0 && (
          <p className="muted pad">{docs.length ? 'No documents match.' : 'No documents yet. Tap + to link a policy, report, bill or ID from Google Drive, with a note to remember it by.'}</p>
        )}
      </div>

      {open && !editing && (
        <DocView doc={open} copy={copy} onClose={() => setOpen(null)} onEdit={() => setEditing(open)}
          readOnly={member && !open.mine} sharedBy={sharedBy} by={byHousehold(open)}
          share={member ? null : { households, members, onChange: (ids) => vault.shareItem(open.id, ids) }}
          onDelete={async () => {
            if (!await dialog.confirm({ title: `Delete "${open.title}"?`, message: 'This removes it from eChopdo only. The file in Google Drive is not touched.' })) return
            await vault.deleteItem(open.id)
            setOpen(null)
          }} />
      )}
      {editing && (
        <DocForm initial={editing} people={people} categories={categories} onClose={() => setEditing(null)}
          onSave={async (data) => {
            await vault.saveItem(data, editing.id)
            setEditing(null)
            setOpen(editing.id ? { id: editing.id, ...data } : null)
          }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  )
}

function Field({ label, value, onCopy, children }) {
  if (!value && !children) return null
  return (
    <div className="field">
      <div className="muted small">{label}</div>
      <div className="field-row">
        <span className="grow field-value">{children || value}</span>
        {onCopy && <button type="button" className="btn icon" aria-label={`Copy ${label.toLowerCase()}`} onClick={onCopy}><CopyIcon /></button>}
      </div>
    </div>
  )
}

function DocView({ doc, copy, onClose, onEdit, onDelete, readOnly, sharedBy, by, share }) {
  const days = daysUntil(dueDate(doc))
  const fileId = previewAvailable ? driveFileId(doc.link) : null
  const [previewing, setPreviewing] = useState(false)
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="view-head">
          <span className="site-badge type" aria-hidden="true"><FileIcon /></span>
          <div className="grow"><h3>{doc.title}</h3><div className="muted small">{docSubtitle(doc)}</div></div>
        </div>
        {fileId && <button type="button" className="btn primary" onClick={() => setPreviewing(true)}>Preview here</button>}
        {doc.link && (
          <a className={`btn ${fileId ? '' : 'primary'}`} href={linkHref(doc.link)} target="_blank" rel="noopener noreferrer">Open in Google Drive</a>
        )}
        <Field label="Number" value={doc.number} onCopy={() => copy(doc.number, 'Number')} />
        {doc.expiry && <Field label="Reminder" value={`${dueDate(doc)} · ${dueLabel(days)}${doc.repeat === 'yearly' ? ' · every year' : ''} · ${Number(doc.remindDays) || REMIND_DAYS} days ahead`} />}
        {doc.notes && <Field label="Note / memory"><span className="notes">{doc.notes}</span></Field>}
        {share && <ShareWith item={doc} share={share} by={by} />}
        {readOnly && <div className="muted small">Shared by {sharedBy || 'the family admin'}</div>}
        <div className="actions">
          {!readOnly && <button type="button" className="btn icon" aria-label="Delete" onClick={onDelete}><TrashIcon /></button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          {!readOnly && <button type="button" className="btn primary" onClick={onEdit}><PencilIcon /> Edit</button>}
        </div>
      </div>
      {previewing && <Suspense fallback={null}><DocPreview id={fileId} link={doc.link} title={doc.title} onClose={() => setPreviewing(false)} /></Suspense>}
    </div>
  )
}

export function DocForm({ initial, people, categories, onClose, onSave }) {
  const dialog = useDialog()
  const [form, setForm] = useState(() => ({ title: '', category: 'Other', member: '', year: today().slice(0, 4), link: '', number: '', expiry: '', notes: '', ...initial }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const memberOptions = [...new Set([EVERYONE, ...people, form.member].filter(Boolean))]

  async function pick(key, label, e) {
    if (e.target.value !== '__new') return set(key)(e)
    const v = (await dialog.prompt({ title: `New ${label}`, label: label[0].toUpperCase() + label.slice(1), confirmLabel: 'Add' }))?.trim()
    if (v) setForm((f) => ({ ...f, [key]: v }))
  }

  async function pasteLink() {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      const link = text.match(/https?:\/\/[^\s<>"']+/i)?.[0]
      if (!link) return setError('Nothing that looks like a link on the clipboard. Copy the link in Drive first.')
      setError(null)
      setForm((f) => ({ ...f, link }))
    } catch { setError("Couldn't read the clipboard. Long-press the link box and paste instead.") }
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) return setError('Give the document a name.')
    setBusy(true); setError(null)
    const data = { type: 'doc' }
    for (const [k, v] of Object.entries(form)) {
      if (META.includes(k) || v === '' || v == null) continue
      if (!form.expiry && (k === 'remindDays' || k === 'repeat')) continue
      data[k] = typeof v === 'string' && k !== 'notes' ? v.trim() : v
    }
    try { await onSave(data) } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{initial.id ? 'Edit document' : 'Add document'}</h3>
        <label>Name<input autoFocus={!initial.id} placeholder="e.g. Health policy 2026" value={form.title} onChange={set('title')} /></label>
        <div className="form-field">
          <label htmlFor="doc-link">Google Drive link</label>
          <div className="field-row">
            <input id="doc-link" className="grow" type="text" inputMode="url" autoCapitalize="none" placeholder="Paste the share link (optional)" value={form.link} onChange={set('link')} />
            <button type="button" className="btn small" onClick={pasteLink}>Paste</button>
          </div>
          <span className="muted small">In Drive: ⋮ on the file → Share → Copy link, then tap Paste.</span>
        </div>
        <div className="grid2">
          <label>Category
            <select value={form.category} onChange={(e) => pick('category', 'category', e)}>
              {[...new Set([...categories, form.category])].map((c) => <option key={c}>{c}</option>)}
              <option value="__new">+ New category…</option>
            </select>
          </label>
          <label>Family member
            <select value={form.member} onChange={(e) => pick('member', 'family member', e)}>
              <option value="">—</option>
              {memberOptions.map((p) => <option key={p}>{p}</option>)}
              <option value="__new">+ Add person…</option>
            </select>
          </label>
        </div>
        <div className="grid2">
          <label>Year<input type="number" inputMode="numeric" value={form.year} onChange={set('year')} /></label>
          <label>Reminder date<input type="date" value={form.expiry} onChange={set('expiry')} /></label>
        </div>
        {form.expiry && (
          <div className="grid2">
            <label>Remind me
              <select value={form.remindDays || String(REMIND_DAYS)} onChange={set('remindDays')}>
                {REMIND_OPTIONS.map((n) => <option key={n} value={n}>{n} days before</option>)}
              </select>
            </label>
            <label>Repeats
              <select value={form.repeat || ''} onChange={set('repeat')}>
                <option value="">Once</option><option value="yearly">Every year</option>
              </select>
            </label>
          </div>
        )}
        <label>Number<input autoComplete="off" placeholder="Policy / reference number (optional)" value={form.number} onChange={set('number')} /></label>
        <label>Note / memory
          <textarea rows={4} placeholder="Anything to remember — who to call, claim status, where the paper copy is…" value={form.notes} onChange={set('notes')} />
        </label>
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Encrypting…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
