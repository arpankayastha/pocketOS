// Phones: every popup (.modal-bg > .modal) is a bottom sheet. Dragging its top edge (the
// grab handle area) down far enough closes it, the same as tapping outside: we dispatch a
// mousedown on the backdrop, which every modal and dialog already treats as "close".
const HANDLE_ZONE = 44 // px from the top of the sheet where a drag can start
const CLOSE_AFTER = 90 // px dragged down

export function installSheetDrag() {
  let drag = null
  const phone = () => window.matchMedia('(max-width: 800px)').matches

  document.addEventListener('touchstart', (e) => {
    if (!phone() || e.touches.length !== 1) return
    const sheet = e.target.closest('.modal-bg > .modal')
    if (!sheet || sheet.classList.contains('sheet')) return // full-height pickers don't drag
    const y = e.touches[0].clientY
    if (y - sheet.getBoundingClientRect().top > HANDLE_ZONE) return
    drag = { sheet, y0: y, dy: 0 }
    sheet.style.transition = 'none'
  }, { passive: true })

  document.addEventListener('touchmove', (e) => {
    if (!drag) return
    drag.dy = Math.max(0, e.touches[0].clientY - drag.y0)
    drag.sheet.style.transform = `translateY(${drag.dy}px)`
  }, { passive: true })

  const end = () => {
    if (!drag) return
    const { sheet, dy } = drag
    drag = null
    sheet.style.transition = 'transform .2s ease-out'
    if (dy > CLOSE_AFTER) {
      sheet.style.transform = 'translateY(100%)'
      setTimeout(() => sheet.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), 150)
    } else {
      sheet.style.transform = ''
    }
  }
  document.addEventListener('touchend', end)
  document.addEventListener('touchcancel', end)
}
