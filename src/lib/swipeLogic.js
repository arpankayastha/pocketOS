// Pure rules for swipe rows (SwipeRow.jsx), tested in swipeLogic.test.mjs.
// `offset` > 0 means the row is dragged right (revealing the `left` actions on its left edge);
// `offset` < 0 means dragged left (revealing the `right` actions). An action with `full: true` fires on a long swipe.
export const ACTION_W = 78
const reveal = (actions) => actions.length * ACTION_W

// How far the row may be dragged: its actions plus a little give, or most of the width when a long swipe fires something.
export function clampOffset(x, left, right, width) {
  const limit = (a) => (a.length ? Math.max(reveal(a) + 28, a.some((x2) => x2.full) ? width * 0.8 : 0) : 0)
  return Math.max(-limit(right), Math.min(limit(left), x))
}

// Where the row ends up when the finger lifts: { fire: action } for a long swipe, else { open: 'left' | 'right' | null }.
export function settle({ offset, left, right, width }) {
  const side = offset > 0 ? left : offset < 0 ? right : []
  if (!side.length) return { open: null }
  const dist = Math.abs(offset)
  const full = side.find((a) => a.full)
  if (full && dist > width * 0.55) return { fire: full }
  return { open: dist > reveal(side) * 0.4 ? (offset > 0 ? 'left' : 'right') : null }
}

// The resting offset for an open side.
export const restingOffset = (open, left, right) => (open === 'left' ? reveal(left) : open === 'right' ? -reveal(right) : 0)
