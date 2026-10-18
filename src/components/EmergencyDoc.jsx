import { SECTIONS, TITLE, describe, looksLikePolicyOrLoan, reviewState } from '../lib/emergency'
import { money } from '../lib/format'

function Section({ id, show, children }) {
  return show && (
    <section className="emg-section">
      <h2>{SECTIONS[id].en} <span lang="gu">· {SECTIONS[id].gu}</span></h2>
      {children}
    </section>
  )
}
const Lines = ({ list }) => list.map((x, i) => <li key={i}><b>{x.title}</b>{x.lines.map((l, k) => <div key={k} className="emg-line">{l}</div>)}</li>)
const Text = ({ value }) => (value ? <p className="emg-text">{value}</p> : null)

// The sheet itself, in English and Gujarati. Used on screen and for the printed / PDF copy.
// `live` = { accounts, plan, dues } read from Budget; `linked` = the Vault items the sheet links.
export default function EmergencyDoc({ data, linked, live, print = false }) {
  const byType = (sec) => linked.filter((i) => ({ bank: 'money', health: 'insurance', insurance: 'insurance', contact: 'people' })[i.type] === sec)
  const policyPlans = (live?.plan || []).filter(looksLikePolicyOrLoan)
  const review = reviewState(data.reviewedAt)
  const people = data.people.filter((p) => p.name || p.phone)
  const contacts = byType('people')

  const moneyItems = byType('money').map(describe)
  const accountRows = (live?.accounts || [])
  const insuranceItems = byType('insurance').map(describe)
  const dueRows = live?.dues || []

  return (
    <article className={`emg-doc ${print ? 'print' : ''}`}>
      <header>
        <h1>{TITLE.en}</h1>
        <div className="emg-gu" lang="gu">{TITLE.gu}</div>
        {print && <div className="emg-stamp">{review.text}</div>}
      </header>

      <Section id="people" show={people.length > 0 || contacts.length > 0}>
        <ul>
            {people.map((p) => (
              <li key={p.id}><b>{p.name}</b>{p.relation && <span> ({p.relation})</span>}{p.phone && <span> · {p.phone}</span>}{p.note && <div className="emg-line">{p.note}</div>}</li>
            ))}
            <Lines list={contacts.map(describe)} />
          </ul>
      </Section>

      <Section id="money" show={moneyItems.length > 0 || accountRows.length > 0}>
          <ul>
            <Lines list={moneyItems} />
            {accountRows.map((a) => <li key={a.id}><b>{a.bank || a.name}</b><div className="emg-line">{[a.type === 'card' ? 'Credit card' : a.name, a.digits?.length ? `••${a.digits[0]}` : ''].filter(Boolean).join(' · ')}{live.households?.length > 1 && a.household ? ` · ${a.household}` : ''}</div></li>)}
          </ul>
      </Section>

      <Section id="insurance" show={insuranceItems.length > 0 || policyPlans.length > 0 || dueRows.length > 0}>
          <ul>
            <Lines list={insuranceItems} />
            {policyPlans.map((p) => <li key={p.id}><b>{p.name}</b><div className="emg-line">{[p.expected_amount ? money(p.expected_amount) : '', p.day_of_month ? `on day ${p.day_of_month} each month` : '', p.household].filter(Boolean).join(' · ')}</div></li>)}
            {dueRows.map((d) => <li key={d.id}><b>{d.person}</b><div className="emg-line">{d.balance > 0 ? `Owes the household ${money(d.balance)}` : `The household owes ${money(-d.balance)}`}</div></li>)}
          </ul>
      </Section>

      <Section id="papers" show={!!data.papers}><Text value={data.papers} /></Section>
      <Section id="access" show={!!data.access}><Text value={data.access} /></Section>
      <Section id="instructions" show={!!data.instructions}><Text value={data.instructions} /></Section>
    </article>
  )
}
