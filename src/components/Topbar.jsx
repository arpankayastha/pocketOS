import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BrandMark, ChevronDownIcon, CheckIcon, PlusIcon, SettingsIcon } from '../lib/icons'
import { MODULES } from '../lib/modules'
import { householdColor } from '../lib/colors'

// Shared header: brand, module switcher (when the login has more than one module), then the
// module's own tabs (`children`, desktop only; phones use the bottom nav) and actions (`right`).
export default function Topbar({ module, setModule, modules = MODULES, children, right, title, onBack }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
      {/* Phones: a page that isn't a tab (Settings) shows ‹ back to where you were in place of the logo. */}
      {onBack && <button className="btn icon topbar-back" aria-label="Back" onClick={onBack}><ChevronLeft /></button>}
      <div className={`brand ${onBack ? 'has-back' : ''}`}><BrandMark size={28} /><span className="brand-text">GRANDXGAMER</span></div>
      {/* Phones: the page you're on, with its section above it (the tabs themselves are in the bottom bar). */}
      {title && <div className="topbar-title"><small>{modules.length > 1 ? (modules.find((m) => m.id === module) || modules[0])?.label : 'GRANDXGAMER'}</small><b>{title}</b></div>}
      {modules.length > 1 ? <ModuleSwitch module={module} setModule={setModule} modules={modules} /> : <div className="brand-member">GRANDXGAMER</div>}
      {/* On laptops the pages sit under a heading with the section's name (sidebar); elsewhere this wrapper is invisible. */}
      <div className="topbar-pages" data-title={(modules.find((m) => m.id === module) || modules[0])?.label}>{children}</div>
      <div className="topbar-right">{right}</div>
    </header>
  )
}

// Segmented pill with a highlight that slides to (and resizes with) the active module.
// On phones only the active module shows its label, so the buttons change width as you switch.
function ModuleSwitch({ module, setModule, modules }) {
  const navRef = useRef(null)
  const [thumb, setThumb] = useState(null) // { left, width } of the active button

  useLayoutEffect(() => {
    const nav = navRef.current
    const measure = () => {
      const el = nav.querySelector('button.on')
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    // Follow the label's width animation and any viewport change.
    const ro = new ResizeObserver(measure)
    nav.querySelectorAll('button').forEach((b) => ro.observe(b))
    return () => ro.disconnect()
  }, [module])

  return (
    <nav className="module-switch" aria-label="Module" ref={navRef}>
      {thumb && <span className="module-thumb" aria-hidden="true" style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} />}
      {modules.map((m) => (
        <button key={m.id} className={m.id === module ? 'on' : ''} aria-current={m.id === module ? 'page' : undefined} onClick={() => setModule(m.id)}>
          <m.icon /><span className="module-label">{m.label}</span>
        </button>
      ))}
    </nav>
  )
}

// Household chip + dropdown menu.
export function HouseholdMenu({ households, activeId, onSelect, onCreate, onManage, member }) {
  const [open, setOpen] = useState(false)
  const active = households.find((h) => h.id === activeId)
  const pick = (fn) => () => { setOpen(false); fn() }

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // A household member has exactly one household: a plain label, no menu.
  if (member) return (
    <div className="hh">
      <span className="hh-chip static">
        <span className="hh-dot" aria-hidden="true" style={{ '--c': householdColor(active, households) }}>{(active?.name || '?').slice(0, 1).toUpperCase()}</span>
        <span className="hh-name">{active?.name || 'Household'}</span>
      </span>
    </div>
  )

  return (
    <div className="hh">
      <button className={`hh-chip ${open ? 'open' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="hh-dot" aria-hidden="true" style={{ '--c': householdColor(active, households) }}>{(active?.name || '?').slice(0, 1).toUpperCase()}</span>
        <span className="hh-name">{active?.name || 'Household'}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <>
          <div className="hh-backdrop" onClick={() => setOpen(false)} />
          <div className="hh-menu" role="menu">
            <div className="hh-title">Households</div>
            {households.map((h) => (
              <button key={h.id} role="menuitemradio" aria-checked={h.id === activeId} className={h.id === activeId ? 'on' : ''} onClick={pick(() => onSelect(h.id))}>
                <span className="hh-dot" aria-hidden="true" style={{ '--c': householdColor(h, households) }}>{h.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow ellipsis">{h.name}</span>
                {h.id === activeId && <CheckIcon />}
              </button>
            ))}
            <div className="hh-sep" />
            <button role="menuitem" onClick={pick(onCreate)}><span className="hh-icon"><PlusIcon /></span>New household…</button>
            <button role="menuitem" onClick={pick(onManage)}><span className="hh-icon"><SettingsIcon /></span>Manage households</button>
          </div>
        </>
      )}
    </div>
  )
}

function ChevronLeft() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
}
