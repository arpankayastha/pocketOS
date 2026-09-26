// Builds the Gujarati will (વસિયતનામું) from the will document. Structure follows a standard
// Indian will: declaration → beneficiaries → executors → funeral/debts → bequests by asset →
// residuary → alternates → minors' guardians → wishes → general clauses → attestation.
// Every standard clause has a key; the user can override its text or switch it off
// (doc.clauses[key] = { text } | { off: true }). Wording should be reviewed by a lawyer.
import { ASSET_TYPES, personById, isMinor } from './willModel'

const GU_DIGITS = '૦૧૨૩૪૫૬૭૮૯'
export const guDigits = (v) => String(v ?? '').replace(/[0-9]/g, (d) => GU_DIGITS[d])

// Identifiers (account, policy, Aadhaar numbers…) are wrapped in invisible markers so they keep
// their digits exactly as typed even when the PDF uses Gujarati digits — banks read them as-is.
const MARK = '\u2063'
const idv = (v) => (v ? `${MARK}${v}${MARK}` : '')
export function printable(text, gujaratiDigits) {
  const parts = String(text ?? '').split(MARK)
  return parts.map((p, i) => (i % 2 === 0 && gujaratiDigits ? guDigits(p) : p)).join('')
}

const inr = (n) => (n === '' || n == null || isNaN(Number(n)) ? '' : `₹${Number(n).toLocaleString('en-IN')}`)
export const fmtDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || '')
export const maskId = (v) => {
  const digits = String(v || '').replace(/\s/g, '')
  return digits ? idv(`XXXX XXXX ${digits.slice(-4)}`) : '' // only the last 4 digits are ever printed
}
const join = (parts, sep = ', ') => parts.filter(Boolean).join(sep)
const who = (doc, id) => personById(doc, id)?.name || '—'

export function assetDescription(a) {
  switch (a.type) {
    case 'property': return join([a.description, a.address, a.surveyNo && `સર્વે / ખાતા નં. ${idv(a.surveyNo)}`])
    case 'bank': return join([a.bank, a.branch && `શાખા ${a.branch}`, a.accountNo && `ખાતા નં. ${idv(a.accountNo)}`, a.ifsc && `IFSC ${idv(a.ifsc)}`])
    case 'fd': return join([a.bank, a.branch && `શાખા ${a.branch}`, a.fdNo && `FD નં. ${idv(a.fdNo)}`, a.amount && `રકમ ${inr(a.amount)}`, a.maturity && `પાકતી તારીખ ${fmtDate(a.maturity)}`])
    case 'savings': return join([a.scheme, a.office, a.certNo && `નં. ${idv(a.certNo)}`, a.amount && `રકમ ${inr(a.amount)}`, a.maturity && `પાકતી તારીખ ${fmtDate(a.maturity)}`])
    case 'insurance': return join([join([a.company, a.plan], ' – '), a.policyNo && `પૉલિસી નં. ${idv(a.policyNo)}`, a.amount && `વીમા રકમ ${inr(a.amount)}`])
    case 'investment': return join([a.description, a.institution, a.folio && `ફોલિયો / ડીમેટ ${idv(a.folio)}`])
    case 'jewellery': return join([a.item, a.metal, a.weight && `આશરે ${a.weight} ગ્રામ`])
    case 'vehicle': return join([a.model, a.regNo && `રજિ. નં. ${idv(a.regNo)}`])
    default: return a.description || ''
  }
}
export const holdingText = (a) => (a.holding === 'joint' ? `સંયુક્ત (${a.jointWith || '—'} સાથે) – ફક્ત મારો હિસ્સો` : 'એકલ માલિકી')
const sharesText = (doc, shares) => shares.map((s) => `${who(doc, s.personId)} – ${s.percent}%`).join('\n')

