import { today } from './format'

// Emergency sheet: one encrypted page for "if something happens" — who to call, where things are, how to
// get in. A vault item of type 'emergency' (encrypted with the Vault key, shared with household logins
// through the usual "Share with" chips). Money, insurance and contacts are LINKED live from what's already
// in the Vault / Budget / Plan / Dues, so there is nothing to keep up twice; only the human parts are typed.
export const EMERGENCY_TYPE = 'emergency'

// Headings in English and Gujarati (the family reads both). `help` is the one-line hint under the heading.
export const SECTIONS = {
  people: { en: 'People to call', gu: 'સંપર્ક કરવાના લોકો', help: 'Who to call first, and why.', helpGu: 'સૌથી પહેલાં કોને ફોન કરવો, અને શા માટે.' },
  money: { en: 'Money & accounts', gu: 'પૈસા અને ખાતાં', help: 'Bank accounts, FDs, locker.', helpGu: 'બેંક ખાતાં, એફડી, લૉકર.' },
  insurance: { en: 'Insurance & loans', gu: 'વીમો અને લોન', help: 'Policies and loans, and who to contact to claim or settle.', helpGu: 'પૉલિસી અને લોન, ક્લેમ કે ચુકવણી માટે કોને સંપર્ક કરવો.' },
  papers: { en: 'Papers & Will', gu: 'કાગળો અને વસિયતનામું', help: 'Where the original papers and the Will are kept.', helpGu: 'અસલ કાગળો અને વસિયતનામું ક્યાં રાખ્યાં છે.' },
  access: { en: 'Getting in', gu: 'ખોલવાની રીત', help: 'Where the Vault password or recovery code is kept — never the password itself.', helpGu: 'વૉલ્ટનો પાસવર્ડ કે રિકવરી કોડ ક્યાં રાખ્યો છે — પાસવર્ડ પોતે અહીં ન લખવો.' },
  instructions: { en: 'Instructions', gu: 'સૂચનાઓ', help: 'Anything else the family should know or do.', helpGu: 'પરિવારે બીજું કંઈ જાણવું કે કરવું હોય તે.' },
}
export const TITLE = { en: 'If something happens', gu: 'કંઈ અણધાર્યું થાય તો' }
export const REVIEW_MONTHS = 6

export const emptyEmergency = () => ({
  type: EMERGENCY_TYPE, title: 'Emergency sheet',
  people: [], // [{ id, name, relation, phone, note }]
  vaultIds: [], // linked Vault items (bank, insurance, health, contact)
  live: { accounts: true, plan: true, dues: true }, // also show Budget accounts, policy / loan commitments in Plan, open Dues
  papers: '', access: '', instructions: '', reviewedAt: '',
})

// Vault item types that can be linked, and which section they belong to.
export const LINKABLE = { bank: 'money', health: 'insurance', insurance: 'insurance', contact: 'people' }
export const linkable = (items) => (items || []).filter((i) => LINKABLE[i.type] && !i.corrupt)

// Only the last 4 digits of an account number ever appear on the sheet.
export const maskNumber = (n) => { const d = String(n || '').replace(/\s/g, ''); return d ? `•••• ${d.slice(-4)}` : '' }

// What a linked Vault item shows on the sheet: a title and a few plain lines.
export function describe(item) {
  const join = (...a) => a.filter(Boolean).join(' · ')
  if (item.type === 'bank') return { title: join(item.bankName, item.accountType), lines: [join(item.accountNumber && `A/c ${maskNumber(item.accountNumber)}`, item.ifsc && `IFSC ${item.ifsc}`), join(item.branchAddress, item.branchPhone)].filter(Boolean) }
  if (item.type === 'health') return { title: join(item.company, item.insuranceType), lines: [join(item.policyNumber && `Policy ${item.policyNumber}`, item.memberName), join(item.sumInsured && `Sum insured ${item.sumInsured}`, item.expiry && `Renews ${item.expiry}`), join(item.companyPhone, item.tpa)].filter(Boolean) }
  if (item.type === 'insurance') return { title: join(item.company, item.policyType), lines: [join(item.policyNumber && `Policy ${item.policyNumber}`, item.premium && `Premium ${item.premium}`), join(item.expiry && `Renews ${item.expiry}`), join(item.agentName, item.agentPhone)].filter(Boolean) }
  if (item.type === 'contact') return { title: [item.firstName, item.lastName].filter(Boolean).join(' ') || item.title, lines: [join(item.phone, item.company)].filter(Boolean) }
  return { title: item.title || '', lines: [] }
}

// Plan commitments that look like a policy, a loan or an investment (these go in "Insurance & loans").
export const POLICY_OR_LOAN = /insur|\blic\b|polic|premium|loan|\bemi\b|mortgage|\bsip\b|mutual|\bfd\b|deposit|gold/i
export const looksLikePolicyOrLoan = (item) => POLICY_OR_LOAN.test(`${item.name || ''} ${item.category || ''}`)

// "Reviewed 12 Oct 2026" and whether it is time to look at the sheet again.
export function reviewState(reviewedAt, now = today()) {
  if (!reviewedAt) return { text: 'Not reviewed yet', due: true }
  const due = new Date(reviewedAt + 'T00:00:00Z')
  due.setUTCMonth(due.getUTCMonth() + REVIEW_MONTHS)
  const overdue = due.toISOString().slice(0, 10) <= now
  return { text: `Last reviewed ${reviewedAt}`, due: overdue }
}
