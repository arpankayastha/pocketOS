// Vault item types (LastPass-style). Every item is one encrypted JSON blob:
// { type, title, folder, notes, ...fields }. Items saved before types existed have no
// `type` and are treated as 'password'.
//
// Field kinds: text | secret (hidden, copyable) | url | email | tel | number | date | month
// | select (needs `options`) | textarea | secretarea (hidden multi-line, e.g. private keys) | totp.
// `copy: true` adds a copy button in the detail view. Labels deliberately match LastPass's
// so secure notes from a LastPass export map onto these fields by label.
import {
  KeyIcon, PasskeyIcon, NoteIcon, ContactIcon, CardIcon, BankIcon, CarIcon, PassportIcon, IdCardIcon,
  HeartIcon, UmbrellaIcon, MemberIcon, WifiIcon, MailIcon, ChatIcon, DatabaseIcon, ServerIcon, TerminalIcon, LaptopIcon,
} from './icons'
import { hostOf } from './vaultTools'

const f = (key, label, kind = 'text', extra = {}) => ({ key, label, kind, ...extra })
const user = f('username', 'Username', 'text', { copy: true })
const pass = f('password', 'Password', 'secret', { copy: true })

export const VAULT_TYPES = [
  // --- group 1
  { id: 'password', label: 'Password', icon: KeyIcon, group: 1, fields: [
    f('url', 'Website', 'url'), f('username', 'Username or email', 'text', { copy: true }), pass, f('totp', '2FA secret', 'totp'),
  ], subtitle: (i) => i.username || hostOf(i.url) },
  { id: 'passkey', label: 'Passkey', icon: PasskeyIcon, group: 1,
    hint: "A record of where you use a passkey. The passkey itself stays in your phone's password manager; web apps can't store or use it.",
    fields: [f('url', 'Website', 'url'), f('username', 'Username or email', 'text', { copy: true }), f('device', 'Stored on (device / manager)')],
    subtitle: (i) => i.username || hostOf(i.url) },
  { id: 'note', label: 'Secure note', icon: NoteIcon, group: 1, fields: [], notesLabel: 'Note', notesFirst: true,
    subtitle: (i) => (i.notes || '').split('\n')[0].slice(0, 60) },
  { id: 'contact', label: 'Contact info', icon: ContactIcon, group: 1, fields: [
    f('firstName', 'First Name'), f('lastName', 'Last Name'), f('email', 'Email Address', 'email', { copy: true }), f('phone', 'Phone', 'tel', { copy: true }),
    f('company', 'Company'), f('address1', 'Address 1'), f('address2', 'Address 2'), f('city', 'City / Town'), f('state', 'State'),
    f('zip', 'Zip / Postal Code'), f('country', 'Country'), f('birthday', 'Birthday', 'date'),
  ], titleFrom: (i) => [i.firstName, i.lastName].filter(Boolean).join(' '), subtitle: (i) => i.email || i.phone },

  // --- group 2: money
  { id: 'card', label: 'Payment card', icon: CardIcon, group: 2, fields: [
    f('cardName', 'Name on Card'), f('cardType', 'Type', 'select', { options: ['Visa', 'Mastercard', 'RuPay', 'American Express', 'Diners Club', 'Other'] }),
    f('number', 'Number', 'secret', { copy: true, inputMode: 'numeric' }), f('cvv', 'Security Code', 'secret', { copy: true, inputMode: 'numeric' }),
    f('expiry', 'Expiration Date', 'month'), f('startDate', 'Start Date', 'month'), f('pin', 'PIN', 'secret', { inputMode: 'numeric' }), f('issuer', 'Bank'),
  ], titleFrom: (i) => [i.issuer, i.cardType].filter(Boolean).join(' ') || (i.number ? `Card ${last4(i.number)}` : ''),
  subtitle: (i) => [i.cardType, i.number && last4(i.number), i.expiry && `exp ${formatMonth(i.expiry)}`].filter(Boolean).join(' · ') },
  { id: 'bank', label: 'Bank account', icon: BankIcon, group: 2, fields: [
    f('bankName', 'Bank Name'), f('accountType', 'Account Type', 'select', { options: ['Savings', 'Current', 'Salary', 'NRE', 'NRO', 'Fixed deposit', 'Checking', 'Other'] }),
    f('accountNumber', 'Account Number', 'secret', { copy: true, inputMode: 'numeric' }), f('ifsc', 'IFSC Code', 'text', { copy: true }),
    f('customerId', 'Customer ID / Net banking ID', 'text', { copy: true }), f('routingNumber', 'Routing Number', 'text', { copy: true }),
    f('swift', 'SWIFT Code', 'text', { copy: true }), f('iban', 'IBAN Number', 'text', { copy: true }), f('pin', 'PIN', 'secret'),
    f('branchAddress', 'Branch Address'), f('branchPhone', 'Branch Phone', 'tel'),
  ], titleFrom: (i) => [i.bankName, i.accountType].filter(Boolean).join(' '),
  subtitle: (i) => [i.accountType, i.accountNumber && last4(i.accountNumber)].filter(Boolean).join(' · ') },

  // --- group 3: identity
  { id: 'license', label: "Driver's license", icon: CarIcon, group: 3, fields: [
    f('number', 'Number', 'secret', { copy: true }), f('name', 'Name'), f('dob', 'Date of Birth', 'date'), f('issued', 'Issued Date', 'date'),
    f('expiry', 'Expiration Date', 'date'), f('licenseClass', 'License Class'), f('state', 'State'), f('country', 'Country'), f('address', 'Address'),
  ], titleFrom: (i) => (i.name ? `${i.name}'s license` : "Driver's license"), subtitle: (i) => i.expiry && `expires ${i.expiry}` },
  { id: 'passport', label: 'Passport', icon: PassportIcon, group: 3, fields: [
    f('number', 'Number', 'secret', { copy: true }), f('name', 'Name'), f('country', 'Country'), f('nationality', 'Nationality'),
    f('sex', 'Sex', 'select', { options: ['Female', 'Male', 'Other'] }), f('dob', 'Date of Birth', 'date'), f('issuingAuthority', 'Issuing Authority'),
    f('issued', 'Issued Date', 'date'), f('expiry', 'Expiration Date', 'date'), f('fileNumber', 'File Number'),
  ], titleFrom: (i) => (i.name ? `${i.name}'s passport` : 'Passport'), subtitle: (i) => i.expiry && `expires ${i.expiry}` },
  { id: 'id', label: 'Government ID', icon: IdCardIcon, group: 3, pickerHint: 'Aadhaar, PAN, Voter ID, SSN', fields: [
    f('idType', 'ID Type', 'select', { options: ['Aadhaar', 'PAN', 'Voter ID', 'Social Security (SSN)', 'Other'] }),
    f('number', 'Number', 'secret', { copy: true }), f('name', 'Name'), f('dob', 'Date of Birth', 'date'), f('issued', 'Issued Date', 'date'),
  ], titleFrom: (i) => [i.idType, i.name].filter(Boolean).join(' · '), subtitle: (i) => i.number && last4(i.number) },

  // --- group 4: everyday
  { id: 'health', label: 'Health insurance', icon: HeartIcon, group: 4, fields: [
    f('company', 'Company'), f('companyPhone', 'Company Phone', 'tel', { copy: true }), f('policyNumber', 'Policy Number', 'text', { copy: true }),
    f('insuranceType', 'Insurance Type'), f('memberName', 'Member Name'), f('memberId', 'Member ID', 'text', { copy: true }), f('groupId', 'Group ID'),
    f('sumInsured', 'Sum Insured'), f('expiry', 'Renewal Date', 'date'), f('tpa', 'TPA / Helpline', 'tel'),
  ], titleFrom: (i) => i.company, subtitle: (i) => [i.policyNumber, i.expiry && `renews ${i.expiry}`].filter(Boolean).join(' · ') },
  { id: 'insurance', label: 'Insurance policy', icon: UmbrellaIcon, group: 4, fields: [
    f('company', 'Company'), f('policyType', 'Policy Type', 'select', { options: ['Life', 'Term', 'Motor', 'Home', 'Travel', 'Other'] }),
    f('policyNumber', 'Policy Number', 'text', { copy: true }), f('expiry', 'Expiration / Renewal', 'date'), f('premium', 'Premium'),
    f('agentName', 'Agent Name'), f('agentPhone', 'Agent Phone', 'tel', { copy: true }), f('url', 'Website', 'url'),
  ], titleFrom: (i) => [i.company, i.policyType].filter(Boolean).join(' '), subtitle: (i) => i.policyNumber },
  { id: 'membership', label: 'Membership card', icon: MemberIcon, group: 4, fields: [
    f('organization', 'Organization'), f('memberNumber', 'Membership Number', 'text', { copy: true }), f('memberName', 'Member Name'),
    f('startDate', 'Start Date', 'date'), f('expiry', 'Expiration Date', 'date'), f('url', 'Website', 'url'), f('phone', 'Telephone', 'tel'), pass,
  ], titleFrom: (i) => i.organization, subtitle: (i) => i.memberNumber },
  { id: 'wifi', label: 'Wi-Fi password', icon: WifiIcon, group: 4, fields: [
    f('ssid', 'SSID (network name)', 'text', { copy: true }), pass,
    f('security', 'Security', 'select', { options: ['WPA3', 'WPA2', 'WPA', 'WEP', 'None'] }), f('location', 'Location'),
  ], titleFrom: (i) => i.ssid, subtitle: (i) => i.location || i.security },

  // --- group 5: accounts
  { id: 'email', label: 'Email account', icon: MailIcon, group: 5, fields: [
    user, pass, f('serverType', 'Type', 'select', { options: ['IMAP', 'POP3', 'Exchange', 'Other'] }), f('server', 'Server'), f('port', 'Port', 'number'),
    f('smtpServer', 'SMTP Server'), f('smtpPort', 'SMTP Port', 'number'),
  ], titleFrom: (i) => i.username, subtitle: (i) => i.server },
  { id: 'messenger', label: 'Instant messenger', icon: ChatIcon, group: 5, fields: [
    f('service', 'Type'), user, pass, f('server', 'Server'), f('port', 'Port', 'number'),
  ], titleFrom: (i) => i.service, subtitle: (i) => i.username },

  // --- group 6: tech
  { id: 'database', label: 'Database', icon: DatabaseIcon, group: 6, fields: [
    f('dbType', 'Type', 'select', { options: ['PostgreSQL', 'MySQL', 'SQL Server', 'Oracle', 'MongoDB', 'Redis', 'SQLite', 'Other'] }),
    f('hostname', 'Hostname', 'text', { copy: true }), f('port', 'Port', 'number'), f('database', 'Database', 'text', { copy: true }), user, pass,
    f('connectionString', 'Connection String', 'secret', { copy: true }),
  ], titleFrom: (i) => i.database || i.hostname, subtitle: (i) => [i.dbType, i.hostname].filter(Boolean).join(' · ') },
  { id: 'server', label: 'Server', icon: ServerIcon, group: 6, fields: [
    f('hostname', 'Hostname', 'text', { copy: true }), user, pass, f('port', 'Port', 'number'),
  ], titleFrom: (i) => i.hostname, subtitle: (i) => i.username && `${i.username}@${i.hostname || ''}` },
  { id: 'ssh', label: 'SSH key', icon: TerminalIcon, group: 6, fields: [
    f('privateKey', 'Private Key', 'secretarea', { copy: true }), f('publicKey', 'Public Key', 'textarea', { copy: true }),
    f('passphrase', 'Passphrase', 'secret', { copy: true }), f('keyType', 'Format', 'select', { options: ['ed25519', 'RSA', 'ECDSA', 'Other'] }),
    f('hostname', 'Hostname'),
  ], titleFrom: (i) => i.hostname, subtitle: (i) => [i.keyType, i.hostname].filter(Boolean).join(' · ') },
  { id: 'software', label: 'Software license', icon: LaptopIcon, group: 6, fields: [
    f('licenseKey', 'License Key', 'secret', { copy: true }), f('licensee', 'Licensee'), f('version', 'Version'), f('publisher', 'Publisher'),
    f('supportEmail', 'Support Email', 'email'), f('url', 'Website', 'url'), f('purchaseDate', 'Purchase Date', 'date'),
    f('orderNumber', 'Order Number', 'text', { copy: true }), f('seats', 'Number of Licenses', 'number'),
  ], titleFrom: (i) => [i.publisher, i.version].filter(Boolean).join(' '), subtitle: (i) => i.licensee },
]