// Standard clauses, in order. `text(doc)` is the default Gujarati wording.
export const CLAUSES = [
  { key: 'law', gu: 'કાયદો', section: 'declaration', label: 'Governing law', text: () =>
    'આ વસિયતનામું ભારતના કાયદા મુજબ અમલમાં રહેશે. મારા અવસાન બાદ ભારતમાં મારી માલિકીની અથવા મારા વતી અન્ય કોઈ દ્વારા ધારણ કરાયેલી તમામ મિલકતો આ વસિયતનામા મુજબ વહેંચાશે.' },
  { key: 'revoke', gu: 'જૂનાં વસિયતનામાં રદ', section: 'declaration', label: 'Cancels older wills', text: () =>
    'આ વસિયતનામાની તારીખ પહેલાં મેં કરેલાં તમામ વસિયતનામાં તથા પૂરક વસિયતનામાં (કોડિસિલ) હું આથી રદ કરું છું. ભારતમાં આવેલી મારી મિલકતો માટે ફક્ત આ વસિયતનામું જ માન્ય રહેશે.' },
  { key: 'mind', gu: 'સ્વસ્થ મન અને સ્વેચ્છા', section: 'declaration', label: 'Sound mind, free will', text: () =>
    'હું સારી તંદુરસ્તી ધરાવું છું અને સંપૂર્ણ સ્વસ્થ મનથી, કોઈના પણ દબાણ, લાલચ કે પ્રભાવ વિના, મારી પોતાની સ્વતંત્ર ઇચ્છાથી આ વસિયતનામું કરું છું.' },
  { key: 'family', gu: 'કુટુંબ અને લાભાર્થી', section: 'family', label: 'Family & beneficiaries', text: () =>
    'મારા કુટુંબના સભ્યો તથા આ વસિયતનામાના લાભાર્થીઓ નીચે મુજબ છે. આ વસિયતનામામાં તેમનો ઉલ્લેખ નીચે દર્શાવેલ નામથી કરવામાં આવ્યો છે:' },
  { key: 'executor', gu: 'અમલકર્તા', section: 'executor', label: 'Executors', text: () =>
    'હું નીચે જણાવેલ વ્યક્તિઓને, દર્શાવેલ અગ્રતાક્રમ મુજબ, આ વસિયતનામાના અમલકર્તા (એક્ઝિક્યુટર) તરીકે નિયુક્ત કરું છું. આગળની વ્યક્તિ હયાત ન હોય, સગીર હોય, અસમર્થ હોય અથવા આ જવાબદારી સ્વીકારવા ઇચ્છુક ન હોય તો જ પછીની વ્યક્તિ અમલકર્તા બનશે:' },
  { key: 'powers', gu: 'અમલકર્તાના અધિકાર', section: 'executor', label: "Executor's powers", text: () =>
    'મારા અમલકર્તાને નીચેના અધિકારો રહેશે: (ક) આ વસિયતનામા મુજબ મારી મિલકતની વહેંચણી કરવી; (ખ) આ વસિયતનામાને પડકારતી કોઈપણ કાનૂની કાર્યવાહીનો મારી મિલકતના ખર્ચે બચાવ કરવો; (ગ) જરૂર પડ્યે વકીલ, બેંક કે અન્ય વ્યાવસાયિક સલાહકારોની મદદ લેવી; (ઘ) આ કામગીરીમાં થયેલો વાજબી ખર્ચ મારી મિલકતમાંથી મેળવવો.' },
  { key: 'funeral', gu: 'અંતિમવિધિ', section: 'debts', label: 'Funeral', text: (doc) =>
    `મારી અંતિમવિધિ તથા ઉત્તરક્રિયા ${doc.funeral || 'હિંદુ'} રીતરિવાજ મુજબ કરવામાં આવે. તેનો ખર્ચ મારી મિલકતમાંથી સૌથી પહેલાં કરવો, અને તેનો હિસાબ આપવાની અમલકર્તાને જરૂર રહેશે નહીં.` },
  { key: 'debts', gu: 'દેવાં અને કર', section: 'debts', label: 'Debts & taxes', text: () =>
    'મારા અમલકર્તાએ મારી મિલકતમાંથી મારાં તમામ દેવાં, કર, ફી તથા અન્ય જવાબદારીઓ ચૂકવ્યા બાદ બાકીની મિલકત નીચેના ફકરાઓ મુજબ વહેંચવી.' },
  { key: 'estate', gu: 'મિલકતની વહેંચણી', section: 'bequests', label: 'Estate & bequests', text: () =>
    'મારી માલિકીની જંગમ તથા સ્થાવર મિલકતોની યાદી નીચે આપેલી છે. આ યાદી સંપૂર્ણ નથી, પરંતુ અમલકર્તાના માર્ગદર્શન માટે છે. આ તમામ મિલકતો મારી સ્વપાર્જિત છે (અથવા જ્યાં દર્શાવ્યું હોય ત્યાં સંયુક્ત માલિકીની છે) અને તેના પર મારો સંપૂર્ણ હક છે. હું મારી મિલકત નીચે મુજબ, સંપૂર્ણ હક સાથે અને હંમેશ માટે આપું છું:' },
  { key: 'residuary', gu: 'બાકી મિલકત', section: 'residuary', label: 'Everything else (residuary)', text: () =>
    'આ વસિયતનામામાં ઉલ્લેખ ન થયેલી, અથવા આ તારીખ પછી મને મળેલી કે મેં મેળવેલી કોઈપણ મિલકત (બાકી રહેતી મિલકત) નીચે મુજબ વહેંચવી:' },
  { key: 'alternates', gu: 'લાભાર્થીનું અવસાન પહેલાં થાય તો', section: 'alternates', label: 'If a beneficiary dies first', text: () =>
    'જો કોઈ લાભાર્થીનું અવસાન મારા પહેલાં થાય, તો તેમને આ વસિયતનામા હેઠળ મળવાપાત્ર મિલકત નીચે દર્શાવેલ વૈકલ્પિક લાભાર્થીને સંપૂર્ણ હક સાથે મળશે:' },
  { key: 'minors', gu: 'સગીર માટે વાલી', section: 'minors', label: "Minors' guardians", text: () =>
    'નીચે જણાવેલ લાભાર્થીઓ સગીર છે. તેઓ ૧૮ વર્ષના થાય ત્યાં સુધી તેમને આ વસિયતનામા હેઠળ મળનારી મિલકતનો વહીવટ, ફક્ત તેમના હિતમાં, નીચે જણાવેલ વાલી / ટ્રસ્ટી કરશે:' },
  { key: 'wishes', gu: 'ઇચ્છાઓ', section: 'wishes', label: 'Wishes', text: () =>
    'મારી નીચેની ઇચ્છાઓ મારા કુટુંબ માટે નૈતિક માર્ગદર્શન રૂપે છે; તે ઉપર જણાવેલ મિલકતની વહેંચણીને અસર કરતી નથી:' },
  { key: 'schedules', gu: 'યાદીઓ વસિયતનો ભાગ', section: 'misc', label: 'Schedules are part of the will', text: () => 'આ વસિયતનામાની તમામ યાદીઓ અને અનુસૂચિઓ તેનો અવિભાજ્ય ભાગ છે.' },
  { key: 'executorGift', gu: 'અમલકર્તાને મળતી મિલકત', section: 'misc', label: 'Gift to executor', text: () =>
    'જો અમલકર્તાને આ વસિયતનામા હેઠળ કોઈ મિલકત મળે, તો તે મારા પ્રેમ અને લાગણીરૂપે છે, અમલકર્તા તરીકેની કામગીરીના મહેનતાણા તરીકે નહીં.' },
  { key: 'errors', gu: 'વર્ણનમાં ભૂલ', section: 'misc', label: 'Description errors', text: () => 'કોઈ મિલકતના વર્ણનમાં ભૂલ હોય તો તેનાથી આ વસિયતનામા હેઠળની વહેંચણીને અસર થશે નહીં.' },
  { key: 'severability', gu: 'કોઈ કલમ રદ થાય તો', section: 'misc', label: 'Invalid clause', text: () =>
    'જો આ વસિયતનામાની કોઈ જોગવાઈ ગેરકાયદેસર, બિનઅસરકારક કે રદબાતલ ઠરે, તો તેનાથી બાકીની જોગવાઈઓને અસર થશે નહીં અને તે પૂરેપૂરી અમલમાં રહેશે.' },
]
export const CLAUSE = Object.fromEntries(CLAUSES.map((c) => [c.key, c]))

