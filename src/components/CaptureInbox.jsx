import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadCategories as loadHisabCategories, iconFor } from '../lib/hisab'
import { money } from '../lib/format'

// Payments read from bank SMS by the eChopdo Android app (table `captures`), waiting to be
// added. A banner above Home / Entries / Hisab opens this list; each payment is filed as a
// Hisab or Budget entry (rpc file_capture, which also remembers the payee), ignored, or
// marked as the entry already added by hand.
const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function CaptureInbox({ householdId, categories, accounts, onFiled }) {
  const [list, setList] = useState([])
  const [rules, setRules] = useState([])
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    if (!householdId) return
    const [c, r] = await Promise.all([
      supabase.from('captures').select('*').eq('household_id', householdId).eq('status', 'new').order('created_at', { ascending: false }).limit(50),
      supabase.from('capture_rules').select('*').eq('household_id', householdId),
    ])
    if (!c.error) setList(c.data)
    if (!r.error) setRules(r.data)
  }, [householdId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  if (!list.length) return null
  return (
    <>
      <button type="button" className="capture-banner" onClick={() => setOpen(true)}>
        <span className="capture-dot">{list.length}</span>
        <span className="grow">{list.length === 1 ? 'Bank payment' : 'Bank payments'} to add</span>
        <span className="muted small">{money(list[0].amount)} · {list[0].payee || list[0].bank}{list.length > 1 ? ` +${list.length - 1}` : ''}</span>
      </button>
      {open && <InboxSheet list={list} rules={rules} householdId={householdId} categories={categories} accounts={accounts}
        onClose={() => setOpen(false)} onChanged={(filed) => { load(); if (filed) onFiled?.() }} />}
    </>
  )
}

function suggestionFor(c, rules) {
  const r = c.payee && rules.find((x) => x.key === `payee:${c.payee.trim().toLowerCase()}`)
  const a = c.account_hint && rules.find((x) => x.key === `acct:${(c.bank || '').toLowerCase()}:${c.account_hint}`)
  return { rule: r?.target ? r : null, accountId: r?.account_id || a?.account_id || null }
}

