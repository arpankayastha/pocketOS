import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BrandMark, ChevronDownIcon, CheckIcon, PlusIcon, SettingsIcon } from '../lib/icons'
import { MODULES } from '../lib/modules'

// Shared header: brand, module switcher, then the module's own tabs (`children`, desktop
// only; phones use the bottom nav) and actions (`right`).
export default function Topbar({ module, setModule, children, right }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
      <div className="brand"><BrandMark size={28} /><span className="brand-text">PocketOS</span></div>
      <ModuleSwitch module={module} setModule={setModule} />
      {children}
      <div className="topbar-right">{right}</div>
    </header>
  )
}

// Segmented pill with a highlight that slides to (and resizes with) the active module.
// On phones only the active module shows its label, so the buttons change width as you switch.
function ModuleSwitch({ module, setModule }) {
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
      {MODULES.map((m) => (
        <button key={m.id} className={m.id === module ? 'on' : ''} aria-current={m.id === module ? 'page' : undefined} onClick={() => setModule(m.id)}>
          <m.icon /><span className="module-label">{m.label}</span>
        </button>
      ))}
    </nav>
  )
}

// Household chip + dropdown menu.
export function HouseholdMenu({ households, activeId, onSelect, onCreate, onManage }) {
  const [open, setOpen] = useState(false)
  const active = households.find((h) => h.id === activeId)
  const pick = (fn) => () => { setOpen(false); fn() }

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="hh">
      <button className={`hh-chip ${open ? 'open' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="hh-dot" aria-hidden="true">{(active?.name || '?').slice(0, 1).toUpperCase()}</span>
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
                <span className="hh-dot" aria-hidden="true">{h.name.slice(0, 1).toUpperCase()}</span>
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