export const SECTION_TITLES = {
  declaration: 'જાહેરાત', family: 'કુટુંબ અને લાભાર્થીઓ', executor: 'અમલકર્તા (એક્ઝિક્યુટર) ની નિમણૂક',
  debts: 'અંતિમવિધિ, દેવાં અને કર', bequests: 'મિલકતની વહેંચણી', residuary: 'બાકી રહેતી મિલકત',
  alternates: 'લાભાર્થીનું અવસાન મારા પહેલાં થાય તો', minors: 'સગીર લાભાર્થીઓ માટે વાલી', wishes: 'મારી ઇચ્છાઓ',
  custom: 'અન્ય જોગવાઈઓ', misc: 'સામાન્ય જોગવાઈઓ',
}

export const clauseText = (doc, key) => doc.clauses[key]?.text ?? CLAUSE[key].text(doc)
const clauseOn = (doc, key) => !doc.clauses[key]?.off

export function introText(doc) {
  const t = doc.testator
  const rel = t.spouseOrParentName ? `${t.spouseOrParentName}ની ${t.spouseOrParentRelation || 'પત્ની'}` : ''
  return join([
    `હું, ${t.name || '________'}`, rel, t.age && `ઉંમર આશરે ${t.age} વર્ષ`, t.religion && `ધર્મ ${t.religion}`,
    t.aadhaar && `આધાર નં. ${maskId(t.aadhaar)}`, t.address && `રહેવાસી ${t.address}`,
  ]) + ', આથી ભારતમાં આવેલી મારી તમામ મિલકતો અંગે આ મારું છેલ્લું વસિયતનામું જાહેર કરું છું.'
}