export const TYPE_BY_ID = Object.fromEntries(VAULT_TYPES.map((t) => [t.id, t]))
export const typeOf = (item) => TYPE_BY_ID[item?.type] || TYPE_BY_ID.password

export function itemTitle(item) {
  return item.title || typeOf(item).titleFrom?.(item) || hostOf(item.url) || typeOf(item).label
}

export function itemSubtitle(item) {
  return typeOf(item).subtitle?.(item) || ''
}

// Values that are safe to match in search (never secrets).
export function searchText(item) {
  const t = typeOf(item)
  const plain = t.fields.filter((fl) => !['secret', 'secretarea', 'totp'].includes(fl.kind)).map((fl) => item[fl.key])
  return [itemTitle(item), item.folder, t.label, ...plain].filter(Boolean).join(' ').toLowerCase()
}

export const last4 = (n) => `•••• ${String(n).replace(/\s/g, '').slice(-4)}`
export const formatMonth = (ym) => (/^\d{4}-\d{2}$/.test(ym) ? `${ym.slice(5)}/${ym.slice(2, 4)}` : ym)

// LastPass secure-note types → ours. LastPass exports them as url "http://sn" with
// `extra` = "NoteType:Credit Card\nLanguage:en-US\nName on Card:…\n…\nNotes:…".
const LASTPASS_NOTE_TYPES = {
  'Credit Card': 'card', 'Bank Account': 'bank', "Driver's License": 'license', Passport: 'passport',
  'Social Security': 'id', 'Health Insurance': 'health', Insurance: 'insurance', Membership: 'membership',
  'Wi-Fi Password': 'wifi', 'Email Account': 'email', 'Instant Messenger': 'messenger', Database: 'database',
  Server: 'server', 'SSH Key': 'ssh', 'Software License': 'software', Address: 'contact',
}
// Labels LastPass uses that we drop (null) or map to a differently-labelled field.
const LABEL_ALIASES = { sid: null, date: null, 'bit strength': null, language: null, 'ssid': 'ssid', 'account number': 'accountNumber' }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const pad = (n) => String(n).padStart(2, '0')

