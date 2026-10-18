import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadDues } from '../lib/dues'
import { today } from '../lib/format'
import { useDialog } from '../lib/dialog'
import { PencilIcon, TrashIcon, PlusIcon } from '../lib/icons'
import { LINKABLE, SECTIONS, TITLE, describe, emptyEmergency, linkable, reviewState } from '../lib/emergency'
import { printEmergency } from '../lib/emergencyPrint'
import { ShareWith, useHouseholds } from './VaultItems'
import EmergencyDoc from './EmergencyDoc'

const META = ['id', 'created_at', 'updated_at', 'corrupt', 'owner_id', 'household_ids', 'mine']
const newId = () => crypto.randomUUID()

// Budget data the sheet shows live (nothing is copied): accounts and cards, Plan commitments, open Dues.
function useLive(data, enabled) {
  const [live, setLive] = useState({ accounts: [], plan: [], dues: [], households: [] })
  useEffect(() => {
    if (!enabled) return
    let alive = true
    ;(async () => {
      const [hh, acc, plan] = await Promise.all([
        supabase.from('households').select('id, name').order('created_at'),
        supabase.from('accounts').select('id, name, type, bank, digits, household_id').order('name'),
        supabase.from('recurring_items').select('id, name, category, kind, expected_amount, day_of_month, active, due_id, auto_card, household_id').eq('active', true).eq('kind', 'expense'),
      ])
      const households = hh.data || []
      const hname = (id) => households.find((h) => h.id === id)?.name || ''
      let dues = []
      if (data.live.dues) {
        for (const h of households) {
          try { dues = dues.concat((await loadDues(h.id)).filter((d) => Math.abs(d.balance) > 0.5).map((d) => ({ ...d, household: h.name }))) } catch { /* skip */ }
        }
      }
      if (!alive) return
      setLive({
        households,
        accounts: data.live.accounts ? (acc.data || []).filter((a) => a.bank || a.digits?.length || a.type === 'card').map((a) => ({ ...a, household: hname(a.household_id) })) : [],
        plan: data.live.plan ? (plan.data || []).filter((p) => !p.auto_card && !p.due_id).map((p) => ({ ...p, household: hname(p.household_id) })) : [],
        dues,
      })
    })()
    return () => { alive = false }
  }, [enabled, data.live.accounts, data.live.plan, data.live.dues])
  return live
}

