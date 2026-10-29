import { useState } from 'react'
import { CATEGORIES, categoryLabel, specLines, telLink, waLink } from '../lib/products'

// "PC parts for sale" on the public home page (owner, 29 Oct: like the product pages on MSI and other brand
// sites — a picture, the name, the key specs — with a call button for the price). Category chips filter;
// the first 8 show, then "Show all".
export default function Products({ products, phone }) {
  const cats = CATEGORIES.filter(([k]) => products.some((p) => p.category === k))
  const [cat, setCat] = useState('all')
  const [all, setAll] = useState(false)
  if (products.length === 0) return null
  const list = cat === 'all' ? products : products.filter((p) => p.category === cat)
  const shown = all ? list : list.slice(0, 8)
  return (
    <section className="home-section" id="products">
      <div className="home-prod-head">
        <h2>PC parts for sale</h2>
        <span className="muted small">Genuine main components · call us for today’s best price</span>
      </div>
      {cats.length > 1 && (
        <div className="chips gx-scroll home-prod-cats">
          {[['all', 'All'], ...cats].map(([k, label]) => (
            <button key={k} type="button" className={`chip chip-btn ${cat === k ? 'on' : ''}`} onClick={() => { setCat(k); setAll(false) }}>{label}</button>
          ))}
        </div>
      )}
      <div className="home-prods">{shown.map((p) => <ProductCard key={p.id} p={p} phone={phone} />)}</div>
      {list.length > shown.length && <button className="btn block" onClick={() => setAll(true)}>Show all {list.length}</button>}
    </section>
  )
}

function ProductCard({ p, phone }) {
  const specs = specLines(p.specs).slice(0, 4)
  return (
    <article className="card home-prod">
      <div className="home-prod-img">
        {p.image_url ? <img src={p.image_url} alt={p.name} loading="lazy" /> : <span>{p.brand}</span>}
        <em className={p.in_stock ? 'in' : 'out'}>{p.in_stock ? 'In stock' : 'On order'}</em>
      </div>
      <div className="home-prod-body">
        <span className="home-prod-brand">{p.brand} · {categoryLabel(p.category)}</span>
        <b className="home-prod-name">{p.name}</b>
        {specs.length > 0 && <ul className="home-prod-specs">{specs.map((s) => <li key={s}>{s}</li>)}</ul>}
        <div className="home-prod-cta">
          {phone ? (<>
            <a className="btn primary small" href={telLink(phone)}>Call for price</a>
            <a className="btn small" href={waLink(phone, `Hi GRANDXGAMER, what's the price of ${p.brand} ${p.name}?`)} target="_blank" rel="noreferrer">WhatsApp</a>
          </>) : <span className="muted small">Ask at the counter for the price</span>}
        </div>
      </div>
    </article>
  )
}
