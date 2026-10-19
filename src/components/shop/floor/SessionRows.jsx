import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { qrSvg } from '../../../lib/upi'
import { durLabel, minutesLeft, pausedMinutes, rs, sessionEnd, sessionPaid, sessionTotal, shortCode, timeLabel } from '../../../lib/shop'
import { ActionGrid, ActionSheet, Chips, inOut, Sheet, SheetActions } from '../ui'
import { CashIcon, ClockPlusIcon, CupIcon, MoveIcon, PauseIcon, PhoneIcon, PlayIcon, QrIcon, XIcon } from '../../../lib/icons'
import { dueOf, leftLabel, seatsOf1, stateOf, whereOf } from './common'

// One customer on the floor: where, who, when it ends, what's still to collect, and the time left — tap for
// everything else (F&B, Extend, Move, Pause, timer code, End & collect). A waiting entry has ▶ Start.
export function RunRow({ sys, seat, s, now, onOpen, onStart }) {
  const left = minutesLeft(s, now)
  const state = stateOf(s, now)
  const pct = Math.min(100, Math.max(0, 100 - (left / s.minutes) * 100))
  const due = dueOf(s)
  return (
    <div className={`card gx-run ${state}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <span className={`gx-badge ${sys.kind === 'PS' ? 'ps' : ''}`}>{seatsOf1(sys) > 1 ? <span className="gx-badge-2">{sys.name}<small>C{seat}</small></span> : sys.name}</span>
      <div className="gx-run-main">
        <div className="gx-name">{s.customer_name}{s.players > 1 ? <span className="muted"> · {s.players} players</span> : ''}</div>
        <div className="muted small">{s.waiting ? `Waiting · ${durLabel(s.minutes)} · not started` : `${timeLabel(s.started_at)} – ${timeLabel(sessionEnd(s, now))}${pausedMinutes(s, now) > 0 ? ` · paused ${durLabel(pausedMinutes(s, now))}` : s.paused_at ? ' · paused' : ''}`} · <b className="mono gx-rowcode">{shortCode(s.id)}</b>{due > 0 && <span className="gx-due"> · {rs(due)} due</span>}{Number(s.owed) > 0 && <span className="muted"> · {rs(s.owed)} in dues</span>}</div>
      </div>
      {s.waiting
        ? <button type="button" className="btn small primary" onClick={(e) => { e.stopPropagation(); onStart() }}>▶ Start</button>
        : <div className={`gx-left ${state}`}><b>{left <= 0 ? 'Time up' : leftLabel(left)}</b>{left > 0 && <span>{s.paused_at ? 'paused' : 'left'}</span>}</div>}
      {!s.waiting && <div className="gx-bar"><i style={{ width: `${pct}%` }} /></div>}
    </div>
  )
}

// Everything for one customer, in one sheet: the bill so far, how it was paid, and the actions.
export function SessionSheet({ system, seat, s, now, bank = [], bankOn = false, onClose, onAction, onPause, onStart, onCancel }) {
  const left = minutesLeft(s, now)
  const bill = sessionTotal(s), paid = sessionPaid(s), owed = Number(s.owed || 0), due = Math.max(0, bill - paid - owed)
  const how = [Number(s.paid_cash) && 'cash', Number(s.paid_online) && 'online', Number(s.paid_deposit || 0) && 'deposit'].filter(Boolean).join(' + ')
  return (
    <ActionSheet title={`${s.customer_name}${s.players > 1 ? ` · ${s.players} players` : ''}`}
      sub={`${whereOf(system, seat)} · ${s.waiting ? `waiting · ${durLabel(s.minutes)}` : `${inOut(s)}${s.paused_at ? ' · on pause now' : left > 0 ? ` · ${durLabel(left)} left` : ' · time up'}`}`}
      onClose={onClose}
      primary={s.waiting ? <button type="button" className="btn primary" onClick={onStart}>▶ Start timer</button> : <button type="button" className="btn primary" onClick={() => onAction('end')}>End &amp; collect</button>}>
      <div className="gx-skpis">
        <div><span>Bill</span><b>{rs(bill)}</b></div>
        <div><span>Paid{how ? ` · ${how}` : ''}</span><b className={paid ? 'pos' : ''}>{rs(paid)}</b></div>
        <div><span>{owed ? 'To collect · in dues' : 'To collect'}</span><b className={due + owed ? 'neg' : ''}>{rs(due + owed)}</b></div>
      </div>
      {/* Owner, 19 Oct: the shop phone saw this online money in the bank's SMS. */}
      {bank.length > 0 && <div className="small pos">✓ Seen in bank · {bank.map((x) => `${rs(x.amount)}${x.payer ? ` from ${x.payer}` : ''}`).join(', ')}</div>}
      {bankOn && !bank.length && Number(s.paid_online) > 0 && <div className="small muted">Online {rs(s.paid_online)} · not seen in the bank SMS yet</div>}
      <ActionGrid items={[
        due + owed > 0 && { label: `Collect ${rs(due + owed)}`, icon: <CashIcon />, onClick: () => onAction('collect') },
        { label: '+ F&B', icon: <CupIcon />, onClick: () => onAction('fnb') },
        { label: 'Extend', icon: <ClockPlusIcon />, onClick: () => onAction('extend') },
        { label: 'Move', icon: <MoveIcon />, onClick: () => onAction('move') },
        !s.waiting && { label: s.paused_at ? 'Resume' : 'Pause', icon: s.paused_at ? <PlayIcon /> : <PauseIcon />, onClick: () => onPause(!s.paused_at) },
        { label: `Code ${shortCode(s.id)}`, icon: <QrIcon />, onClick: () => onAction('timer') },
        s.customer_phone && { label: 'Call', icon: <PhoneIcon />, href: `tel:${s.customer_phone}` },
        s.waiting && { label: 'Cancel entry', icon: <XIcon />, onClick: onCancel, danger: true },
      ]} />
      <div className="muted small">{Number(s.owed) > 0 ? `${rs(s.owed)} already in their dues · ` : ''}{s.entered_by ? `Taken by ${s.entered_by}` : ''}{Number(s.fnb_before) + Number(s.fnb_while) ? ` · F&B ${rs(Number(s.fnb_before) + Number(s.fnb_while))}` : ''}</div>
    </ActionSheet>
  )
}

// PS5 controllers: who has each one, and Out of order / Back in use (staff and admin).
export function ControllersSheet({ systems, holders, off, onSet, onClose }) {
  return (
    <ActionSheet title="Controllers" sub="Mark a broken controller out of order; it's left out of Start and online booking." onClose={onClose}>
      {systems.map((sys) => {
        const h = holders(sys)
        return (
          <div key={sys.id} className="gx-ctl-list">
            {systems.length > 1 && <div className="caps muted">{sys.name}</div>}
            {Array.from({ length: sys.seats || 1 }, (_, i) => i + 1).map((n) => {
              const s = h.get(n)
              return (
                <div key={n} className="line">
                  <span className="gx-badge sm ps">C{n}</span>
                  <div className="grow">{off(sys, n) ? <span className="neg">Out of order</span> : s ? <>In use · {s.customer_name}</> : <span className="pos">Free</span>}</div>
                  {off(sys, n) ? <button type="button" className="btn small" onClick={() => onSet(sys, n, false)}>Back in use</button>
                    : !s && <button type="button" className="btn small ghost" onClick={() => onSet(sys, n, true)}>Out of order</button>}
                </div>
              )
            })}
          </div>
        )
      })}
    </ActionSheet>
  )
}

// Owner: "booked PC2 but sat at PC4 — need to change it". Moves a running session (time, bill and code kept)
// to a free PC, or a free controller on the PS5.
// Owner: a customer who didn't save their code — staff open it from the session row: the code in big letters,
// a QR the customer scans to open their timer, open it on this device, copy the link or send it on WhatsApp.
export function TimerCodeSheet({ session, onClose }) {
  const code = shortCode(session.id)
  const link = `${location.origin}/#timer/${code}`
  const digits = (session.customer_phone || '').replace(/\D/g, '')
  const wa = `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(`Your GRANDXGAMER timer: ${link} (code ${code})`)}`
  const [copied, setCopied] = useState(false)
  return (
    <Sheet title={`Timer · ${session.customer_name}`} sub={`${session.system_name}${(session.seat || 1) > 1 && session.system_name?.startsWith('PS') ? ` · controller ${session.seat}` : ''} · type this code on the timer screen, or scan`} onClose={onClose}>
      <div className="gx-timercode mono">{code}</div>
      <div className="gx-timerqr" dangerouslySetInnerHTML={{ __html: qrSvg(link) }} />
      <div className="gx-btns">
        <a className="btn" href={link} target="_blank" rel="noreferrer">Open timer here</a>
        <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        {digits.length >= 10 && <a className="btn" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
      </div>
      <div className="actions"><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
    </Sheet>
  )
}

export function MoveSheet({ session, systems, freeOf, onClose, onDone }) {
  const kind = systems.find((x) => x.id === session.system_id)?.kind || (session.system_name.startsWith('PS') ? 'PS' : 'PC')
  const targets = systems.filter((x) => x.kind === kind).flatMap((x) => freeOf(x).map((seat) => ({ sys: x, seat, key: `${x.id}:${seat}`, label: (x.seats || 1) > 1 ? `${x.name} · 🎮${seat}` : x.name })))
  const [to, setTo] = useState(targets[0]?.key || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    const t = targets.find((x) => x.key === to)
    if (!t) return
    setBusy(true)
    const { error } = await supabase.from('shop_sessions').update({ system_id: t.sys.id, system_name: t.sys.name, seat: t.seat }).eq('id', session.id)
    setBusy(false)
    if (error) { setError(error.code === '23505' ? 'That one just got taken. Pick another.' : error.message); return }
    onDone(`${session.customer_name} moved to ${t.label}`)
  }
  return (
    <Sheet title={`Move ${session.customer_name}`} sub={`Now on ${session.system_name}${(session.seat || 1) > 1 ? ` · 🎮${session.seat}` : ''}. Time, bill and code stay the same.`} onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      {targets.length === 0 ? <div className="muted small">Nothing free to move to right now.</div> : <Chips options={targets.map((t) => [t.key, t.label])} value={to} onChange={setTo} />}
      <SheetActions onClose={onClose} busy={busy} disabled={!to} label="Move" />
    </Sheet>
  )
}