function InboxSheet({ list, rules, householdId, categories, accounts, onClose, onChanged }) {
  const [editing, setEditing] = useState(null) // capture id
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [hisabCats, setHisabCats] = useState([])
  useEffect(() => { loadHisabCategories(householdId).then(setHisabCats).catch(() => {}) }, [householdId])
  useEffect(() => { if (!list.length) onClose() }, [list, onClose])

  async function file(c, f) {
    setBusy(c.id); setError(null)
    const { error } = await supabase.rpc('file_capture', {
      p_capture: c.id, p_target: f.target, p_category: f.category || null, p_category_id: f.category_id || null,
      p_account_id: f.account_id || null, p_source: f.source || null, p_note: f.note || null, p_auto: f.auto ?? null,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setEditing(null); onChanged(true)
  }
  async function setStatus(c, status) {
    setBusy(c.id); setError(null)
    const upd = status === 'matched' ? { status, target: c.match_target, entry_id: c.match_entry_id, filed_at: new Date().toISOString() } : { status, filed_at: new Date().toISOString() }
    const { error } = await supabase.from('captures').update(upd).eq('id', c.id).eq('status', 'new')
    setBusy(null)
    if (error) return setError(error.message)
    onChanged(false)
  }

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="card modal capture-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Bank payments to add</h3>
        <p className="muted small" style={{ margin: 0 }}>Read from bank SMS on your phone. Add each to Hisab or Budget, or ignore it (self-transfers, bills already in Plan…).</p>
        {error && <div className="alert error">{error}</div>}
        <div className="capture-list">
          {list.map((c) => {
            const { rule, accountId } = suggestionFor(c, rules)
            const label = rule ? (rule.target === 'budget' ? categories.find((x) => x.id === rule.category_id)?.name || 'Budget' : rule.category || 'Hisab') : null
            return (
              <div key={c.id} className={`capture-item ${busy === c.id ? 'busy' : ''}`}>
                <div className="capture-row">
                  <div className="grow">
                    <div className="capture-payee">{c.payee || 'UPI payment'}</div>
                    <div className="muted small">{[c.bank, c.account_hint && `${c.card ? 'card ' : ''}·${c.account_hint}`, fmtDate(c.occurred_on)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className={`capture-amt ${c.direction === 'in' ? 'pos' : 'neg'}`}>{c.direction === 'in' ? '+' : '−'}{money(c.amount)}</div>
                </div>
                {c.match_entry_id && (
                  <div className="capture-match muted small">Looks like one already added by hand ({c.match_target === 'budget' ? 'Budget' : 'Hisab'}).</div>
                )}
                {editing === c.id ? (
                  <FileForm c={c} rule={rule} accountId={accountId} hisabCats={hisabCats} categories={categories} accounts={accounts}
                    onCancel={() => setEditing(null)} onSave={(f) => file(c, f)} />
                ) : (
                  <div className="capture-actions">
                    {c.match_entry_id && <button type="button" className="btn small" onClick={() => setStatus(c, 'matched')}>Same, skip</button>}
                    {rule && (
                      <button type="button" className="btn small primary" onClick={() => file(c, { target: rule.target, category: rule.category, category_id: rule.category_id, account_id: rule.account_id || accountId, source: rule.source })}>
                        ✓ {rule.target === 'hisab' && rule.category ? `${iconFor(rule.category)} ` : ''}{label}
                      </button>
                    )}
                    <button type="button" className={`btn small ${rule ? '' : 'primary'}`} onClick={() => setEditing(c.id)}>{rule ? 'Change…' : 'Add…'}</button>
                    <button type="button" className="btn small ghost" onClick={() => setStatus(c, 'ignored')}>Ignore</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}

function FileForm({ c, rule, accountId, hisabCats, categories, accounts, onCancel, onSave }) {
  const [target, setTarget] = useState(rule?.target || 'hisab')
  const [category, setCategory] = useState(rule?.target === 'hisab' ? rule.category : null)
  const [categoryId, setCategoryId] = useState(rule?.target === 'budget' ? rule.category_id : null)
  const [account, setAccount] = useState(rule?.account_id || accountId)
  const [note, setNote] = useState(c.payee || '')
  const [auto, setAuto] = useState(!!rule?.auto)
  const dir = c.direction
  const hc = hisabCats.filter((x) => x.direction === dir)
  const bc = categories.filter((x) => x.kind === (dir === 'in' ? 'income' : 'expense'))

  return (
    <div className="capture-form">
      <div className="seg">
        <button type="button" className={target === 'hisab' ? 'on' : ''} onClick={() => setTarget('hisab')}>Hisab</button>
        <button type="button" className={target === 'budget' ? 'on' : ''} onClick={() => setTarget('budget')}>Budget</button>
      </div>
      {target === 'hisab' ? (
        <div className="chips">
          {hc.map((x) => (
            <button type="button" key={x.id} className={`chip chip-btn ${category === x.name ? 'on' : ''}`} onClick={() => setCategory(category === x.name ? null : x.name)}>{x.icon} {x.name}</button>
          ))}
        </div>
      ) : (
        <>
          <div className="chips">
            {bc.map((x) => (
              <button type="button" key={x.id} className={`chip chip-btn ${categoryId === x.id ? 'on' : ''}`} onClick={() => setCategoryId(categoryId === x.id ? null : x.id)}>
                <span className="dot" style={{ background: x.color }} />{x.name}
              </button>
            ))}
          </div>
          {accounts.length > 0 && (
            <div className="chips">
              {accounts.map((a) => (
                <button type="button" key={a.id} className={`chip chip-btn ${account === a.id ? 'on' : ''}`} onClick={() => setAccount(account === a.id ? null : a.id)}>
                  <span className="dot" style={{ background: a.color || 'var(--muted)' }} />{a.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <input aria-label="Note" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      {c.payee && (
        <label className="check-line"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Always add {c.payee} like this</label>
      )}
      <div className="capture-actions">
        <button type="button" className="btn small ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn small primary" onClick={() => onSave({ target, category, category_id: categoryId, account_id: account, note, auto })}>
          Add to {target === 'budget' ? 'Budget' : 'Hisab'}
        </button>
      </div>
    </div>
  )
}
