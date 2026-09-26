import { buildWill, introText, attestationText, witnessText, printable } from '../../lib/willText'

// The will as an A4 document. Same markup for the on-screen preview and the printed PDF.
// Clauses are numbered continuously; tables and sub-headings aren't numbered.
export default function WillDocument({ doc, stamp }) {
  const g = doc.settings.gujaratiDigits
  const tx = (s) => printable(s, g)
  // Number the clauses continuously across sections (wishes use letters instead).
  let count = 0
  const sections = buildWill(doc).map((sec) => ({
    ...sec, items: sec.items.map((it) => (it.kind === 'para' && !it.key.startsWith('wish-') ? { ...it, num: ++count } : it)),
  }))
  return (
    <article className="will-doc" lang="gu">
      <header className="will-cover">
        <h1>વસિયતનામું</h1>
        <div className="will-sub">(છેલ્લું વસિયતનામું)</div>
        <div className="will-name">{doc.testator.name || '________________'}</div>
        {doc.testator.place && <div className="will-sub">સ્થળ: {tx(doc.testator.place)}</div>}
      </header>
      <p className="will-intro">{tx(introText(doc))}</p>

      {sections.map((sec) => (
        <section className="will-section" key={sec.key}>
          <h2>{sec.title}</h2>
          {sec.items.map((it, i) => {
            if (it.kind === 'sub') return <h3 key={i}>{it.text}</h3>
            if (it.kind === 'table') return (
              <table key={i}>
                <thead><tr>{it.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{it.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{tx(c)}</td>)}</tr>)}</tbody>
              </table>
            )
            return <p key={i} className="will-para">{it.num && <span className="will-num">{tx(`${it.num}.`)}</span>}{tx(it.text)}</p>
          })}
        </section>
      ))}

      <section className="will-sign">
        <p>{tx(attestationText(doc))}</p>
        <table className="sign-table">
          <tbody>
            <tr>
              <td><b>વસિયત કરનાર</b><br />{doc.testator.name}</td>
              <td className="sign-box">સહી</td>
            </tr>
          </tbody>
        </table>
        <p>{tx(witnessText(doc))}</p>
        <table className="sign-table">
          <tbody>
            {doc.witnesses.map((w, i) => (
              <tr key={i}>
                <td><b>સાક્ષી {tx(String(i + 1))}</b><br />નામ: {w.name || '______________________'}<br />સરનામું: {tx(w.address) || '______________________'}<br />તારીખ: ______________</td>
                <td className="sign-box">સહી</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="will-stamp">{tx(stamp)}</div>
    </article>
  )
}
