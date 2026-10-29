import { addDays, customerKey, dayTotals, sessionTotal } from './money.js'

// Admin portal reports (owner, 29 Oct: one admin portal with reports and Excel export). Pure: the rows come in
// from the database, the shapes go out — tested in reports.test.mjs.

const sameDay = (iso, from) => { const t = new Date(iso); return t >= from && t < addDays(from, 1) }

// One row per day of a range [from, to) with the same money rules as the counter's Today (dayTotals), plus
// totals for the range. data = { sessions, cash, advances, deposits, duesPaid } covering the range.
export function dailyRows(data, from, to) {
  const rows = []
  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    const pick = (list, key) => (list || []).filter((x) => sameDay(x[key], d))
    const t = dayTotals({
      sessions: pick(data.sessions, 'started_at'), cash: pick(data.cash, 'at'), advances: pick(data.advances, 'created_at'),
      deposits: data.deposits || [], duesPaid: data.duesPaid || [],
    }, d)
    rows.push({ day: new Date(d), cash: t.cash, online: t.online, total: t.cash + t.online, sessions: t.sessions, minutes: t.minutes,
      fnb: t.fnb, owed: t.owed, deposits: t.deposits || 0, refunds: t.refunds || 0, duesIn: t.duesIn || 0, out: t.out })
  }
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0)
  const totals = Object.fromEntries(['cash', 'online', 'total', 'sessions', 'minutes', 'fnb', 'owed', 'deposits', 'refunds', 'duesIn', 'out'].map((k) => [k, sum(k)]))
  return { rows, totals }
}

// Sessions grouped by a key: bill (what was charged), money paid, sessions and minutes.
export function groupSessions(sessions, keyOf) {
  const m = new Map()
  for (const s of sessions || []) {
    if (s.status === 'cancelled') continue
    const k = keyOf(s) || 'Not recorded'
    const r = m.get(k) || { key: k, sessions: 0, minutes: 0, bill: 0, paid: 0, fnb: 0 }
    r.sessions++; r.minutes += Number(s.minutes) || 0; r.bill += sessionTotal(s)
    r.paid += Number(s.paid_cash) + Number(s.paid_online) + Number(s.paid_deposit || 0)
    r.fnb += Number(s.fnb_before) + Number(s.fnb_while)
    m.set(k, r)
  }
  return [...m.values()].sort((a, b) => b.bill - a.bill)
}
export const bySystem = (sessions) => groupSessions(sessions, (s) => s.system_name)
export const byKind = (sessions) => groupSessions(sessions, (s) => (/^ps/i.test(s.system_name || '') ? 'PS5' : 'PC'))
export const byStaff = (sessions) => groupSessions(sessions, (s) => s.entered_by)

// Every customer the shop has seen: visits, money spent, last visit, deposit left and dues (same key as deposits).
export function customerSummary(sessions = [], deposits = [], dues = []) {
  const m = new Map()
  const row = (name, phone) => {
    const k = customerKey(name, phone)
    if (!k || k === 'walk-in') return null
    const r = m.get(k) || { key: k, name, phone: null, visits: 0, spent: 0, minutes: 0, first: null, last: null, deposit: 0, dues: 0 }
    if (phone) r.phone = (phone || '').replace(/\D/g, '').slice(-10)
    m.set(k, r)
    return r
  }
  for (const s of sessions) {
    if (s.status === 'cancelled') continue
    const r = row(s.customer_name?.replace(/ \(\d+\/\d+\)$/, ''), s.customer_phone)
    if (!r) continue
    r.visits++; r.spent += sessionTotal(s); r.minutes += Number(s.minutes) || 0
    if (!r.last || s.started_at > r.last) { r.last = s.started_at; r.name = s.customer_name.replace(/ \(\d+\/\d+\)$/, '') }
    if (!r.first || s.started_at < r.first) r.first = s.started_at
  }
  for (const d of deposits) {
    const r = row(d.customer_name, d.customer_phone)
    if (r) r.deposit += (d.kind === 'add' ? 1 : -1) * Number(d.amount)
  }
  for (const s of dues) {
    const r = row(s.customer_name, s.customer_phone)
    if (r) r.dues += Number(s.owed)
  }
  return [...m.values()].sort((a, b) => (b.last || '').localeCompare(a.last || ''))
}

// Excel-friendly CSV (opens in Excel / Google Sheets): a BOM so ₹ and names show right, quotes where needed.
export function toCsv(columns, rows) {
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return '﻿' + [columns.map(([, label]) => cell(label)).join(','), ...rows.map((r) => columns.map(([k]) => cell(typeof k === 'function' ? k(r) : r[k])).join(','))].join('\n')
}
