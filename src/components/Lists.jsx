import { useCallback, useEffect, useState } from 'react'
import { useDialog } from '../lib/dialog'
import { useBackAction } from '../lib/backNav'
import { copyList, deleteList, loadCounts, loadHouseholds, loadLists, updateList } from '../lib/lists'
import { supabase } from '../lib/supabase'
import { daysTo, shortDate } from '../lib/listLogic'
import { today } from '../lib/format'
import ListView from './lists/ListView'
import OccasionView from './lists/OccasionView'
import SettingsSheet from './lists/SettingsSheet'
import NewSheet from './lists/NewSheet'
import TemplatesPanel from './lists/TemplatesSheet'

const VIEW_KEY = 'pocketos.listsView'
const TABS = [['active', 'Active'], ['occasions', 'Occasions'], ['archive', 'Archive']]

// Lists module (Oct 2026, the user's request: a shared place for shopping lists instead of WhatsApp, growing to whole
// occasions). Everyday lists stay and are reused; occasions add a date, tasks, samagri, people and money.
export default function Lists({ homeHouseholdId, member, openId, setOpenId, newOpen, setNewOpen, settingsOpen, setSettingsOpen }) {
  const dialog = useDialog()
  const [lists, setLists] = useState(null)
  const [counts, setCounts] = useState({})
  const [households, setHouseholds] = useState([])
  const [error, setError] = useState(null)
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem(VIEW_KEY) || 'active' } catch { return 'active' } })
  const [menu, setMenu] = useState(false)
  const [reuse, setReuse] = useState(null)
  const setTabKeep = (t) => { setTab(t); try { sessionStorage.setItem(VIEW_KEY, t) } catch { /* ignore */ } }

  const load = useCallback(async () => {
    try {
      const [l, c, h] = await Promise.all([loadLists(), loadCounts(), loadHouseholds()])
      setLists(l); setCounts(c); setHouseholds(h); setError(null)
    } catch (e) { setError(e.message || String(e)) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden && !openId) load() }, 30000)
    return () => clearInterval(t)
  }, [load, openId])

  useBackAction(!!openId || settingsOpen, () => { if (openId) setOpenId(null); else setSettingsOpen(false) }, 2)
  const open = lists?.find((l) => l.id === openId)
  const homeId = homeHouseholdId || households[0]?.id
  const nameOf = (id) => households.find((h) => h.id === id)?.name

  async function saveList(fields, opts = {}) {
    const row = await updateList(open.id, fields)
    if (opts.toTasks) await supabase.from('list_items').update({ tab: 'tasks' }).eq('list_id', open.id)
    setLists((cur) => cur.map((l) => (l.id === row.id ? row : l)))
    if (fields.archived !== undefined) setOpenId(null)
    load()
  }
  const changed = (row) => setLists((cur) => cur.map((l) => (l.id === row.id ? row : l)))

  if (open) {
    return (<>
      {open.kind === 'occasion'
        ? <OccasionView key={open.id} list={open} member={member} onBack={() => setOpenId(null)} onMenu={() => setMenu(true)} onListChanged={changed} />
        : <ListView key={open.id} list={open} onBack={() => setOpenId(null)} onMenu={() => setMenu(true)} />}
      {menu && <SettingsSheet list={open} households={households} member={member} onSave={saveList}
        onDelete={async () => { await deleteList(open.id); setOpenId(null); load() }} onClose={() => setMenu(false)} />}
    </>)
  }

  if (settingsOpen && !member) {
    return (
      <section className="ls-home fade-in">
        <h1 className="ls-title">Lists settings</h1>
        <p className="muted ls-subtitle">Starting points for new occasions</p>
        {homeId && <TemplatesPanel homeId={homeId} />}
      </section>
    )
  }

  const visible = (lists || []).filter((l) => (tab === 'archive' ? l.archived : !l.archived && (tab === 'occasions' ? l.kind === 'occasion' : l.kind === 'list')))
  const sorted = [...visible].sort((a, b) => (tab === 'archive' ? (b.event_date || b.created_at).localeCompare(a.event_date || a.created_at)
    : tab === 'occasions' ? (a.event_date || '9').localeCompare(b.event_date || '9') : 0))
  const openCount = (l) => (counts[l.id]?.open || 0)

  return (
    <section className="ls-home fade-in">
      <div className="ls-seg">{TABS.map(([id, label]) => <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTabKeep(id)}>{label}</button>)}</div>
      {error && <div className="alert error">{error}</div>}
      {!lists && !error && <div className="ls-empty">Loading…</div>}
      {sorted.map((l) => {
        const d = l.kind === 'occasion' ? daysTo(l.event_date, today()) : null
        const shared = (l.shared_with || []).map(nameOf).filter(Boolean)
        const sub = l.kind === 'occasion'
          ? [l.event_date ? shortDate(l.event_date) : 'No date yet', counts[l.id] ? `${counts[l.id].done} of ${counts[l.id].total} done` : ''].filter(Boolean).join(' · ')
          : tab === 'archive' ? 'archived' : openCount(l) ? `${openCount(l)} to buy` : 'all done'
        return (
          <div key={l.id} className="ls-card">
            <button type="button" className="ls-card-main" onClick={() => setOpenId(l.id)}>
              <span className="ls-ic">{l.icon}</span>
              <span className="ls-card-t"><b>{l.name}</b><small>{sub}</small></span>
              <span className="ls-card-r">{d !== null && d >= 0 ? <><b>{d === 0 ? 'Today' : d}</b>{d > 0 && <small>{d === 1 ? 'day' : 'days'}</small>}</> : shared.length ? <small>{shared.join(', ')}</small> : <small>Only me</small>}</span>
            </button>
            {tab === 'archive' && !member && <button type="button" className="ls-linkbtn" onClick={() => setReuse(l)}>Use again ›</button>}
          </div>
        )
      })}
      {lists && !sorted.length && (
        <div className="ls-empty">
          {tab === 'archive' ? 'Nothing archived yet.' : tab === 'occasions' ? 'No occasions yet. Tap + to plan one.' : 'No lists yet. Tap + to start Groceries.'}
        </div>
      )}
      {tab === 'active' && <p className="muted small ls-note">Every list stays; tick things off and they go to “Got it”. No new list each day.</p>}
      {newOpen && homeId && <NewSheet homeId={homeId} households={households} member={member} initialKind={tab === 'occasions' ? 'occasion' : 'list'}
        onClose={() => setNewOpen(false)} onCreated={(l) => { setNewOpen(false); setLists((cur) => [...(cur || []), l]); setOpenId(l.id); load() }} />}
      {reuse && <ReuseSheet list={reuse} onClose={() => setReuse(null)} onDone={(l) => { setReuse(null); setLists((cur) => [...cur, l]); setTabKeep(l.kind === 'occasion' ? 'occasions' : 'active'); setOpenId(l.id); load() }} dialog={dialog} />}
    </section>
  )
}

function ReuseSheet({ list, onClose, onDone, dialog }) {
  const occasion = list.kind === 'occasion'
  const [name, setName] = useState(list.name)
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  async function go(e) {
    e.preventDefault()
    setBusy(true)
    try { onDone(await copyList(list, { name: name.trim() || list.name, eventDate: date })) } catch (err) { dialog.alert(err.message || String(err)); setBusy(false) }
  }
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card modal" onSubmit={go}>
        <h3>Use “{list.name}” again</h3>
        <p className="muted small">{occasion ? 'Copies the tasks, samagri and people into a new occasion with every tick cleared. The money stays with the old Hisab book.' : 'Copies the items into a new list with every tick cleared.'}</p>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        {occasion && <label>New date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Make a copy</button></div>
      </form>
    </div>
  )
}
