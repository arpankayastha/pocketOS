// Plain-text versions of a list, an occasion and a secure note for WhatsApp or the clipboard.
// WhatsApp formatting: *bold*, _italic_. No Supabase here, so it can be tested (listShare.test.mjs).
import { gotItems, groupBySection, openItems, rsvpCounts, shortDate, shortTime, taskGroups } from './listLogic.js'

const line = (box, it) => `${box} ${it.name}${it.qty ? ` — ${it.qty}` : ''}${it.assignee ? ` (${it.assignee})` : ''}`
const dayMonth = (iso) => shortDate(iso).replace(/^\w+,? /, '')

// An everyday list: open items by section, then what's already got.
export function listShareText(list, items) {
  const open = openItems(items)
  const got = gotItems(items)
  const out = [`*${list.name}* ${list.icon || ''}`.trim(), `_${open.length ? `${open.length} to get` : 'all done'}_`]
  const sections = list.sections || []
  for (const g of groupBySection(open, sections, sections.length ? 'Other' : 'To buy')) {
    out.push('', `*${g.section}*`, ...g.items.map((it) => line('☐', it)))
  }
  if (got.length) out.push('', `*✓ Got it*`, ...got.map((it) => line('✓', it)))
  return out.join('\n')
}

// An occasion: the header, then the tabs in `parts` (tasks · samagri · people; money is never shared).
export function occasionShareText(list, items, { today, parts = ['tasks', 'samagri', 'people'] } = {}) {
  const by = (t) => items.filter((i) => i.tab === t && !i.cleared)
  const when = [shortDate(list.event_date), shortTime(list.event_time)].filter(Boolean).join(', ')
  const out = [`*${list.name}* ${list.icon || ''}`.trim()]
  if (when) out.push(`📅 ${when}`)
  if (list.place) out.push(`📍 ${list.place}`)

  if (parts.includes('tasks') && by('tasks').length) {
    out.push('', '*Tasks*')
    for (const g of taskGroups(by('tasks'), today)) {
      if (g.label === 'Done') continue
      for (const t of g.items) out.push(`☐ ${t.name}${t.due_date ? ` — ${dayMonth(t.due_date)}` : ''}${t.assignee ? ` (${t.assignee})` : ''}`)
    }
    const done = by('tasks').filter((t) => t.done)
    if (done.length) out.push(`✓ ${done.length} done`)
  }
  if (parts.includes('samagri') && by('samagri').length) {
    const rows = by('samagri')
    const open = openItems(rows)
    out.push('', '*Samagri*')
    for (const g of groupBySection(open, [...new Set(rows.map((i) => i.section).filter(Boolean))], 'Other')) {
      out.push(`_${g.section}_`, ...g.items.map((it) => line('☐', it)))
    }
    const got = gotItems(rows)
    if (got.length) out.push(`✓ ${got.length} got`)
  }
  if (parts.includes('people') && by('people').length) {
    const rows = by('people')
    const c = rsvpCounts(rows)
    const state = { yes: '✓ coming', maybe: '? maybe', no: '✗ not coming' }
    out.push('', `*People* — ${c.yes} coming${c.maybe ? `, ${c.maybe} maybe` : ''}${c.no ? `, ${c.no} not coming` : ''}`)
    for (const g of groupBySection(rows, [...new Set(rows.map((i) => i.section).filter(Boolean))], 'Others')) {
      out.push(`_${g.section}_`, ...g.items.map((p) => `• ${p.name}${p.rsvp ? ` — ${state[p.rsvp]}` : ''}`))
    }
  }
  return out.join('\n')
}

// A secure note: its title, then the text exactly as written.
export function noteShareText(title, notes) {
  return `*${title}*\n\n${(notes || '').trim()}`
}
