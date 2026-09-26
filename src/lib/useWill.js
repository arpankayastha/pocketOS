import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { emptyWill } from './willModel'
import { diffWill } from './willDiff'

const SAVE_DELAY_MS = 800
const LOG_SESSION_MS = 30 * 60_000 // edits within 30 minutes are merged into one log entry
const IMPORT = Symbol('import') // marks a save that came from importDoc

// Loads the (single) will, decrypted with the Vault key, and auto-saves edits (debounced).
// Only use while the vault is unlocked.
export function useWill({ seal, unseal }) {
  const [doc, setDoc] = useState(null)
  const idRef = useRef(null) // will row id, once it exists
  const queue = useRef(Promise.resolve()) // saves run one at a time (so the first insert can't happen twice)
  const [saveState, setSaveState] = useState('saved') // saved | pending | saving | error
  const [versions, setVersions] = useState([]) // [{ id, created_at, note, doc }]
  const [error, setError] = useState(null)
  const timer = useRef(null)
  const latest = useRef(null)
  const dirty = useRef(false) // edits not yet handed to persist()
  const pendingNote = useRef(null) // IMPORT when the next save comes from an import
  const importNote = useRef(null) // its label for the log
  const [log, setLog] = useState([]) // [{ id, start, end, changes }], newest first
  const lastSaved = useRef(null) // doc as last saved (baseline for the change log)
  const session = useRef(null) // current log entry: { id, start, baseline, extra: [text] }

  const loadVersions = useCallback(async (id) => {
    const { data, error } = await supabase.from('will_versions').select('id, iv, ciphertext, created_at').eq('will_id', id).order('created_at', { ascending: false })
    if (error) return setError(error.message)
    const out = []
    for (const row of data) {
      try { const v = await unseal(row); out.push({ id: row.id, created_at: row.created_at, note: v.note, doc: v.doc }) } catch { /* skip unreadable */ }
    }
    setVersions(out)
    const logs = await supabase.from('will_log').select('id, iv, ciphertext').eq('will_id', id)
    if (logs.error) return setError(logs.error.message)
    const entries = []
    for (const row of logs.data) {
      try { entries.push({ id: row.id, ...(await unseal(row)) }) } catch { /* skip unreadable */ }
    }
    setLog(entries.sort((a, b) => b.end.localeCompare(a.end)))
  }, [unseal])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await supabase.from('wills').select('id, iv, ciphertext, updated_at').order('created_at').limit(1)
      if (!alive) return
      if (error) return setError(error.message)
      if (!data.length) { setDoc(emptyWill()); return }
      try {
        const d = await unseal(data[0])
        if (!alive) return
        idRef.current = data[0].id
        lastSaved.current = { ...emptyWill(), ...d }
        setDoc(lastSaved.current)
        loadVersions(data[0].id)
      } catch { setError("The will couldn't be decrypted.") }
    })()
    return () => { alive = false }
  }, [unseal, loadVersions])

  // Records what changed since the start of the current editing session (diffed from that
  // session's baseline, so undoing an edit removes it from the entry again).
  const writeLog = useCallback(async (next, extra) => {
    const now = new Date().toISOString()
    const put = async (entry) => {
      const sealed = await seal(entry.id, entry.payload)
      const { error } = entry.saved
        ? await supabase.from('will_log').update({ ...sealed, updated_at: now }).eq('id', entry.id)
        : await supabase.from('will_log').insert({ id: entry.id, will_id: idRef.current, ...sealed })
      if (error) throw error
      setLog((l) => [{ id: entry.id, ...entry.payload }, ...l.filter((e) => e.id !== entry.id)])
    }
    // First save or an import: a standalone entry, then later edits diff against the new content.
    if (!lastSaved.current || extra === IMPORT) {
      lastSaved.current = next
      session.current = null
      const changes = lastSaved.current && extra === IMPORT
        ? [importNote.current || 'ફાઇલમાંથી વિગત લાવ્યા', `${next.people.length} વ્યક્તિ, ${next.assets.length} મિલકત`]
        : ['વસિયતનામું શરૂ કર્યું']
      return put({ id: crypto.randomUUID(), payload: { start: now, end: now, changes } })
    }
    if (!session.current || Date.now() - Date.parse(session.current.start) > LOG_SESSION_MS) {
      session.current = { id: crypto.randomUUID(), start: now, baseline: lastSaved.current, extra: [], saved: false }
    }
    const s = session.current
    if (extra) s.extra.push(extra)
    lastSaved.current = next
    const changes = [...s.extra, ...diffWill(s.baseline, next)]
    if (!changes.length) return
    await put({ id: s.id, saved: s.saved, payload: { start: s.start, end: now, changes } })
    s.saved = true
  }, [seal])

  const persist = useCallback((next) => {
    const run = async () => {
      setSaveState('saving')
      try {
        if (!idRef.current) {
          const id = crypto.randomUUID()
          const { error } = await supabase.from('wills').insert({ id, ...(await seal(id, next)) })
          if (error) throw error
          idRef.current = id
        } else {
          const { error } = await supabase.from('wills').update({ ...(await seal(idRef.current, next)), updated_at: new Date().toISOString() }).eq('id', idRef.current)
          if (error) throw error
        }
        setSaveState(latest.current === next ? 'saved' : 'pending')
        await writeLog(next, pendingNote.current).catch(() => {}) // the log is best-effort; never block saving
        pendingNote.current = null
        return idRef.current
      } catch (err) {
        setError(err.message)
        setSaveState('error')
        throw err
      }
    }
    queue.current = queue.current.catch(() => {}).then(run)
    return queue.current
  }, [seal, writeLog])

  // `update(fn)` — fn receives the current doc and returns the next one.
  const update = useCallback((fn) => {
    setDoc((d) => {
      const next = fn(d)
      latest.current = next
      return next
    })
    setSaveState('pending')
    dirty.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { dirty.current = false; persist(latest.current).catch(() => {}) }, SAVE_DELAY_MS)
  }, [persist])

  // Flush pending edits when leaving (module switch, lock).
  useEffect(() => () => {
    clearTimeout(timer.current)
    if (dirty.current) { dirty.current = false; persist(latest.current).catch(() => {}) }
  }, [persist])

  const saveVersion = useCallback(async (note) => {
    clearTimeout(timer.current)
    dirty.current = false
    const id = await persist(doc)
    const vid = crypto.randomUUID()
    const { error } = await supabase.from('will_versions').insert({ id: vid, will_id: id, ...(await seal(vid, { note, doc })) })
    if (error) throw new Error(error.message)
    await writeLog(doc, `આવૃત્તિ સાચવી: ${note}`).catch(() => {})
    await loadVersions(id)
  }, [doc, persist, seal, loadVersions, writeLog])

  // Replaces the whole will (e.g. from a prefill file); logged as a fresh entry.
  const importDoc = useCallback((imported, label) => {
    update(() => ({ ...emptyWill(), ...imported }))
    pendingNote.current = IMPORT
    importNote.current = label
  }, [update])

  const restoreVersion = useCallback((v) => update(() => ({ ...emptyWill(), ...v.doc })), [update])

  const deleteVersion = useCallback(async (v) => {
    const { error } = await supabase.from('will_versions').delete().eq('id', v.id)
    if (error) throw new Error(error.message)
    await loadVersions(idRef.current)
  }, [loadVersions])

  return { doc, update, saveState, error, versions, saveVersion, restoreVersion, deleteVersion, log, importDoc }
}
