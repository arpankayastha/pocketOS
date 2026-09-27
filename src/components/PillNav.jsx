import { useEffect, useState } from 'react'

// Floating pill navigation for phones (One UI style): the active tab widens to show its label,
// the others are icon-only. Slides away while scrolling down, comes back on scroll up.
// `withFab` leaves room on the right for the module's floating + button.
export default function PillNav({ tabs, tab, setTab, withFab }) {
  const hidden = useHideOnScroll()
  return (
    <nav className={`pill-nav ${withFab ? 'with-fab' : ''} ${hidden ? 'hidden' : ''}`}>
      <div className="pill">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} aria-label={t.label} aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => { setTab(t.id); if (tab === t.id) window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
            <t.icon /><span className="pill-label">{t.short || t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

function useHideOnScroll() {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let last = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      if (Math.abs(y - last) < 8) return
      // Never hide near the top or bottom of the page, so the last row can always be reached.
      const atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 40
      setHidden(y > last && y > 80 && !atEnd)
      last = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return hidden
}
