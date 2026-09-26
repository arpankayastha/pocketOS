import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { emptyWill } from './willModel'

const SAVE_DELAY_MS = 800

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

  const loadVersions = useCallback(async (id) => {
    const { data, error } = await supabase.from('will_versions').select('id, iv, ciphertext, created_at').eq('will_id', id).order('created_at', { ascending: false })
    if (error) return setError(error.message)
    const out = []
    for (const row of data) {
      try { const v = await unseal(row); out.push({ id: row.id, created_at: row.created_at, note: v.note, doc: v.doc }) } catch { /* skip unreadable */ }
    }
    setVersions(out)
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
        setDoc({ ...emptyWill(), ...d })
        loadVersions(data[0].id)
      } catch { setError("The will couldn't be decrypted.") }
    })()
    return () => { alive = false }
  }, [unseal, loadVersions])

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
        return idRef.current
      } catch (err) {
        setError(err.message)
        setSaveState('error')
        throw err
      }
    }
    queue.current = queue.current.catch(() => {}).then(run)
    return queue.current
  }, [seal])

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
    await loadVersions(id)
  }, [doc, persist, seal, loadVersions])

  const restoreVersion = useCallback((v) => update(() => ({ ...emptyWill(), ...v.doc })), [update])

  const deleteVersion = useCallback(async (v) => {
    const { error } = await supabase.from('will_versions').delete().eq('id', v.id)
    if (error) throw new Error(error.message)
    await loadVersions(idRef.current)
  }, [loadVersions])

  return { doc, update, saveState, error, versions, saveVersion, restoreVersion, deleteVersion }
}
