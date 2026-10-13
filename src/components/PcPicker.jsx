import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Owner (13 Oct): "someone wants a specific PC — PC1…PC5". After the time and length are picked, choose
// Any PC or one PC; PCs taken for that time (playing then, or booked by name) are greyed out.
// rpc public_free_systems (public: names and free / taken only). PS5 has no choice (one console).
export default function PcPicker({ kind, start, minutes, value, onChange }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    if (kind !== 'PC' || !start) { setList(null); return }
    let live = true
    supabase.rpc('public_free_systems', { p_kind: kind, p_start: start, p_minutes: minutes }).then(({ data }) => {
      if (!live) return
      setList(data || [])
      if (value && !(data || []).some((x) => x.id === value && x.free)) onChange(null)
    })
    return () => { live = false }
  }, [kind, start, minutes]) // eslint-disable-line react-hooks/exhaustive-deps
  if (kind !== 'PC' || !start || !list?.length) return null
  return (<>
    <div className="caps muted">Which PC</div>
    <div className="chips">
      <button type="button" className={`chip chip-btn ${!value ? 'on' : ''}`} onClick={() => onChange(null)}>Any PC</button>
      {list.map((x) => (
        <button type="button" key={x.id} disabled={!x.free} title={x.free ? '' : 'Taken at this time'}
          className={`chip chip-btn ${value === x.id ? 'on' : ''} ${x.free ? '' : 'taken'}`} onClick={() => onChange(x.id)}>{x.name}</button>
      ))}
    </div>
  </>)
}
