// Indian-style grouping for money fields (65,00,000). No imports, so plain node can test it.
const GROUP = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export const cleanAmount = (text) => {
  const t = String(text ?? '').replace(/[^\d.]/g, '')
  const dot = t.indexOf('.')
  if (dot === -1) return t.replace(/^0+(?=\d)/, '')
  return `${t.slice(0, dot).replace(/^0+(?=\d)/, '') || '0'}.${t.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`
}

export const showAmount = (raw) => {
  const v = cleanAmount(raw)
  if (v === '') return ''
  const dot = v.indexOf('.')
  const int = dot === -1 ? v : v.slice(0, dot)
  return (int === '' ? '0' : GROUP.format(Number(int))) + (dot === -1 ? '' : `.${v.slice(dot + 1)}`)
}

// Groups every number inside a calculator expression: "65000+1200.5" → "65,000+1,200.5".
export const groupExpr = (expr) => String(expr).replace(/(\d+)(\.\d*)?/g, (_m, int, dec) => GROUP.format(Number(int)) + (dec || ''))