export default function Emergency({ vault, member }) {
  const dialog = useDialog()
  const sheet = vault.emergency
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { households, members } = useHouseholds(!member)

  const data = useMemo(() => {
    const base = emptyEmergency()
    return sheet ? { ...base, ...sheet, live: { ...base.live, ...(sheet.live || {}) } } : base
  }, [sheet])
  const shown = editing ? draft : data
  const live = useLive(shown, !!sheet || editing)
  const linkedIds = new Set(shown.vaultIds || [])
  const linked = (vault.items || []).filter((i) => linkedIds.has(i.id) && LINKABLE[i.type])
  const readOnly = member && !(sheet && sheet.mine)

  function startEdit() {
    // First time: suggest everything already in the Vault that belongs on the sheet.
    const d = sheet ? { ...data } : { ...emptyEmergency(), vaultIds: linkable(vault.items).map((i) => i.id) }
    setDraft(JSON.parse(JSON.stringify(d)))
    setEditing(true); setError(null)
  }
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))

  async function save(extra = {}) {
    setBusy(true); setError(null)
    try {
      const out = {}
      for (const [k, v] of Object.entries({ ...draft, ...extra })) if (!META.includes(k)) out[k] = v
      out.people = out.people.filter((p) => p.name || p.phone)
      await vault.saveItem({ ...out, type: 'emergency', title: 'Emergency sheet' }, sheet?.id)
      setEditing(false)
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function markReviewed() {
    const out = {}
    for (const [k, v] of Object.entries(data)) if (!META.includes(k)) out[k] = v
    await vault.saveItem({ ...out, reviewedAt: today(), type: 'emergency', title: 'Emergency sheet' }, sheet?.id)
  }

  async function print() {
    const ok = await dialog.confirm({ title: 'Print or save a copy?', message: 'The copy shows account details, policy numbers and phone numbers (account numbers show the last 4 digits only). Keep it somewhere safe — a locker or with someone you trust.', confirmLabel: 'Continue', danger: false })
    if (ok) printEmergency({ data, linked, live })
  }

  const review = reviewState(data.reviewedAt)

  if (!sheet && !editing) {
    return (
      <div className="card">
        <h3>{TITLE.en} <span className="muted" lang="gu">· {TITLE.gu}</span></h3>
        <p className="muted small">One page for the family: who to call, where the money, policies and papers are, and how to get in. Bank accounts, policies and contacts you've saved in the Vault, and your Budget accounts and Plan commitments, are shown live — you only add the human parts.</p>
        <p className="muted small" lang="gu">પરિવાર માટે એક પાનું: કોને ફોન કરવો, પૈસા, પૉલિસી અને કાગળો ક્યાં છે, અને ખોલવાની રીત. વૉલ્ટમાં સાચવેલાં ખાતાં, પૉલિસી અને સંપર્કો આપોઆપ દેખાશે — તમારે માત્ર માનવીય બાબતો લખવી.</p>
        {readOnly ? <p className="muted small">The owner hasn't shared an emergency sheet yet.</p> : <button className="btn primary" onClick={startEdit}>Set up the sheet</button>}
      </div>
    )
  }

  if (editing) {
    return (
      <form className="emg-edit" onSubmit={(e) => { e.preventDefault(); save() }}>
        <h3>{TITLE.en} <span className="muted" lang="gu">· {TITLE.gu}</span></h3>
        <Block id="people">
          {draft.people.map((p, i) => (
            <div className="emg-person" key={p.id}>
              <input placeholder="Name · નામ" value={p.name} onChange={(e) => set('people', draft.people.map((x, k) => k === i ? { ...x, name: e.target.value } : x))} />
              <input placeholder="Relation · સંબંધ" value={p.relation} onChange={(e) => set('people', draft.people.map((x, k) => k === i ? { ...x, relation: e.target.value } : x))} />
              <input type="tel" placeholder="Phone · ફોન" value={p.phone} onChange={(e) => set('people', draft.people.map((x, k) => k === i ? { ...x, phone: e.target.value } : x))} />
              <div className="field-row">
                <input className="grow" placeholder="Why call · શા માટે" value={p.note} onChange={(e) => set('people', draft.people.map((x, k) => k === i ? { ...x, note: e.target.value } : x))} />
                <button type="button" className="btn icon" aria-label="Remove" onClick={() => set('people', draft.people.filter((_, k) => k !== i))}><TrashIcon /></button>
              </div>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => set('people', [...draft.people, { id: newId(), name: '', relation: '', phone: '', note: '' }])}><PlusIcon /> Add a person</button>
        </Block>

        <div className="card">
          <h4>From your Vault <span className="muted" lang="gu">· વૉલ્ટમાંથી</span></h4>
          <p className="muted small">Tap to include or leave out. Changes you make in the Vault show here by themselves.</p>
          <div className="chips">
            {linkable(vault.items).map((i) => {
              const on = linkedIds.has(i.id)
              return <button type="button" key={i.id} className={`chip chip-btn ${on ? 'on' : ''}`} aria-pressed={on}
                onClick={() => set('vaultIds', on ? draft.vaultIds.filter((x) => x !== i.id) : [...draft.vaultIds, i.id])}>{describe(i).title || i.title}{on && ' ✓'}</button>
            })}
            {linkable(vault.items).length === 0 && <span className="muted small">No bank accounts, policies or contacts in the Vault yet.</span>}
          </div>
        </div>

        <div className="card">
          <h4>From Budget <span className="muted" lang="gu">· બજેટમાંથી</span></h4>
          {[['accounts', 'Bank accounts and cards'], ['plan', 'Policy / loan commitments from Plan'], ['dues', 'Open Dues (who owes whom)']].map(([k, label]) => (
            <label className="check" key={k}><input type="checkbox" checked={!!draft.live[k]} onChange={(e) => set('live', { ...draft.live, [k]: e.target.checked })} /> {label}</label>
          ))}
        </div>

        {['papers', 'access', 'instructions'].map((k) => (
          <Block id={k} key={k}>
            <textarea rows={k === 'instructions' ? 5 : 3} value={draft[k]} onChange={(e) => set(k, e.target.value)} />
          </Block>
        ))}
        {error && <div className="alert error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Encrypting…' : 'Save'}</button>
        </div>
      </form>
    )
  }

  return (
    <section>
      <div className={`alert ${review.due ? 'warn' : 'ok'} emg-review`}>
        <span>{review.text}{review.due && ' · time to check it'} <span className="muted" lang="gu">· {review.due ? 'ફરી તપાસવાનો સમય' : 'છેલ્લે ચકાસ્યું'}</span></span>
        {!readOnly && <button type="button" className="btn small" onClick={markReviewed}>It's up to date</button>}
      </div>
      <div className="card"><EmergencyDoc data={data} linked={linked} live={live} /></div>
      <div className="emg-actions">
        {!readOnly && <button type="button" className="btn" onClick={startEdit}><PencilIcon /> Edit</button>}
        <button type="button" className="btn primary" onClick={print}>Print / Save as PDF</button>
      </div>
      {!readOnly && !member && sheet && (
        <div className="card emg-share"><ShareWith item={sheet} share={{ households, members, onChange: (ids) => vault.shareItem(sheet.id, ids) }} /></div>
      )}
    </section>
  )
}

function Block({ id, children }) {
  return (
    <div className="card">
      <h4>{SECTIONS[id].en} <span className="muted" lang="gu">· {SECTIONS[id].gu}</span></h4>
      <p className="muted small">{SECTIONS[id].help} <span lang="gu">{SECTIONS[id].helpGu}</span></p>
      {children}
    </div>
  )
}
