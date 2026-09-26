// Checks that catch the common problems found in real wills, worded in plain Gujarati so the
// will-maker can follow. Each → { level: 'error'|'warn', text, tab }.
// 'error' = the will is unclear or incomplete; 'warn' = worth a look. Not legal advice.
import { ASSET_TYPE, isMinor, personById, sumPercent } from './willModel'
import { assetDescription, beneficiaryIds } from './willText'

const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

export function checkWill(doc) {
  const out = []
  const push = (level, text, tab) => out.push({ level, text, tab })
  const t = doc.testator
  const label = (a) => (assetDescription(a) || ASSET_TYPE[a.type].gu).replace(/⁣/g, '')

  if (!t.name.trim()) push('error', 'વસિયત કરનારનું પૂરું નામ લખવાનું બાકી છે.', 'details')
  if (!t.address.trim()) push('warn', 'વસિયત કરનારનું સરનામું બાકી છે.', 'details')
  if (!t.place.trim()) push('warn', 'સહી કરવાનું સ્થળ (શહેર) બાકી છે — તે સહીના પાના પર છપાય છે.', 'details')

  for (const a of doc.assets) {
    const total = sumPercent(a.shares)
    if (!a.shares.length) push('error', `"${label(a)}" હજુ કોઈને આપેલ નથી.`, 'assets')
    else if (Math.abs(total - 100) > 0.01) push('error', `"${label(a)}" ના હિસ્સાનો સરવાળો ${total}% છે, ૧૦૦% હોવો જોઈએ.`, 'assets')
    if (a.holding === 'joint') push('warn', `"${label(a)}" ${a.jointWith ? `${a.jointWith} સાથે ` : ''}સંયુક્ત માલિકીની છે. વસિયતનામાથી ફક્ત પોતાનો હિસ્સો જ આપી શકાય.`, 'assets')
    if (a.nominee?.trim()) {
      const names = a.shares.map((s) => norm(personById(doc, s.personId)?.name))
      if (!names.includes(norm(a.nominee))) push('warn', `"${label(a)}": નોમિની (${a.nominee}) તેના લાભાર્થીઓમાં નથી. નોમિની ફક્ત રકમ મેળવે છે, માલિક વસિયતનામા મુજબ નક્કી થાય છે — છતાં બેંક / LICમાં નોમિની બદલી લેવું સારું.`, 'assets')
    }
  }

  if (!doc.residuary.length) push('error', '"બાકી રહેતી મિલકત" કોને મળે તે નક્કી નથી. નહીં તો યાદીમાં ન હોય તેવી મિલકત કાયદા મુજબ વહેંચાશે.', 'distribution')
  else if (Math.abs(sumPercent(doc.residuary) - 100) > 0.01) push('error', `"બાકી રહેતી મિલકત" ના હિસ્સાનો સરવાળો ${sumPercent(doc.residuary)}% છે, ૧૦૦% હોવો જોઈએ.`, 'distribution')

  const benef = beneficiaryIds(doc)
  for (const p of doc.people) {
    if (benef.has(p.id) && isMinor(p) && !p.guardianId) push('error', `${p.name} સગીર છે અને તેમને મિલકત મળે છે, પણ વાલી / ટ્રસ્ટી નક્કી નથી.`, 'family')
    if (benef.has(p.id) && !p.dob) push('warn', `${p.name}ની જન્મ તારીખ ઉમેરો (ઓળખ માટે અને સગીર છે કે નહીં તે જાણવા).`, 'family')
  }
  if (!doc.executors.length) push('warn', 'કોઈ અમલકર્તા (એક્ઝિક્યુટર) નક્કી નથી.', 'distribution')

  const familyNames = new Set(doc.people.map((p) => norm(p.name)))
  const filled = doc.witnesses.filter((w) => w.name.trim())
  if (filled.length < 2) push('warn', 'સહી વખતે બે સાક્ષી જોઈશે (નામ પછીથી હાથે પણ લખી શકાય).', 'details')
  for (const w of filled) {
    if (familyNames.has(norm(w.name))) push('error', `સાક્ષી ${w.name} કુટુંબની યાદીમાં છે. લાભાર્થી (કે તેમના પતિ/પત્ની) સાક્ષી બને તો તેમને મળતી મિલકત રદ થઈ શકે.`, 'details')
  }

  // Wishes / residuary notes that look like they give property away belong in the distribution.
  for (const w of doc.wishes) {
    if (/બાકી|વહેંચ|મિલકત|હિસ્સો|remaining|distribut/i.test(w.text)) push('warn', `એક ઇચ્છામાં મિલકત વહેંચવાની વાત છે ("${w.text.slice(0, 40)}…"). તે "બાકી રહેતી મિલકત" સાથે વિરોધાભાસી ન હોય તે તપાસો — મિલકતની વહેંચણી "મિલકત" / "બાકી મિલકત"માં જ લખવી.`, 'distribution')
  }
  return out
}