// Beneficiaries = anyone receiving a share. Family members listed but receiving nothing still
// appear in the family table (so the will shows they were considered).
export function beneficiaryIds(doc) {
  const ids = new Set()
  for (const a of doc.assets) for (const s of a.shares) ids.add(s.personId)
  for (const s of doc.residuary) ids.add(s.personId)
  return ids
}

// → [{ key, title, items: [{ kind: 'para', key, text } | { kind: 'table', head, rows } | { kind: 'sub', text }] }]
export function buildWill(doc) {
  const sections = []
  const add = (key, items) => { if (items.length) sections.push({ key, title: SECTION_TITLES[key], items }) }
  const para = (key) => (clauseOn(doc, key) ? [{ kind: 'para', key, text: clauseText(doc, key) }] : [])

  add('declaration', [...para('law'), ...para('revoke'), ...para('mind')])

  if (doc.people.length) add('family', [...para('family'), {
    kind: 'table', head: ['ક્રમ', 'નામ', 'સંબંધ', 'જન્મ તારીખ', 'સરનામું / ઓળખ'],
    rows: doc.people.map((p, i) => [String(i + 1), p.name, join([p.relation, p.note], ', '), fmtDate(p.dob), join([p.address, p.idNumber && `આધાર ${maskId(p.idNumber)}`], '\n')]),
  }])

  const execs = doc.executors.map((id) => personById(doc, id)).filter(Boolean)
  if (execs.length) add('executor', [...para('executor'), {
    kind: 'table', head: ['ક્રમ', 'નામ', 'સંબંધ', 'સરનામું'],
    rows: execs.map((p, i) => [String(i + 1), p.name, p.relation, p.address || '']),
  }, ...para('powers')])

  add('debts', [...para('funeral'), ...para('debts')])

  const bequests = [...para('estate')]
  for (const t of ASSET_TYPES) {
    const list = doc.assets.filter((a) => a.type === t.id)
    if (!list.length) continue
    bequests.push({ kind: 'sub', text: t.gu })
    bequests.push({
      kind: 'table', head: ['ક્રમ', 'વિગત', 'માલિકી', 'નોમિની', 'લાભાર્થી (હિસ્સો)'],
      rows: list.map((a, i) => [String(i + 1), join([assetDescription(a), a.note?.trim() && `ખાસ સૂચના: ${a.note.trim()}`], '\n'), holdingText(a), a.nominee || '—', sharesText(doc, a.shares)]),
    })
  }
  if (doc.assets.length) add('bequests', bequests)

  if (doc.residuary.length) add('residuary', [...para('residuary'), {
    kind: 'table', head: ['લાભાર્થી', 'બાકી મિલકતમાં હિસ્સો'], rows: doc.residuary.map((s) => [who(doc, s.personId), `${s.percent}%`]),
  }, ...(doc.residuaryNote?.trim() ? [{ kind: 'para', key: 'residuary-note', text: `ખાસ સૂચના: ${doc.residuaryNote.trim()}`, plain: true }] : [])])

  const benef = doc.people.filter((p) => beneficiaryIds(doc).has(p.id))
  if (benef.length) add('alternates', [...para('alternates'), {
    kind: 'table', head: ['લાભાર્થી', 'વૈકલ્પિક લાભાર્થી'],
    rows: benef.map((p) => [p.name, p.alternate || `${p.name}ના વંશજો, સરખા ભાગે`]),
  }])

  const minors = benef.filter(isMinor)
  if (minors.length) add('minors', [...para('minors'), {
    kind: 'table', head: ['સગીર લાભાર્થી', 'જન્મ તારીખ', 'વાલી / ટ્રસ્ટી'],
    rows: minors.map((p) => [p.name, fmtDate(p.dob), who(doc, p.guardianId)]),
  }])

  const wishes = doc.wishes.filter((w) => w.text.trim())
  if (wishes.length && clauseOn(doc, 'wishes')) add('wishes', [...para('wishes'), ...wishes.map((w, i) => ({ kind: 'para', key: `wish-${w.id}`, text: `(${'કખગઘચછજઝ'[i] || i + 1}) ${w.text}` }))])

  const custom = doc.custom.filter((c) => c.text.trim())
  if (custom.length) add('custom', custom.map((c) => ({ kind: 'para', key: `custom-${c.id}`, text: c.title ? `${c.title}: ${c.text}` : c.text })))

  add('misc', [...para('schedules'), ...para('executorGift'), ...para('errors'), ...para('severability')])
  return sections
}

export const attestationText = (doc) =>
  `ઉપર મુજબનું આ મારું છેલ્લું વસિયતનામું મેં તારીખ ______________ ના રોજ, ${doc.testator.place || '______________'} ખાતે, નીચે સહી કરનાર બંને સાક્ષીઓની હાજરીમાં, પૂરેપૂરું વાંચી-સમજીને સહી કરીને કર્યું છે.`
export const witnessText = (doc) =>
  `અમે નીચે સહી કરનાર સાક્ષીઓ પ્રમાણિત કરીએ છીએ કે વસિયત કરનાર ${doc.testator.name || '________'}એ અમારી બંનેની હાજરીમાં આ વસિયતનામા પર સહી કરી છે, અને તેમની વિનંતીથી તથા તેમની હાજરીમાં અમે સાક્ષી તરીકે સહી કરી છે.`
