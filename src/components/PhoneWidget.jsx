import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDialog } from '../lib/dialog'
import { householdColor } from '../lib/colors'
import { TrashIcon } from '../lib/icons'
import { newPairCode, pairCodeHash, pairIntentUrl, phoneSettingsUrl } from '../lib/quickDevices'

// Settings → Phone widget: pair the eChopdo Android app (home-screen quick add) with a
// household, choose what its quick-add form saves by default, and unpair phones.
export default function PhoneWidget({ Collapsible, households, activeHouseholdId, member }) {
  const dialog = useDialog()
  const [devices, setDevices] = useState(null)
  const [error, setError] = useState(null)
  const [pairing, setPairing] = useState(null) // { id, code, expires, householdId }
  const [pairHousehold, setPairHousehold] = useState(activeHouseholdId)
  const [defaultTarget, setDefaultTarget] = useState('hisab')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('quick_devices')
      .select('id, household_id, name, default_target, auto_capture, paired_at, last_used_at, pair_expires, created_at').order('created_at')
    if (error) return setError(error.message)
    setDevices(data)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPairHousehold(activeHouseholdId) }, [activeHouseholdId])

  // While a code is on screen, watch for the phone to use it.
  useEffect(() => {
    if (!pairing || pairing.done) return
    const t = setInterval(async () => {
      const { data } = await supabase.from('quick_devices').select('paired_at, name').eq('id', pairing.id).maybeSingle()
      if (data?.paired_at) { setPairing((p) => ({ ...p, done: true, name: data.name })); load() }
      else if (Date.now() > pairing.expires) setPairing((p) => ({ ...p, expired: true }))
    }, 3000)
    return () => clearInterval(t)
  }, [pairing, load])

  // Unused codes don't need to stay around.
  const paired = (devices || []).filter((d) => d.paired_at)
  async function startPairing() {
    setError(null)
    await supabase.from('quick_devices').delete().is('paired_at', null)
    const code = newPairCode()
    const expires = Date.now() + 10 * 60_000
    const { data, error } = await supabase.from('quick_devices').insert({
      household_id: pairHousehold, default_target: defaultTarget, pair_code_hash: await pairCodeHash(code), pair_expires: new Date(expires).toISOString(),
    }).select('id').single()
    if (error) return setError(error.message)
    setPairing({ id: data.id, code, expires, householdId: pairHousehold })
  }
  async function cancelPairing() {
    if (pairing && !pairing.done) await supabase.from('quick_devices').delete().eq('id', pairing.id)
    setPairing(null); load()
  }
  async function setTarget(d, target) {
    setDevices((list) => list.map((x) => (x.id === d.id ? { ...x, default_target: target } : x)))
    const { error } = await supabase.from('quick_devices').update({ default_target: target }).eq('id', d.id)
    if (error) { setError(error.message); load() }
  }
  async function setAuto(d, auto) {
    setDevices((list) => list.map((x) => (x.id === d.id ? { ...x, auto_capture: auto } : x)))
    const { error } = await supabase.from('quick_devices').update({ auto_capture: auto }).eq('id', d.id)
    if (error) { setError(error.message); load() }
  }
  async function remove(d) {
    if (!await dialog.confirm({ title: `Unpair "${d.name}"?`, message: 'Its widget stops adding entries until the phone is paired again. Entries already added stay.', confirmLabel: 'Unpair' })) return
    const { error } = await supabase.from('quick_devices').delete().eq('id', d.id)
    if (error) return setError(error.message)
    load()
  }
  const hhName = (id) => households.find((h) => h.id === id)?.name || ''
  const showHousehold = !member && households.length > 1

  return (
    <Collapsible id="phone-widget" title="Phone widget"
      summary={devices ? (paired.length ? `${paired.length} phone${paired.length === 1 ? '' : 's'} paired` : 'Not set up') : null}>
      <p className="muted small">The eChopdo Android app adds a home-screen widget, an app-icon shortcut and a quick-settings tile to add entries in a few taps. A paired phone can only <b>add</b> entries to its household — it can't read anything.</p>

      {paired.length > 0 && (
        <div className="pw-list">
          {paired.map((d) => (
            <div className="pw-row" key={d.id}>
              <div className="pw-main">
                <div className="pw-name">
                  {showHousehold && <span className="pw-dot" style={{ '--c': householdColor(households.find((h) => h.id === d.household_id) || {}, households) }} />}
                  {d.name}{showHousehold && <span className="muted small"> · {hhName(d.household_id)}</span>}
                </div>
                <div className="muted small">{d.last_used_at ? `Last used ${new Date(d.last_used_at).toLocaleDateString()}` : 'Not used yet'}</div>
              </div>
              <div className="seg pw-seg" role="group" aria-label={`${d.name} saves to`}>
                <button type="button" className={d.default_target === 'hisab' ? 'on' : ''} onClick={() => setTarget(d, 'hisab')}>Hisab</button>
                <button type="button" className={d.default_target === 'budget' ? 'on' : ''} onClick={() => setTarget(d, 'budget')}>Budget</button>
              </div>
              <button type="button" className="btn icon" aria-label={`Unpair ${d.name}`} onClick={() => remove(d)}><TrashIcon /></button>
              <label className="check-line pw-auto"><input type="checkbox" checked={d.auto_capture !== false} onChange={(e) => setAuto(d, e.target.checked)} />
                Bank SMS: add payments automatically {d.auto_capture === false && <span className="muted">(off — they wait in “Bank payments to add”)</span>}</label>
            </div>
          ))}
          <p className="muted small">Hisab / Budget is what the quick-add form opens on; it can be switched there for one entry.</p>
          <a className="btn" href={phoneSettingsUrl()}>📱 Phone settings · Bank SMS &amp; widgets</a>
          <p className="muted small">Opens the eChopdo app's settings on this phone: turn on reading bank SMS, add the widgets.</p>
        </div>
      )}

      {pairing ? (
        <div className="pw-pair">
          {pairing.done ? (
            <div className="alert ok">✓ Paired “{pairing.name}”. Long-press the home screen → Widgets → eChopdo to add the widget.</div>
          ) : pairing.expired ? (
            <div className="alert error">The code expired. Make a new one.</div>
          ) : (
            <>
              <div className="muted small">Code for {hhName(pairing.householdId) || 'this household'} · valid 10 minutes</div>
              <div className="pw-code">{pairing.code.slice(0, 4)}-{pairing.code.slice(4)}</div>
              <a className="btn primary" href={pairIntentUrl(pairing.code)}>Pair this phone</a>
              <div className="muted small">On another phone: open the eChopdo app → <b>Pair</b> and type the code.</div>
            </>
          )}
          <button type="button" className="btn ghost small" onClick={cancelPairing}>{pairing.done || pairing.expired ? 'Done' : 'Cancel'}</button>
        </div>
      ) : (
        <div className="pw-new">
          {showHousehold && (
            <label>Household
              <select value={pairHousehold || ''} onChange={(e) => setPairHousehold(e.target.value)}>
                {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </label>
          )}
          <label>Quick add saves to
            <div className="seg">
              <button type="button" className={defaultTarget === 'hisab' ? 'on' : ''} onClick={() => setDefaultTarget('hisab')}>Hisab</button>
              <button type="button" className={defaultTarget === 'budget' ? 'on' : ''} onClick={() => setDefaultTarget('budget')}>Budget</button>
            </div>
          </label>
          <div className="pw-actions">
            <button type="button" className="btn primary" disabled={!pairHousehold} onClick={startPairing}>Pair a phone</button>
            <a className="btn" href="/download/">Get the Android app</a>
          </div>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
    </Collapsible>
  )
}
