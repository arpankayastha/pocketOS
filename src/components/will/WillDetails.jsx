import { GuInput, Help } from './WillParts'

// Testator (the person making the will), place of signing, funeral custom, witnesses, print settings.
// Labels are Gujarati first with a plain-language explanation, so the will-maker can follow along.
export default function WillDetails({ doc, update, onImport }) {
  const t = doc.testator
  const setT = (k) => (v) => update((d) => ({ ...d, testator: { ...d.testator, [k]: v } }))
  const setW = (i, k) => (v) => update((d) => ({ ...d, witnesses: d.witnesses.map((w, j) => (j === i ? { ...w, [k]: v } : w)) }))
  const empty = !t.name && !doc.people.length && !doc.assets.length

  return (
    <section>
      {empty && (
        <div className="card import-card">
          <div className="grow">
            <h3 style={{ margin: 0 }}>જૂના વસિયતનામાની વિગત લાવો · Start from a file</h3>
            <Help>જો તમારી પાસે વસિયતનામાની તૈયાર ફાઇલ (.json) હોય, તો તે અહીંથી લાવી શકો છો. પછી બધું અહીં બદલી શકાશે.</Help>
          </div>
          <button className="btn primary" onClick={onImport}>ફાઇલ પસંદ કરો · Import</button>
        </div>
      )}
      <div className="grid2">
        <div className="card stack">
          <h3>વસિયત કરનાર · Person making the will</h3>
          <Help>જે વ્યક્તિ પોતાની મિલકત કોને આપવી તે નક્કી કરે છે, તેમની વિગત.</Help>
          <GuInput label="પૂરું નામ · Full name" value={t.name} onChange={setT('name')} placeholder="નામ, પિતા/પતિનું નામ, અટક" />
          <div className="row2">
            <label>સંબંધ · Relation
              <select value={t.spouseOrParentRelation} onChange={(e) => setT('spouseOrParentRelation')(e.target.value)}>
                <option value="પત્ની">પત્ની (wife of)</option><option value="પુત્રી">પુત્રી (daughter of)</option><option value="વિધવા">વિધવા (widow of)</option>
              </select>
            </label>
            <GuInput label="પતિ / પિતાનું નામ" value={t.spouseOrParentName} onChange={setT('spouseOrParentName')} placeholder="નામ" />
          </div>
          <div className="row2">
            <GuInput label="ઉંમર (વર્ષ) · Age" value={t.age} onChange={setT('age')} inputMode="numeric" />
            <GuInput label="ધર્મ · Religion" value={t.religion} onChange={setT('religion')} hint="કયો વારસા કાયદો લાગુ પડે તે ધર્મ પરથી નક્કી થાય છે." />
          </div>
          <GuInput label="સરનામું · Address" value={t.address} onChange={setT('address')} multiline />
          <GuInput label="આધાર નંબર · Aadhaar" value={t.aadhaar} onChange={setT('aadhaar')} inputMode="numeric" hint="PDFમાં ફક્ત છેલ્લા ૪ આંકડા જ છપાશે." />
        </div>

        <div className="card stack">
          <h3>સહી અને સાક્ષી · Signing</h3>
          <GuInput label="સહી કરવાનું સ્થળ · Place" value={t.place} onChange={setT('place')} placeholder="શહેર" hint="જે શહેરમાં વસિયતનામા પર સહી થશે." />
          <GuInput label="અંતિમવિધિ કયા રીતરિવાજ મુજબ · Funeral customs" value={doc.funeral} onChange={(v) => update((d) => ({ ...d, funeral: v }))} hint="દા.ત. હિંદુ" />
          <Help>સહી વખતે બે સાક્ષી જરૂરી છે. સાક્ષી કુટુંબની બહારની વ્યક્તિ હોવી જોઈએ — જેને આ વસિયતનામામાંથી કંઈ મળતું હોય તે (કે તેમના પતિ/પત્ની) સાક્ષી ન બની શકે.</Help>
          {doc.witnesses.map((w, i) => (
            <div className="stack witness-edit" key={i}>
              <div className="muted small caps">સાક્ષી {i + 1} · Witness {i + 1}</div>
              <GuInput label="નામ · Name" value={w.name} onChange={setW(i, 'name')} />
              <GuInput label="સરનામું · Address" value={w.address} onChange={setW(i, 'address')} hint="ખાલી રાખો તો સહી વખતે હાથે લખી શકાય." />
            </div>
          ))}
          <label className="check">
            <input type="checkbox" checked={doc.settings.gujaratiDigits} onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, gujaratiDigits: e.target.checked } }))} />
            PDFમાં ગુજરાતી આંકડા (૧૨૩) વાપરો
          </label>
        </div>
      </div>
    </section>
  )
}
