// Human-readable Gujarati list of what changed between two versions of the will, for the
// change log (ફેરફારોની નોંધ). Written for the family to read, so plain words, names and amounts.
import { ASSET_TYPE, personById } from './willModel'
import { assetDescription, CLAUSE } from './willText'

const TESTATOR_LABELS = {
  name: 'નામ', spouseOrParentRelation: 'સંબંધ', spouseOrParentName: 'પતિ / પિતાનું નામ', age: 'ઉંમર', religion: 'ધર્મ',
  address: 'સરનામું', aadhaar: 'આધાર નંબર', place: 'સહી કરવાનું સ્થળ',
}
const PERSON_LABELS = { name: 'નામ', relation: 'સંબંધ', note: 'નોંધ', dob: 'જન્મ તારીખ', address: 'સરનામું', idNumber: 'આધાર', guardianId: 'વાલી', alternate: 'વૈકલ્પિક લાભાર્થી' }
const clean = (s) => String(s ?? '').replace(/⁣/g, '').trim()
const short = (s, n = 60) => { const c = clean(s); return c.length > n ? `${c.slice(0, n)}…` : c }
const assetName = (a) => short(assetDescription(a)) || ASSET_TYPE[a.type].gu
const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]))
const sharesText = (doc, shares) => shares.map((s) => `${personById(doc, s.personId)?.name || '?'} ${s.percent}%`).join(', ') || 'કોઈને નહીં'
// Deep equality that ignores key order and treats "" / null / undefined alike (forms add empty keys).
const norm = (v) => {
  if (Array.isArray(v)) return v.map(norm)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== '' && v[k] != null).map((k) => [k, norm(v[k])]))
  return typeof v === 'number' ? String(v) : v
}
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b))

export function diffWill(before, after) {
  if (!before) return ['વસિયતનામું શરૂ કર્યું']
  const out = []

  for (const [k, label] of Object.entries(TESTATOR_LABELS)) {
    if (clean(before.testator[k]) !== clean(after.testator[k])) out.push(`વસિયત કરનારની વિગત બદલી: ${label}`)
  }

  const bp = byId(before.people), ap = byId(after.people)
  for (const p of after.people) {
    if (!bp[p.id]) { out.push(`કુટુંબમાં ઉમેર્યા: ${p.name} (${p.relation})`); continue }
    const changed = Object.keys(PERSON_LABELS).filter((k) => clean(bp[p.id][k]) !== clean(p[k]))
    if (changed.length) out.push(`${p.name}ની વિગત બદલી: ${changed.map((k) => PERSON_LABELS[k]).join(', ')}`)
  }
  for (const p of before.people) if (!ap[p.id]) out.push(`કુટુંબમાંથી કાઢ્યા: ${p.name}`)

  const ba = byId(before.assets), aa = byId(after.assets)
  for (const a of after.assets) {
    const old = ba[a.id]
    if (!old) { out.push(`મિલકત ઉમેરી: ${assetName(a)} → ${sharesText(after, a.shares)}`); continue }
    if (!same(old.shares, a.shares)) out.push(`હિસ્સો બદલ્યો: ${assetName(a)} — ${sharesText(before, old.shares)} → ${sharesText(after, a.shares)}`)
    if (clean(old.note) !== clean(a.note)) out.push(`ખાસ સૂચના બદલી: ${assetName(a)}`)
    const { shares: _s1, note: _n1, ...o1 } = old
    const { shares: _s2, note: _n2, ...o2 } = a
    if (!same(o1, o2)) out.push(`મિલકતની વિગત બદલી: ${assetName(a)}`)
  }
  for (const a of before.assets) if (!aa[a.id]) out.push(`મિલકત કાઢી: ${assetName(a)}`)

  if (!same(before.residuary, after.residuary)) out.push(`બાકી મિલકતની વહેંચણી બદલી: ${sharesText(before, before.residuary)} → ${sharesText(after, after.residuary)}`)
  if (clean(before.residuaryNote) !== clean(after.residuaryNote)) out.push('બાકી મિલકત માટેની ખાસ સૂચના બદલી')
  if (!same(before.executors, after.executors)) out.push(`અમલકર્તા બદલ્યા: ${after.executors.map((id) => personById(after, id)?.name).filter(Boolean).join(', ') || 'કોઈ નહીં'}`)
  if (!same(before.wishes.map((w) => clean(w.text)), after.wishes.map((w) => clean(w.text)))) out.push('ઇચ્છાઓ બદલી')
  if (!same(before.witnesses, after.witnesses)) out.push('સાક્ષીઓની વિગત બદલી')
  if (clean(before.funeral) !== clean(after.funeral)) out.push('અંતિમવિધિ અંગેની વિગત બદલી')
  for (const key of new Set([...Object.keys(before.clauses), ...Object.keys(after.clauses)])) {
    const b = before.clauses[key] || {}, a = after.clauses[key] || {}
    const label = CLAUSE[key]?.label || key
    if (!!b.off !== !!a.off) out.push(`${a.off ? 'કલમ બંધ કરી' : 'કલમ ફરી ચાલુ કરી'}: ${label}`)
    if ((b.text ?? null) !== (a.text ?? null)) out.push(`કલમનું લખાણ ${a.text == null ? 'મૂળ પ્રમાણે કર્યું' : 'બદલ્યું'}: ${label}`)
  }
  if (!same(before.custom, after.custom)) out.push('પોતાની કલમો બદલી')
  if (!same(before.settings, after.settings)) out.push('PDFનું સેટિંગ બદલ્યું')
  return out
}