// LastPass writes dates as "March,2027" (month fields) or "March,5,1990" (date fields);
// convert to the YYYY-MM / YYYY-MM-DD our date inputs use. Unrecognised text is kept as-is.
function lastPassDate(value, kind) {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
  const m = MONTHS.indexOf((parts[0] || '').toLowerCase()) + 1
  if (!m) {
    const mmYY = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(value) // "08/29" or "08/2029"
    if (kind === 'month' && mmYY) return `${mmYY[2].length === 2 ? `20${mmYY[2]}` : mmYY[2]}-${pad(mmYY[1])}`
    return value
  }
  if (kind === 'month' && parts.length === 2) return `${parts[1]}-${pad(m)}`
  if (kind === 'date' && parts.length === 3) return `${parts[2]}-${pad(m)}-${pad(parts[1])}`
  return value
}

// Turns one LastPass CSV row's secure note into a typed item (or a plain secure note).
export function typedFromLastPassNote(extra) {
  const lines = (extra || '').split(/\r?\n/)
  const m = /^NoteType:(.*)$/.exec(lines[0] || '')
  const typeId = m && LASTPASS_NOTE_TYPES[m[1].trim()]
  if (!typeId) return { type: 'note', notes: extra || '' }
  const t = TYPE_BY_ID[typeId]
  const byLabel = Object.fromEntries(t.fields.map((fl) => [fl.label.toLowerCase(), fl.key]))
  const kindOf = Object.fromEntries(t.fields.map((fl) => [fl.key, fl.kind]))
  const item = { type: typeId }
  const leftovers = []
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(':')
    if (idx < 0) { leftovers.push(lines[i]); continue }
    const label = lines[i].slice(0, idx).trim()
    let value = lines[i].slice(idx + 1).trim()
    if (!value.replace(/[,\s]/g, '')) value = '' // LastPass writes an empty date as ","
    if (label === 'Notes') { item.notes = [value, ...lines.slice(i + 1)].join('\n').trim(); break }
    const lower = label.toLowerCase()
    const key = lower in LABEL_ALIASES ? LABEL_ALIASES[lower] : byLabel[lower]
    if (key === null) continue
    if (key && value) item[key] = ['date', 'month'].includes(kindOf[key]) ? lastPassDate(value, kindOf[key]) : value
    else if (value) leftovers.push(`${label}: ${value}`)
  }
  if (leftovers.length) item.notes = [item.notes, ...leftovers].filter(Boolean).join('\n')
  return item
}
