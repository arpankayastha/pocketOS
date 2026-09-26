// Will module data model. The whole will is ONE JSON document, encrypted with the Vault key
// (see useWill). Everything the PDF says is generated from this document by willText.js,
// except clause text the user has overridden (doc.clauses) and custom clauses.

export const uid = () => crypto.randomUUID()

// Relations are stored as Gujarati text (what the PDF prints). Presets cover the family; any
// other text is allowed. `note` adds a phrase such as "પુત્રી સમાન" (regarded as a daughter).
export const RELATIONS = [
  'પુત્ર', 'પુત્રી', 'પુત્રવધૂ', 'જમાઈ', 'પૌત્ર', 'પૌત્રી', 'દોહિત્ર', 'દોહિત્રી',
  'પતિ', 'ભાઈ', 'બહેન', 'ભાણી', 'ભાણેજ', 'ભત્રીજો', 'ભત્રીજી', 'અન્ય',
]
export const RELATION_EN = {
  'પુત્ર': 'son', 'પુત્રી': 'daughter', 'પુત્રવધૂ': 'daughter-in-law', 'જમાઈ': 'son-in-law', 'પૌત્ર': "son's son",
  'પૌત્રી': "son's daughter", 'દોહિત્ર': "daughter's son", 'દોહિત્રી': "daughter's daughter", 'પતિ': 'husband',
  'ભાઈ': 'brother', 'બહેન': 'sister', 'ભાણી': "sister's daughter", 'ભાણેજ': "sister's son", 'ભત્રીજો': "brother's son",
  'ભત્રીજી': "brother's daughter", 'અન્ય': 'other',
}

// Asset types: `fields` drive the form; `describe` builds the Gujarati description line in the PDF.
const f = (key, label, extra = {}) => ({ key, label, ...extra })
export const ASSET_TYPES = [
  { id: 'property', gu: 'સ્થાવર મિલકત (મકાન / ફ્લેટ / જમીન)', en: 'House, flat or land', fields: [
    f('description', 'Description (e.g. ફ્લેટ નં. A1-107)'), f('address', 'Address', { multiline: true }), f('surveyNo', 'Survey / Khata / City survey no.'),
  ] },
  { id: 'bank', gu: 'બેંક ખાતું', en: 'Bank account', fields: [
    f('bank', 'Bank'), f('branch', 'Branch'), f('ifsc', 'IFSC'), f('accountNo', 'Account number', { mono: true }),
  ] },
  { id: 'fd', gu: 'ફિક્સ્ડ ડિપોઝિટ', en: 'Fixed deposit', fields: [
    f('bank', 'Bank'), f('branch', 'Branch'), f('fdNo', 'FD number', { mono: true }), f('amount', 'Amount (₹)', { inputMode: 'decimal' }), f('maturity', 'Maturity date', { type: 'date' }),
  ] },
  { id: 'savings', gu: 'સરકારી / પોસ્ટ બચત યોજના (KVP, NSC, PPF, SSY)', en: 'KVP, NSC, PPF, post office', fields: [
    f('scheme', 'Scheme (e.g. કિસાન વિકાસ પત્ર)'), f('office', 'Post office / bank'), f('certNo', 'Certificate / account no.', { mono: true }), f('amount', 'Amount (₹)', { inputMode: 'decimal' }), f('maturity', 'Maturity date', { type: 'date' }),
  ] },
  { id: 'insurance', gu: 'વીમા પૉલિસી', en: 'Insurance (LIC etc.)', fields: [
    f('company', 'Company (e.g. LIC)'), f('plan', 'Plan'), f('policyNo', 'Policy number', { mono: true }), f('amount', 'Sum assured (₹)', { inputMode: 'decimal' }),
  ] },
  { id: 'investment', gu: 'રોકાણ (મ્યુચ્યુઅલ ફંડ / શેર)', en: 'Mutual funds, shares', fields: [
    f('description', 'Description'), f('institution', 'AMC / broker'), f('folio', 'Folio / demat ID', { mono: true }),
  ] },
  { id: 'jewellery', gu: 'દાગીના', en: 'Jewellery', fields: [
    f('item', 'Item (e.g. સોનાની ૨ બંગડી)'), f('metal', 'Metal', { options: ['સોનું', 'ચાંદી', 'હીરા', 'અન્ય'] }), f('weight', 'Weight (grams)', { inputMode: 'decimal' }),
  ] },
  { id: 'vehicle', gu: 'વાહન', en: 'Vehicle', fields: [
    f('model', 'Model'), f('regNo', 'Registration number', { mono: true }),
  ] },
  { id: 'other', gu: 'અન્ય મિલકત', en: 'Other', fields: [
    f('description', 'Description', { multiline: true }),
  ] },
]
export const ASSET_TYPE = Object.fromEntries(ASSET_TYPES.map((t) => [t.id, t]))

export function emptyWill() {
  return {
    version: 1,
    testator: {
      name: '', spouseOrParentRelation: 'પત્ની', spouseOrParentName: '', age: '', religion: 'હિંદુ',
      address: '', aadhaar: '', place: '',
    },
    people: [],      // { id, name, relation, note, dob, address, idNumber, guardianId, alternate }
    executors: [],   // person ids, in priority order
    assets: [],      // { id, type, holding: 'single'|'joint', jointWith, nominee, shares: [{ personId, percent }], note, ...type fields }
    residuary: [],   // [{ personId, percent }]
    wishes: [],      // [{ id, text }] — moral wishes, not bequests
    funeral: 'હિંદુ',
    witnesses: [{ name: '', address: '' }, { name: '', address: '' }],
    clauses: {},     // clause key → { off?: true, text?: string } overrides of the standard Gujarati text
    custom: [],      // [{ id, title, text }] extra clauses, printed before the signature page
    settings: { gujaratiDigits: true },
  }
}

// ---- helpers ----
export function ageOn(dob, on = new Date()) {
  if (!dob) return null
  const d = new Date(dob)
  let a = on.getFullYear() - d.getFullYear()
  if (on.getMonth() < d.getMonth() || (on.getMonth() === d.getMonth() && on.getDate() < d.getDate())) a--
  return a
}
export const isMinor = (p) => { const a = ageOn(p.dob); return a !== null && a < 18 }
export const personById = (doc, id) => doc.people.find((p) => p.id === id)
export const sumPercent = (shares) => shares.reduce((s, x) => s + (Number(x.percent) || 0), 0)

// Everything each person receives, for the "who gets what" summary.
export function allocations(doc) {
  const out = Object.fromEntries(doc.people.map((p) => [p.id, []]))
  for (const a of doc.assets) for (const s of a.shares) if (out[s.personId]) out[s.personId].push({ asset: a, percent: Number(s.percent) || 0 })
  for (const s of doc.residuary) if (out[s.personId]) out[s.personId].push({ residuary: true, percent: Number(s.percent) || 0 })
  return out
}
