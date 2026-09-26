import { useRef } from 'react'
import { shiftMonth } from './format'

// Horizontal swipe detection for phones. Returns touch handlers to spread on a container.
// Ignores swipes that start in form fields, sliders, or open modals, and mostly-vertical drags (scrolling).
export function useSwipe({ onLeft, onRight, threshold = 60 }) {
  const start = useRef(null)
  return {
    onTouchStart(e) {
      const t = e.touches[0]
      const skip = e.target.closest('input, textarea, select, .modal-bg, .no-swipe')
      start.current = skip || e.touches.length > 1 ? null : { x: t.clientX, y: t.clientY }
    },
    onTouchEnd(e) {
      if (!start.current) return
      const t = e.changedTouches[0]
      const dx = t.clientX - start.current.x, dy = t.clientY - start.current.y
      start.current = null
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return
      if (dx < 0) onLeft?.(); else onRight?.()
    },
  }
}

// Swipe left → next month, swipe right → previous month (within min/max).
export function useMonthSwipe(month, setMonth, { min, max } = {}) {
  return useSwipe({
    onLeft: () => { if (!max || month < max) setMonth(shiftMonth(month, 1)) },
    onRight: () => { if (!min || month > min) setMonth(shiftMonth(month, -1)) },
  })
}
