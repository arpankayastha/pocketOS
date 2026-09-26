import { useMemo, useState } from 'react'
import { checkWill } from '../../lib/willChecks'
import { CLAUSES, SECTION_TITLES, clauseText } from '../../lib/willText'
import { printWill } from '../../lib/willPrint'
import { uid } from '../../lib/willModel'
import { useDialog } from '../../lib/dialog'
import WillDocument from './WillDocument'
import { GuInput } from './WillParts'
import { PencilIcon, TrashIcon, FileIcon } from '../../lib/icons'

const dateStamp = (d = new Date()) => d.toLocaleDateString('en-GB') // dd/mm/yyyy

export default function WillPdf({ will, goTo }) {
  const { doc, update, versions, saveVersion, restoreVersion, deleteVersion } = will
  const dialog = useDialog()
  const [editingClause, setEditingClause] = useState(null) // clause key or custom clause
  const [busy, setBusy] = useState(false)
  const issues = useMemo(() => checkWill(doc), [doc])
  const errors = issues.filter((i) => i.level === 'error')
  const stamp = `આવૃત્તિ: ${dateStamp()}`
  const fileName = (d) => `વસિયતનામું - ${d.testator.name || 'draft'} - ${dateStamp().replace(/\//g, '-')}`

  async function download(d = doc, versionDate) {
    if (d === doc && errors.length && !await dialog.confirm({ title: `${errors.length} problem${errors.length === 1 ? '' : 's'} found`, message: 'The will has issues that could make it unclear (listed on this page). Create the PDF anyway?', confirmLabel: 'Create PDF', danger: false })) return
    setBusy(true)
    await printWill(d, { stamp: versionDate ? `આવૃત્તિ: ${dateStamp(new Date(versionDate))}` : stamp, fileName: fileName(d) })
    setBusy(false)
  }

  async function snapshot() {
    const note = await dialog.prompt({ title: 'Save this version', label: 'What changed? (for the family)', placeholder: 'e.g. Added granddaughter; gold split changed', confirmLabel: 'Save version' })
    if (!note) return
    try { await saveVersion(note) } catch (err) { dialog.alert(err.message) }
  }

  const toggle = (key) => update((d) => ({ ...d, clauses: { ...d.clauses, [key]: { ...d.clauses[key], off: !d.clauses[key]?.off } } }))

  return (
    <section>
      <div className="card pdf-actions">
        <div className="grow">
          <h3 style={{ margin: 0 }}>Gujarati PDF</h3>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Opens your phone's print screen: choose <b>Save as PDF</b>. The PDF always reflects what's in the app right now.</p>
        </div>
        <button className="btn" onClick={snapshot}>Save version</button>
        <button className="btn primary" disabled={busy} onClick={() => download()}><FileIcon /> {busy ? 'Preparing…' : 'Download PDF'}</button>
      </div>

      <div className="card">
        <h3>Checks {issues.length === 0 && <span className="pill">all clear</span>}</h3>
        {issues.map((x, i) => (
          <button key={i} className={`issue ${x.level}`} onClick={() => goTo(x.tab)}>
            <span className="issue-dot" aria-hidden="true" />{x.text}
          </button>
        ))}
        {issues.length === 0 && <p className="muted small" style={{ margin: 0 }}>No problems found. Still get the final wording checked once by a lawyer or notary.</p>}
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Clauses</h3>
          <p className="muted small" style={{ marginTop: -6 }}>Standard Gujarati clauses. Switch any off, or reword it.</p>
          {CLAUSES.map((c) => {
            const o = doc.clauses[c.key] || {}
            return (
              <div className="line" key={c.key}>
                <label className="check grow">
                  <input type="checkbox" checked={!o.off} onChange={() => toggle(c.key)} />
                  <span>{c.label} <span className="muted small">· {SECTION_TITLES[c.section]}{o.text != null ? ' · edited' : ''}</span></span>
                </label>
                <button className="btn icon" aria-label={`Edit ${c.label}`} onClick={() => setEditingClause({ key: c.key })}><PencilIcon /></button>
              </div>
            )
          })}
          <h3 style={{ marginTop: 18 }}>Your own clauses</h3>
          {doc.custom.map((c) => (
            <div className="line" key={c.id}>
              <span className="grow ellipsis">{c.title || c.text.slice(0, 50) || 'Empty clause'}</span>
              <button className="btn icon" aria-label="Edit clause" onClick={() => setEditingClause({ custom: c })}><PencilIcon /></button>
              <button className="btn icon" aria-label="Remove clause" onClick={async () => (await dialog.confirm({ title: 'Remove this clause?', message: c.title || c.text.slice(0, 80), confirmLabel: 'Remove' })) && update((d) => ({ ...d, custom: d.custom.filter((x) => x.id !== c.id) }))}><TrashIcon /></button>
            </div>
          ))}
          <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => setEditingClause({ custom: { id: uid(), title: '', text: '' }, isNew: true })}>+ Add clause</button>
        </div>

        <div className="card">
          <h3>Saved versions</h3>
          <p className="muted small" style={{ marginTop: -6 }}>Snapshots of the will, so everyone can see what changed and when.</p>
          {versions.map((v) => (
            <div className="line" key={v.id}>
              <span className="grow"><b>{new Date(v.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</b> <span className="muted small">{v.note}</span></span>
              <button className="btn small ghost" onClick={() => download(v.doc, v.created_at)}>PDF</button>
              <button className="btn small ghost" onClick={async () => (await dialog.confirm({ title: 'Restore this version?', message: 'The current draft is replaced by this version. Save a version of the current draft first if you want to keep it.', confirmLabel: 'Restore', danger: false })) && restoreVersion(v)}>Restore</button>
              <button className="btn icon" aria-label="Delete version" onClick={async () => (await dialog.confirm({ title: 'Delete this saved version?', message: v.note })) && deleteVersion(v)}><TrashIcon /></button>
            </div>
          ))}
          {!versions.length && <p className="muted small" style={{ margin: 0 }}>None yet. Tap <b>Save version</b> when a draft is ready to share or sign.</p>}
        </div>
      </div>

      <div className="card will-preview-wrap">
        <h3>Preview</h3>
        <div className="will-preview"><WillDocument doc={doc} stamp={stamp} /></div>
      </div>

      {editingClause && <ClauseEditor doc={doc} target={editingClause} onClose={() => setEditingClause(null)}
        onSave={(value) => {
          if (editingClause.custom) {
            update((d) => ({ ...d, custom: editingClause.isNew ? [...d.custom, value] : d.custom.map((x) => (x.id === value.id ? value : x)) }))
          } else {
            update((d) => ({ ...d, clauses: { ...d.clauses, [editingClause.key]: { ...d.clauses[editingClause.key], text: value } } }))
          }
          setEditingClause(null)
        }}
        onReset={() => { update((d) => { const { text, ...rest } = d.clauses[editingClause.key] || {}; void text; return { ...d, clauses: { ...d.clauses, [editingClause.key]: rest } } }); setEditingClause(null) }} />}
    </section>
  )
}

function ClauseEditor({ doc, target, onClose, onSave, onReset }) {
  const isCustom = !!target.custom
  const [title, setTitle] = useState(target.custom?.title || '')
  const [text, setText] = useState(isCustom ? target.custom.text : clauseText(doc, target.key))
  const edited = !isCustom && doc.clauses[target.key]?.text != null
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <form className="card modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(isCustom ? { ...target.custom, title, text } : text) }}>
        <h3>{isCustom ? (target.isNew ? 'New clause' : 'Edit clause') : CLAUSES.find((c) => c.key === target.key).label}</h3>
        {isCustom && <GuInput label="Heading (optional)" value={title} onChange={setTitle} />}
        <label>Clause text (Gujarati)
          <textarea lang="gu" rows={8} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
        <div className="actions">
          {edited && <button type="button" className="btn ghost" onClick={onReset}>Reset to standard</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!text.trim()}>Save</button>
        </div>
      </form>
    </div>
  )
}
