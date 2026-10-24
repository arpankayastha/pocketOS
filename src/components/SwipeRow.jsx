import { useEffect, useRef, useState } from 'react'
import { clampOffset, restingOffset, settle } from '../lib/swipeLogic'

// A row (or card) you can swipe for quick actions — one component for every list in the app.
//   left  = actions revealed by swiping RIGHT, right = actions revealed by swiping LEFT
//   action = { key, label, icon?, tone?: 'pos' | 'neg' | 'accent' | 'warn', run, full? }  (`full`: a long swipe fires it)
// Vertical scrolling is untouched (touch-action: pan-y). The row carries `no-swipe`, so the page-level swipes
// (change month, switch segment) ignore gestures that start on it. Falsy entries are skipped, so callers can write `cond && action`.
// Anything that must not be one tap away (deleting money) should still ask first, inside `run`.
export default function SwipeRow({ left = [], right = [], children, className = '' }) {
  const root = useRef(null)
  const gesture = useRef(null)
  const current = useRef(0)
  const moved = useRef(false)
  const [offset, setOffsetState] = useState(0)
  const [dragging, setDragging] = useState(false)
  const L = left.filter(Boolean)
  const R = right.filter(Boolean)
  const none = !L.length && !R.length
  const isOpen = offset !== 0 && !dragging

  const setOffset = (x) => { current.current = x; setOffsetState(x) }

  // Tapping anywhere else closes an open row.
  useEffect(() => {
    if (!isOpen) return
    const away = (e) => { if (!root.current?.contains(e.target)) setOffset(0) }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [isOpen])

  const onTouchStart = (e) => {
    if (none || e.touches.length !== 1) { gesture.current = null; return }
    const t = e.touches[0]
    gesture.current = { x: t.clientX, y: t.clientY, base: current.current, lock: null, width: root.current.offsetWidth }
    moved.current = false
  }
  const onTouchMove = (e) => {
    const g = gesture.current
    if (!g) return
    const t = e.touches[0]
    const dx = t.clientX - g.x, dy = t.clientY - g.y
    if (!g.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      g.lock = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y' // mostly sideways = a swipe; otherwise it's scrolling
      if (g.lock === 'x') setDragging(true)
    }
    if (g.lock !== 'x') return
    moved.current = true
    setOffset(clampOffset(g.base + dx, L, R, g.width))
  }
  const onTouchEnd = () => {
    const g = gesture.current
    gesture.current = null
    if (!g || g.lock !== 'x') return
    setDragging(false)
    setTimeout(() => { moved.current = false }, 350) // the click a browser sends right after a drag is swallowed; later clicks must work
    const r = settle({ offset: current.current, left: L, right: R, width: g.width })
    if (r.fire) { setOffset(0); r.fire.run() } else setOffset(restingOffset(r.open, L, R))
  }
  // A tap on an open row only closes it; a drag never counts as a tap on whatever is inside.
  const onClickCapture = (e) => {
    if (current.current !== 0 || moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; if (current.current !== 0) setOffset(0) }
  }

  const act = (a) => () => { setOffset(0); a.run() }
  const under = (actions, side) => (
    <div className={`sw-under sw-${side}`} style={{ width: Math.abs(offset), visibility: (side === 'l' ? offset > 0 : offset < 0) ? 'visible' : 'hidden' }}>
      {actions.map((a) => (
        <button key={a.key} type="button" className={`sw-act ${a.tone || ''}`} onClick={act(a)}>
          {a.icon}<span>{a.label}</span>
        </button>
      ))}
    </div>
  )

  if (none) return children
  return (
    <div ref={root} className={`sw no-swipe ${className}`}>
      {L.length > 0 && under(L, 'l')}
      {R.length > 0 && under(R, 'r')}
      <div className={`sw-top ${dragging ? 'drag' : ''}`} style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd} onClickCapture={onClickCapture}>
        {children}
      </div>
    </div>
  )
}
