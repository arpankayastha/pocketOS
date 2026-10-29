import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useDialog } from '../../lib/dialog'
import { uploadShopImage } from '../../lib/media'
import { CATEGORIES, categoryLabel, specLines } from '../../lib/products'
import { Collapsible } from '../Settings'
import { Chips, Sheet, SheetActions } from './ui'

// ⚙ → Products for sale (admin): the PC parts listed on the home page (owner, 29 Oct). One row per product →
// tap to edit (picture, category, brand, name, key specs, in stock, shown on the site) or remove.
export default function ProductsAdmin({ shop, householdId, toast }) {
  const [rows, setRows] = useState(null)
  const [edit, setEdit] = useState(null) // product or {} for new
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('shop_products').select('*').eq('household_id', householdId).order('category').order('sort').order('created_at')
    if (error) toast(error.message); else setRows(data)
  }, [householdId, toast])
  useEffect(() => { load() }, [load])
  const live = (rows || []).filter((p) => p.active).length
  return (
    <Collapsible id="gx-products" title="Products for sale" summary={rows ? `${live} on the home page${rows.length > live ? ` · ${rows.length - live} hidden` : ''}` : '…'}
      action={<button className="btn small primary" onClick={() => setEdit({})}>+ Add</button>}>
      <p className="muted small" style={{ marginTop: 0 }}>PC parts customers see on the home page under <b>PC parts for sale</b>, with <b>Call for price</b> and WhatsApp buttons to the contact number in Home page.</p>
      {!shop.settings?.contact_phone && <div className="small neg">Add the contact number in Home page so customers can call for the price.</div>}
      {rows === null ? <div className="muted small">Loading…</div> : rows.length === 0 ? <div className="muted small">No products yet. Tap + Add.</div> : (
        <div className="gx-details">{rows.map((p) => (
          <button key={p.id} type="button" className="line gx-linebtn" onClick={() => setEdit(p)}>
            <span>{p.brand} {p.name}<span className="muted small"> · {categoryLabel(p.category)}{p.in_stock ? '' : ' · on order'}{p.active ? '' : ' · hidden'}</span></span>
            <b>›</b>
          </button>
        ))}</div>
      )}
      {edit && <ProductSheet product={edit} householdId={householdId} onClose={() => setEdit(null)} onDone={(m) => { setEdit(null); toast(m); load() }} />}
    </Collapsible>
  )
}

function ProductSheet({ product, householdId, onClose, onDone }) {
  const dialog = useDialog()
  const isNew = !product.id
  const [v, setV] = useState({ category: product.category || 'cpu', brand: product.brand || '', name: product.name || '', specs: product.specs || '',
    image_url: product.image_url || null, in_stock: product.in_stock ?? true, active: product.active ?? true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setError(null)
    try { setV({ ...v, image_url: await uploadShopImage(householdId, file, 'product', 900, '#ffffff') }) } catch (err) { setError(err.message) }
    setBusy(false)
  }
  async function save() {
    if (!v.brand.trim() || v.name.trim().length < 2) { setError('Add the brand and the product name.'); return }
    setBusy(true); setError(null)
    const row = { ...v, brand: v.brand.trim(), name: v.name.trim(), specs: specLines(v.specs).join('\n') || null, updated_at: new Date().toISOString() }
    const { error } = isNew ? await supabase.from('shop_products').insert({ ...row, household_id: householdId })
      : await supabase.from('shop_products').update(row).eq('id', product.id)
    setBusy(false)
    if (error) setError(error.message); else onDone(isNew ? `${row.name} added` : `${row.name} saved`)
  }
  async function remove() {
    if (!await dialog.confirm({ title: `Remove ${product.name}?`, message: 'It disappears from the home page. To hide it for a while, untick “Show on the home page” instead.', confirmLabel: 'Remove', danger: true })) return
    const { error } = await supabase.from('shop_products').delete().eq('id', product.id)
    if (error) setError(error.message); else onDone(`${product.name} removed`)
  }
  return (
    <Sheet title={isNew ? 'Add a product' : 'Edit product'} sub="Shown on the home page · price on call" onClose={onClose} onSubmit={save}>
      {error && <div className="alert error">{error}</div>}
      <div className="gx-prod-pic">
        {v.image_url ? <img src={v.image_url} alt="" /> : <span className="muted small">No picture</span>}
        <label className={`btn small ${busy ? 'disabled' : ''}`}>{busy ? 'Uploading…' : v.image_url ? 'Change picture' : 'Add picture'}<input type="file" accept="image/*" hidden onChange={pick} disabled={busy} /></label>
      </div>
      <div className="caps muted">Category</div>
      <Chips scroll options={CATEGORIES} value={v.category} onChange={(c) => setV({ ...v, category: c })} />
      <label>Brand<input value={v.brand} onChange={set('brand')} placeholder="MSI, ASUS, AMD, Intel…" maxLength={40} /></label>
      <label>Product name<input value={v.name} onChange={set('name')} placeholder="e.g. GeForce RTX 4060 Ventus 2X 8G" maxLength={120} /></label>
      <label>Key specs · one per line<textarea rows={4} value={v.specs} onChange={set('specs')} placeholder={'8 GB GDDR6\nPCIe 4.0\n3 years warranty'} /></label>
      <label className="check"><input type="checkbox" checked={v.in_stock} onChange={(e) => setV({ ...v, in_stock: e.target.checked })} /> In stock (else shows “On order”)</label>
      <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Show on the home page</label>
      <SheetActions onClose={onClose} busy={busy} label={isNew ? 'Add product' : 'Save'} />
      {!isNew && <button type="button" className="btn link" style={{ justifySelf: 'start', color: 'var(--neg)' }} onClick={remove}>Remove product</button>}
    </Sheet>
  )
}
