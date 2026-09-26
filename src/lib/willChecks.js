// Checks that catch the common problems found in real wills. Each → { level: 'error'|'warn', text, tab }.
// 'error' = the will is ambiguous or incomplete; 'warn' = worth a look. Not legal advice.
import { ASSET_TYPE, isMinor, personById, sumPercent } from './willModel'
import { assetDescription, beneficiaryIds } from './willText'

const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

export function checkWill(doc) {
  const out = []
  const push = (level, text, tab) => out.push({ level, text, tab })
  const t = doc.testator
  const label = (a) => assetDescription(a) || ASSET_TYPE[a.type].en

  if (!t.name.trim()) push('error', "The will-maker's full name is missing.", 'details')
  if (!t.address.trim()) push('warn', 'Address is missing.', 'details')
  if (!t.place.trim()) push('warn', 'Place of signing is missing (printed on the signature page).', 'details')

  for (const a of doc.assets) {
    const total = sumPercent(a.shares)
    if (!a.shares.length) push('error', `"${label(a)}" isn't given to anyone.`, 'assets')
    else if (Math.abs(total - 100) > 0.01) push('error', `"${label(a)}" shares add up to ${total}%, not 100%.`, 'assets')
    if (a.holding === 'joint') push('warn', `"${label(a)}" is jointly held${a.jointWith ? ` with ${a.jointWith}` : ''}. The will can only pass on the will-maker's own share.`, 'assets')
    if (a.nominee?.trim()) {
      const names = a.shares.map((s) => norm(personById(doc, s.personId)?.name))
      if (!names.includes(norm(a.nominee))) push('warn', `"${label(a)}": nominee (${a.nominee}) isn't one of its beneficiaries. The nominee only collects it; the will decides the owner. Consider aligning the nomination.`, 'assets')
    }
  }

  if (!doc.residuary.length) push('error', 'Nobody gets "everything else" (residuary). Anything not listed would pass by law instead of by the will.', 'distribution')
  else if (Math.abs(sumPercent(doc.residuary) - 100) > 0.01) push('error', `"Everything else" shares add up to ${sumPercent(doc.residuary)}%, not 100%.`, 'distribution')

  const benef = beneficiaryIds(doc)
  for (const p of doc.people) {
    if (benef.has(p.id) && isMinor(p) && !p.guardianId) push('error', `${p.name} is a minor and receives assets, but has no guardian / trustee.`, 'family')
    if (benef.has(p.id) && !p.dob) push('warn', `${p.name}: add a date of birth (identifies them and shows if they're a minor).`, 'family')
  }
  if (!doc.executors.length) push('warn', 'No executor appointed.', 'distribution')

  const familyNames = new Set(doc.people.map((p) => norm(p.name)))
  const filled = doc.witnesses.filter((w) => w.name.trim())
  if (filled.length < 2) push('warn', 'Two witnesses are needed when signing (names can also be written in by hand).', 'details')
  for (const w of filled) {
    if (familyNames.has(norm(w.name))) push('error', `Witness ${w.name} is in the family list. A witness (or their spouse) must not be a beneficiary — a gift to them becomes void.`, 'details')
  }

  // Wishes that look like they give things away belong in the distribution, not wishes.
  for (const w of doc.wishes) {
    if (/બાકી|વહેંચ|મિલકત|હિસ્સો|remaining|distribut/i.test(w.text)) push('warn', `A wish mentions dividing property ("${w.text.slice(0, 40)}…"). Put who gets what in Distribution, so it can't contradict the "everything else" clause.`, 'distribution')
  }
  return out
}
