// Bottom tab bar on phones (owner: the floating pill "looks too bad"): fixed, full width, every tab shows its
// icon and label, the current one in red — same as the customer pages (PublicNav). Tapping the current tab
// scrolls to the top. `withFab` lifts the module's + button above the bar.
export default function PillNav({ tabs, tab, setTab, withFab }) {
  return (
    <nav className={`pill-nav ${withFab ? 'with-fab' : ''}`} style={{ '--n': tabs.length }}>
      {tabs.map((t) => (
        <button key={t.id} className={tab === t.id ? 'active' : ''} aria-label={t.label} aria-current={tab === t.id ? 'page' : undefined}
          onClick={() => { setTab(t.id); if (tab === t.id) window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
          <t.icon /><span className="pill-label">{t.short || t.label}</span>
        </button>
      ))}
    </nav>
  )
}
