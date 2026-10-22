import { useCallback, useEffect, useRef, useState } from 'react'
import { addItem, clearTicked, deleteItem, loadItems, resetItems, setCleared, setDone, updateItem } from './lists'
import { autoClearIds, repeatIds } from './listLogic'

// A list's items, kept fresh for the family: reload on focus and every 20 s while open. Ticking is optimistic.
export function useListItems(list) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const tidied = useRef(false)

  const reload = useCallback(async () => {
    try { setItems(await loadItems(list.id)); setError(null) } catch (e) { setError(e.message || String(e)) }
  }, [list.id])

  useEffect(() => {
    reload()
    const tick = () => { if (!document.hidden) reload() }
    const t = setInterval(tick, 20000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [reload])

  // Once per opening: weekly items come back, old ticked items are cleared (the list's auto-clear setting).
  useEffect(() => {
    if (!items || tidied.current) return
    tidied.current = true
    const back = repeatIds(items)
    const old = autoClearIds(items.filter((i) => !back.includes(i.id)), list.auto_clear_days)
    if (back.length || old.length) Promise.all([resetItems(back), setCleared(old)]).then(reload).catch(() => {})
  }, [items, list.auto_clear_days, reload])

  const patch = (id, fields) => setItems((cur) => cur && cur.map((i) => (i.id === id ? { ...i, ...fields } : i)))
  const guard = (p) => p.catch((e) => { setError(e.message || String(e)); reload() })

  return {
    items, error, reload,
    add: async (fields) => { const row = await addItem(list, fields); setItems((cur) => [...(cur || []), row]); return row },
    tick: (item) => { const done = !item.done; patch(item.id, { done, done_at: done ? new Date().toISOString() : null }); return guard(setDone(item.id, done)) },
    save: async (id, fields) => { patch(id, fields); await updateItem(id, fields) },
    remove: async (id) => { setItems((cur) => cur && cur.filter((i) => i.id !== id)); await deleteItem(id) },
    clear: async (tab) => { setItems((cur) => cur && cur.map((i) => (i.done && (!tab || i.tab === tab) ? { ...i, cleared: true } : i))); await guard(clearTicked(list.id, tab)) },
  }
}
