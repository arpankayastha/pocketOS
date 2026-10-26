// Splitting one payment across categories (no imports, so plain node can test it: `npm run test:split`).
// Amounts are compared in paise so 0.1 + 0.2 never leaves a stray 0.00000000000000004 "left to place".
export const paise = (n) => Math.round((Number(n) || 0) * 100)

// How the split stands against the total on the bill.
export function splitStatus(total, rows) {
  const placed = rows.reduce((s, r) => s + paise(r.amount), 0)
  const left = (paise(total) - placed) / 100
  const complete = rows.length >= 2 && rows.every((r) => r.category && paise(r.amount) > 0)
  return { left, placed: placed / 100, ok: left === 0 && complete }
}

// Two rows to start from: the picked category (or the first one) with the whole amount, and the next category empty.
export function startRows(total, categoryNames, preferred) {
  const names = categoryNames.length ? categoryNames : ['Other']
  const first = preferred && names.includes(preferred) ? preferred : names[0]
  const second = names.find((n) => n !== first) || first
  return [{ category: first, amount: total }, { category: second, amount: '' }]
}

// A row added later: the next category not used yet, holding whatever is still left to place.
export function addRow(rows, categoryNames, left) {
  const used = new Set(rows.map((r) => r.category))
  const next = categoryNames.find((n) => !used.has(n)) || categoryNames[0] || 'Other'
  return [...rows, { category: next, amount: left > 0 ? left : '' }]
}

// Rows that ended up in the same category become one entry.
export function mergeSameCategory(rows) {
  const out = []
  for (const r of rows) {
    const hit = out.find((x) => x.category === r.category)
    if (hit) hit.amount = (paise(hit.amount) + paise(r.amount)) / 100
    else out.push({ category: r.category, amount: paise(r.amount) / 100 })
  }
  return out
}
