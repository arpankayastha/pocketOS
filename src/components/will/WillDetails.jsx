import { GuInput } from './WillParts'

// Testator (Mummy), place of signing, funeral custom, witnesses, print settings.
export default function WillDetails({ doc, update }) {
  const t = doc.testator
  const setT = (k) => (v) => update((d) => ({ ...d, testator: { ...d.testator, [k]: v } }))
  const setW = (i, k) => (v) => update((d) => ({ ...d, witnesses: d.witnesses.map((w, j) => (j === i ? { ...w, [k]: v } : w)) }))

  return (
    <section className="grid2">
      <div className="card stack">
        <h3>વસિયત કરનાર · Person making the will</h3>
        <GuInput label="Full name" value={t.name} onChange={setT('name')} placeholder="પૂરું નામ (નામ, પિતા/પતિનું નામ, અટક)" />
        <div className="row2">
          <label>Relation
            <select value={t.spouseOrParentRelation} onChange={(e) => setT('spouseOrParentRelation')(e.target.value)}>
              <option value="પત્ની">wife of (પત્ની)</option><option value="પુત્રી">daughter of (પુત્રી)</option><option value="વિધવા">widow of (વિધવા)</option>
            </select>
          </label>
          <GuInput label="…of (name)" value={t.spouseOrParentName} onChange={setT('spouseOrParentName')} placeholder="નામ" />
        </div>
        <div className="row2">
          <GuInput label="Age (years)" value={t.age} onChange={setT('age')} inputMode="numeric" />
          <GuInput label="Religion" value={t.religion} onChange={setT('religion')} />
        </div>
        <GuInput label="Address" value={t.address} onChange={setT('address')} multiline />
        <GuInput label="Aadhaar number" value={t.aadhaar} onChange={setT('aadhaar')} inputMode="numeric" hint="Printed masked: only the last 4 digits." />
      </div>

      <div className="card stack">
        <h3>Signing</h3>
        <GuInput label="Place of signing (સ્થળ)" value={t.place} onChange={setT('place')} placeholder="શહેર" />
        <GuInput label="Funeral according to … customs" value={doc.funeral} onChange={(v) => update((d) => ({ ...d, funeral: v }))} hint="e.g. હિંદુ" />
        {doc.witnesses.map((w, i) => (
          <div className="stack witness-edit" key={i}>
            <div className="muted small caps">Witness {i + 1} (સાક્ષી)</div>
            <GuInput label="Name" value={w.name} onChange={setW(i, 'name')} />
            <GuInput label="Address" value={w.address} onChange={setW(i, 'address')} />
          </div>
        ))}
        <p className="muted small" style={{ margin: 0 }}>Witnesses must not be beneficiaries or their spouses. Leave blank to write names in by hand.</p>
        <label className="check">
          <input type="checkbox" checked={doc.settings.gujaratiDigits} onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, gujaratiDigits: e.target.checked } }))} />
          Use Gujarati digits (૧૨૩) in the PDF
        </label>
      </div>
    </section>
  )
}
