// Floating pill navigation on phones and tablets (owner, 12 Oct: pill shape, labels always visible, never
// hides) — the same pill as the customer pages (PublicNav). Tapping the current tab scrolls to the top.
// The module's + button sits above it on the right.
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
