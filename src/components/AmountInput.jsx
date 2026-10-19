import { useLayoutEffect, useRef } from 'react'
import { cleanAmount, showAmount } from '../lib/amount'

// A money field that groups digits as you type, the Indian way (65,00,000), so zeros can be counted. The value it
// reports is the plain number ("6500000.5"); `onChange` gets an event-like { target: { value } } so existing
// form handlers keep working. Pass `min` to refuse smaller amounts; other attributes go to the <input>.

export default function AmountInput({ value, onChange, min, step: _step, type: _type, inputMode: _mode, ...rest }) {
  const ref = useRef(null)
  const caret = useRef(null) // digits before the caret, restored after the text is regrouped
  const shown = showAmount(value)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (caret.current !== null && document.activeElement === el) {
      let n = caret.current, pos = 0
      while (pos < shown.length && n > 0) { if (/[\d.]/.test(shown[pos])) n--; pos++ }
      el.setSelectionRange(pos, pos)
    }
    caret.current = null
    const num = Number(cleanAmount(value))
    el.setCustomValidity(min !== undefined && cleanAmount(value) !== '' && num < Number(min) ? `Enter an amount of at least ${min}.` : '')
  })

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onChange={(e) => {
        const text = e.target.value
        const at = e.target.selectionStart ?? text.length
        caret.current = text.slice(0, at).replace(/[^\d.]/g, '').length
        onChange?.({ target: { value: cleanAmount(text), type: 'text' } })
      }}
    />
  )
}
