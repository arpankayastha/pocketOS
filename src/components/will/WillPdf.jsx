import { useMemo, useState } from 'react'
import { checkWill } from '../../lib/willChecks'
import { CLAUSES, SECTION_TITLES, clauseText } from '../../lib/willText'
import { printWill } from '../../lib/willPrint'
import { uid } from '../../lib/willModel'
import { useDialog } from '../../lib/dialog'
import WillDocument from './WillDocument'
import { GuInput, Help } from './WillParts'
import { PencilIcon, TrashIcon, FileIcon, EyeIcon } from '../../lib/icons'

const dateStamp = (d = new Date()) => d.toLocaleDateString('en-GB') // dd/mm/yyyy
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

// Review tab: checks, preview (full screen) → PDF, versions, change log, clause editing.
export default function WillPdf({ will, goTo, onImport }) {
  const { doc, update, versions, saveVersion, restoreVersion, deleteVersion, log } = will
  const dialog = useDialog()
  const [editingClause, setEditingClause] = useState(null) // { key } | { custom, isNew }
  const [preview, setPreview] = useState(null) // { doc, stamp } being previewed
  const [busy, setBusy] = useState(false)
  const issues = useMemo(() => checkWill(doc), [doc])
  const errors = issues.filter((i) => i.level === 'error')
  const stamp = `આવૃત્તિ: ${dateStamp()}`
  const fileName = (d) => `વસિયતનામું - ${d.testator.name || 'draft'} - ${dateStamp().replace(/\//g, '-')}`

  async function download(d, s) {
    if (d === doc && errors.length && !await dialog.confirm({ title: `${errors.length} મહત્ત્વની ખામી બાકી છે`, message: 'આ પાના પર "તપાસ"માં લખેલી ખામીઓથી વસિયતનામું અસ્પષ્ટ બની શકે. છતાં PDF બનાવવી છે?', confirmLabel: 'PDF બનાવો', cancelLabel: 'પાછા જાઓ', danger: false })) return
    setBusy(true)
    await printWill(d, { stamp: s, fileName: fileName(d) })
    setBusy(false)
  }

  async function snapshot() {
    const note = await dialog.prompt({ title: 'આ આવૃત્તિ સાચવો · Save version', label: 'શું બદલાયું? (કુટુંબ માટે નોંધ)', placeholder: 'દા.ત. પૌત્રી ઉમેરી; દાગીનાની વહેંચણી બદલી', confirmLabel: 'સાચવો' })
    if (!note) return
    try { await saveVersion(note) } catch (err) { dialog.alert(err.message) }
  }

  const toggle = (key) => update((d) => ({ ...d, clauses: { ...d.clauses, [key]: { ...d.clauses[key], off: !d.clauses[key]?.off } } }))
  const lastEdit = log[0]?.end

  const warns = issues.length - errors.length
  const [showAllLog, setShowAllLog] = useState(false)
  const shownLog = showAllLog ? log : log.slice(0, 3)

  return (
    <section className="review">
      <div className="card review-hero">
        <h2>વસિયતનામું જુઓ અને PDF બનાવો</h2>
        <Help>પહેલાં "જુઓ" દબાવી આખું વસિયતનામું વાંચો. બરાબર લાગે તો ત્યાંથી જ PDF ડાઉનલોડ કરો — ફોનમાં "Save as PDF" પસંદ કરવું.</Help>
        <div className="review-status">
          {errors.length > 0 && <span className="status-chip error">{errors.length} મહત્ત્વની ખામી</span>}
          {warns > 0 && <span className="status-chip warn">{warns} જોઈ લેવું</span>}
          {issues.length === 0 && <span className="status-chip ok">બધું બરાબર</span>}
          {lastEdit && <span className="muted small">છેલ્લો ફેરફાર: {when(lastEdit)}</span>}
        </div>
        <button className="btn primary block" onClick={() => setPreview({ doc, stamp })}><EyeIcon /> જુઓ · Preview</button>
        <button className="btn block" onClick={snapshot}>આવૃત્તિ સાચવો · Save version</button>
      </div>

      {issues.length > 0 && (
        <div className="card">
          <h3>તપાસ · Checks</h3>
          <Help>લાલ = વસિયતનામું અસ્પષ્ટ બને તેવી ખામી. પીળું = એક વાર જોઈ લેવું. દબાવવાથી તે ટેબ ખુલશે.</Help>
          {issues.map((x, i) => (
            <button key={i} className={`issue ${x.level}`} onClick={() => goTo(x.tab)}>
              <span className="issue-dot" aria-hidden="true" /><span>{x.text}</span>
            </button>
          ))}
        </div>
      )}

      <Section title="ફેરફારોની નોંધ" en="Change log" count={log.length} open>
        <Help>ક્યારે અને શું બદલાયું તેની આપમેળે નોંધ — બધાને પારદર્શિતા રહે તે માટે.</Help>
        <div className="log">
          {shownLog.map((e) => (
            <div className="log-entry" key={e.id}>
              <div className="log-when">{when(e.end)}</div>
              <ul>{e.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          ))}
          {!log.length && <p className="muted small" style={{ margin: 0 }}>હજુ કોઈ ફેરફાર નથી.</p>}
        </div>
        {log.length > 3 && <button className="btn small ghost" style={{ marginTop: 10 }} onClick={() => setShowAllLog(!showAllLog)}>{showAllLog ? 'ઓછું બતાવો' : `બધા ${log.length} ફેરફાર બતાવો`}</button>}
      </Section>

      <Section title="સાચવેલી આવૃત્તિઓ" en="Saved versions" count={versions.length}>
        <Help>તૈયાર થયેલા ડ્રાફ્ટની નકલ. જૂની આવૃત્તિ જોઈ શકાય કે પાછી લાવી શકાય.</Help>
        {versions.map((v) => (
          <div className="version" key={v.id}>
            <div className="grow">
              <div className="log-when">{when(v.created_at)}</div>
              <div>{v.note}</div>
            </div>
            <div className="version-actions">
              <button className="btn small ghost" onClick={() => setPreview({ doc: v.doc, stamp: `આવૃત્તિ: ${dateStamp(new Date(v.created_at))}` })}>જુઓ</button>
              <button className="btn small ghost" onClick={async () => (await dialog.confirm({ title: 'આ આવૃત્તિ પાછી લાવવી છે?', message: 'હાલનો ડ્રાફ્ટ આ આવૃત્તિથી બદલાઈ જશે. હાલનો ડ્રાફ્ટ રાખવો હોય તો પહેલાં તેની આવૃત્તિ સાચવી લો.', confirmLabel: 'પાછી લાવો', cancelLabel: 'રદ કરો', danger: false })) && restoreVersion(v)}>પાછી લાવો</button>
              <button className="btn icon" aria-label="Delete version" onClick={async () => (await dialog.confirm({ title: 'આ આવૃત્તિ કાઢી નાખવી છે?', message: v.note, confirmLabel: 'કાઢો', cancelLabel: 'રદ કરો' })) && deleteVersion(v)}><TrashIcon /></button>
            </div>
          </div>
        ))}
        {!versions.length && <p className="muted small" style={{ margin: 0 }}>હજુ કોઈ આવૃત્તિ સાચવી નથી. ડ્રાફ્ટ તૈયાર થાય ત્યારે ઉપર "આવૃત્તિ સાચવો" દબાવો.</p>}
      </Section>

      <Section title="કલમો" en="Clauses" count={CLAUSES.filter((c) => !doc.clauses[c.key]?.off).length + doc.custom.length}>
        <Help>વસિયતનામાની સામાન્ય કલમો. જરૂર ન હોય તો ખાનું ખાલી કરો, અથવા ✎ દબાવી લખાણ બદલો.</Help>
        {CLAUSES.map((c) => {
          const o = doc.clauses[c.key] || {}
          return (
            <div className="clause-row" key={c.key}>
              <label className="check grow">
                <input type="checkbox" checked={!o.off} onChange={() => toggle(c.key)} />
                <span>{c.gu}{o.text != null && <span className="pill">બદલેલું</span>}<span className="muted small clause-sec">{SECTION_TITLES[c.section]}</span></span>
              </label>
              <button className="btn icon" aria-label={`Edit ${c.label}`} onClick={() => setEditingClause({ key: c.key })}><PencilIcon /></button>
            </div>
          )
        })}
        <div className="sub-head">પોતાની કલમો · Your own clauses</div>
        {doc.custom.map((c) => (
          <div className="clause-row" key={c.id}>
            <span className="grow">{c.title || c.text.slice(0, 50) || 'ખાલી કલમ'}</span>
            <button className="btn icon" aria-label="Edit clause" onClick={() => setEditingClause({ custom: c })}><PencilIcon /></button>
            <button className="btn icon" aria-label="Remove clause" onClick={async () => (await dialog.confirm({ title: 'આ કલમ કાઢવી છે?', message: c.title || c.text.slice(0, 80), confirmLabel: 'કાઢો', cancelLabel: 'રદ કરો' })) && update((d) => ({ ...d, custom: d.custom.filter((x) => x.id !== c.id) }))}><TrashIcon /></button>
          </div>
        ))}
        <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => setEditingClause({ custom: { id: uid(), title: '', text: '' }, isNew: true })}>+ કલમ ઉમેરો</button>
      </Section>

      <Section title="ફાઇલમાંથી વિગત લાવો" en="Import">
        <Help>તૈયાર કરેલી .json ફાઇલમાંથી આખું વસિયતનામું લાવો. હાલની વિગત તેનાથી બદલાઈ જશે (ફેરફારોની નોંધમાં લખાશે).</Help>
        <button className="btn" onClick={onImport}>ફાઇલ પસંદ કરો</button>
      </Section>

      {preview && (
        <div className="preview-screen" role="dialog" aria-modal="true" aria-label="Preview">
          <div className="preview-bar">
            <button className="btn ghost" onClick={() => setPreview(null)}>← બંધ કરો</button>
            <span className="grow preview-title"><b>પૂર્વદર્શન</b><span className="muted small">{preview.stamp}</span></span>
            <button className="btn primary" disabled={busy} onClick={() => download(preview.doc, preview.stamp)}><FileIcon /> {busy ? 'તૈયાર થાય છે…' : 'PDF ડાઉનલોડ'}</button>
          </div>
          <div className="preview-scroll"><div className="will-preview"><WillDocument doc={preview.doc} stamp={preview.stamp} /></div></div>
        </div>
      )}

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

// Collapsible card section (keeps the review tab short on a phone).
function Section({ title, en, count, open, children }) {
  return (
    <details className="card section" open={open}>
      <summary>
        <span className="grow">{title} <span className="muted small">· {en}</span></span>
        {count != null && <span className="count">{count}</span>}
        <span className="chev" aria-hidden="true">›</span>
      </summary>
      <div className="section-body">{children}</div>
    </details>
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
        <h3>{isCustom ? (target.isNew ? 'નવી કલમ' : 'કલમ બદલો') : CLAUSES.find((c) => c.key === target.key).gu}</h3>
        {isCustom && <GuInput label="શીર્ષક (જરૂર હોય તો) · Heading" value={title} onChange={setTitle} />}
        <label>કલમનું લખાણ (ગુજરાતીમાં)
          <textarea lang="gu" rows={8} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
        <div className="actions">
          {edited && <button type="button" className="btn ghost" onClick={onReset}>મૂળ લખાણ પાછું લાવો</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>રદ કરો</button>
          <button className="btn primary" disabled={!text.trim()}>સાચવો</button>
        </div>
      </form>
    </div>
  )
}
