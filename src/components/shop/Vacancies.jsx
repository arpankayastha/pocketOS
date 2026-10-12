import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useDialog } from '../../lib/dialog'
import { Sheet, SheetActions } from './ui'

// Admin (Staff tab): job vacancies. Open ones show on the public page /#jobs (no login), which the owner
// shares on Instagram / WhatsApp. People apply by calling or WhatsApp-ing the contact number.
export default function Vacancies({ householdId, toast }) {
  const dialog = useDialog()
  const [rows, setRows] = useState(null)
  const [editing, setEditing] = useState(null) // {} new | row
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('shop_vacancies').select('*').eq('household_id', householdId).order('created_at', { ascending: false })
    if (error) toast(error.message); else setRows(data)
  }, [householdId, toast])
  useEffect(() => { load() }, [load])

  const link = `${location.origin}/#jobs`
  async function toggle(v) {
    const { error } = await supabase.from('shop_vacancies').update({ open: !v.open }).eq('id', v.id)
    if (error) toast(error.message); else load()
  }
  async function remove(v) {
    if (!await dialog.confirm({ title: `Delete “${v.title}”?`, message: 'It disappears from the jobs page.', confirmLabel: 'Delete', danger: true })) return
    const { error } = await supabase.from('shop_vacancies').delete().eq('id', v.id)
    if (error) toast(error.message); else load()
  }
  const open = (rows || []).filter((v) => v.open).length
  return (
    <div className="card" style={{ order: 6 }}>
      <div className="card-head"><h3>Job vacancies</h3><button className="btn small" onClick={() => setEditing({})}>+ Add</button></div>
      <div className="muted small">{open ? `${open} open on ` : 'Open ones show on '}<b>{link.replace(/^https?:\/\//, '')}</b></div>
      <div className="gx-btns" style={{ margin: '8px 0 4px' }}>
        <button className="btn small" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Jobs link copied'), () => toast(link))}>Copy link</button>
        <a className="btn small ghost" href={link} target="_blank" rel="noreferrer">View page</a>
      </div>
      {rows?.map((v) => (
        <div key={v.id} className="line">
          <button type="button" className="grow gx-linebtn" style={{ border: 0, padding: 0 }} onClick={() => setEditing(v)}>
            <div className="gx-ellipsis">{v.title}</div>
            <div className="muted small">{[v.timing, v.pay].filter(Boolean).join(' · ') || 'Tap to edit'}</div>
          </button>
          <button className={`btn small ${v.open ? '' : 'ghost'}`} onClick={() => toggle(v)}>{v.open ? 'Open' : 'Closed'}</button>
          <button className="btn small ghost" aria-label="Delete vacancy" onClick={() => remove(v)}>✕</button>
        </div>
      ))}
      {editing && <VacancySheet householdId={householdId} row={editing} onClose={() => setEditing(null)} onDone={(msg) => { setEditing(null); toast(msg); load() }} />}
    </div>
  )
}

function VacancySheet({ householdId, row, onClose, onDone }) {
  const [f, setF] = useState({ title: row.title || '', timing: row.timing || '', pay: row.pay || '', contact: row.contact || '', details: row.details || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function save() {
    setBusy(true)
    const v = { title: f.title.trim(), timing: f.timing.trim() || null, pay: f.pay.trim() || null, contact: f.contact.trim() || null, details: f.details.trim() || null }
    const { error } = row.id ? await supabase.from('shop_vacancies').update(v).eq('id', row.id)
      : await supabase.from('shop_vacancies').insert({ ...v, household_id: householdId })
    setBusy(false)
    if (error) { setError(error.message); return }
    onDone(row.id ? 'Vacancy saved' : 'Vacancy added — it’s on the jobs page')
  }
  return (
    <Sheet title={row.id ? 'Edit vacancy' : 'New vacancy'} sub="Shown on the public jobs page while it’s open." onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <label>Job<input autoFocus required value={f.title} onChange={set('title')} placeholder="e.g. Counter staff" /></label>
      <div className="grid2">
        <label>Timing<input value={f.timing} onChange={set('timing')} placeholder="e.g. 4 pm – 11 pm" /></label>
        <label>Salary<input value={f.pay} onChange={set('pay')} placeholder="e.g. ₹9,000 / month" /></label>
      </div>
      <label>Call / WhatsApp<input value={f.contact} onChange={set('contact')} inputMode="tel" placeholder="Number to apply on" /></label>
      <label>Details<textarea rows={3} value={f.details} onChange={set('details')} placeholder="What the work is, who can apply" /></label>
      <SheetActions onClose={onClose} busy={busy} disabled={!f.title.trim()} label={row.id ? 'Save' : 'Add vacancy'} />
    </Sheet>
  )
}
