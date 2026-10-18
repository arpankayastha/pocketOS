import { BankIcon, CardIcon, ContactIcon, HeartIcon, ListIcon, UmbrellaIcon } from '../lib/icons'
import { SECTIONS, TITLE, describe, looksLikePolicyOrLoan, reviewState } from '../lib/emergency'
import { money } from '../lib/format'

const ICONS = { bank: BankIcon, card: CardIcon, health: HeartIcon, insurance: UmbrellaIcon, contact: ContactIcon, plan: ListIcon, other: ListIcon }

function Section({ id, show, children }) {
  return show && (
    <section className="emg-section">
      <h2>{SECTIONS[id].en} <span lang="gu">· {SECTIONS[id].gu}</span></h2>
      {children}
    </section>
  )
}

// One tidy row: icon, name + subline, a reference on the right, optional detail lines underneath.
function Row({ kind, title, sub, meta, lines = [] }) {
  const Icon = ICONS[kind] || ListIcon
  return (
    <li className="emg-row">
      <span className="emg-badge" aria-hidden="true"><Icon /></span>
      <div className="emg-main">
        <div className="emg-title">{title}</div>
        {sub && <div className="emg-sub">{sub}</div>}
        {lines.map((l, i) => <div key={i} className="emg-sub">{l}</div>)}
      </div>
      {meta && <div className="emg-meta">{meta}</div>}
    </li>
  )
}
const Group = ({ label, children }) => <><div className="emg-group">{label}</div><ul className="emg-rows">{children}</ul></>
const Text = ({ value }) => (value ? <p className="emg-text">{value}</p> : null)

// The sheet itself, in English and Gujarati. Used on screen and for the printed / PDF copy.
// `live` = { accounts, plan, dues } read from Budget; `linked` = the Vault items the sheet links.
export default function EmergencyDoc({ data, linked, live, print = false }) {
  const typeOf = (i) => ({ bank: 'money', health: 'insurance', insurance: 'insurance', contact: 'people' })[i.type]
  const byType = (sec) => linked.filter((i) => typeOf(i) === sec).map(describe)
  const policyPlans = (live?.plan || []).filter(looksLikePolicyOrLoan)
  const review = reviewState(data.reviewedAt)
  const people = data.people.filter((p) => p.name || p.phone)
  const contacts = byType('people')
  const moneyItems = byType('money')
  const insuranceItems = byType('insurance')
  const accountRows = live?.accounts || []
  const dueRows = live?.dues || []
  const manyHouseholds = (live?.households?.length || 0) > 1

  return (
    <article className={`emg-doc ${print ? 'print' : ''}`}>
      <header>
        <h1>{TITLE.en}</h1>
        <div className="emg-gu" lang="gu">{TITLE.gu}</div>
        {print && <div className="emg-stamp">{review.text}</div>}
      </header>

      <Section id="people" show={people.length > 0 || contacts.length > 0}>
        <ul className="emg-rows">
          {people.map((p) => <Row key={p.id} kind="contact" title={p.name} sub={[p.relation, p.note].filter(Boolean).join(' · ')} meta={p.phone} />)}
          {contacts.map((c, i) => <Row key={`c${i}`} {...c} />)}
        </ul>
      </Section>

      <Section id="money" show={moneyItems.length > 0 || accountRows.length > 0}>
        {moneyItems.length > 0 && <Group label="Bank accounts · બેંક ખાતાં">{moneyItems.map((m, i) => <Row key={i} {...m} />)}</Group>}
        {accountRows.length > 0 && (
          <Group label="From Budget · બજેટમાંથી">
            {accountRows.map((a) => (
              <Row key={a.id} kind={a.type === 'card' ? 'card' : 'bank'} title={a.bank || a.name}
                sub={[a.bank ? a.name : '', a.type === 'card' ? 'Credit card' : '', manyHouseholds ? a.household : ''].filter(Boolean).join(' · ')}
                meta={a.digits?.length ? `•••• ${a.digits[0]}` : ''} />
            ))}
          </Group>
        )}
      </Section>

      <Section id="insurance" show={insuranceItems.length > 0 || policyPlans.length > 0 || dueRows.length > 0}>
        {insuranceItems.length > 0 && <Group label="Policies · પૉલિસી">{insuranceItems.map((m, i) => <Row key={i} {...m} />)}</Group>}
        {policyPlans.length > 0 && (
          <Group label="Paid regularly (Plan) · નિયમિત ચુકવણી">
            {policyPlans.map((p) => <Row key={p.id} kind="plan" title={p.name} sub={[p.day_of_month ? `Day ${p.day_of_month} of each month` : '', manyHouseholds ? p.household : ''].filter(Boolean).join(' · ')} meta={p.expected_amount ? money(p.expected_amount) : ''} />)}
          </Group>
        )}
        {dueRows.length > 0 && (
          <Group label="Money owed · બાકી રકમ">
            {dueRows.map((d) => <Row key={d.id} kind="contact" title={d.person} sub={d.balance > 0 ? 'Owes the household' : 'The household owes'} meta={money(Math.abs(d.balance))} />)}
          </Group>
        )}
      </Section>

      <Section id="papers" show={!!data.papers}><Text value={data.papers} /></Section>
      <Section id="access" show={!!data.access}><Text value={data.access} /></Section>
      <Section id="instructions" show={!!data.instructions}><Text value={data.instructions} /></Section>
    </article>
  )
}
