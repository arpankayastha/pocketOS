export function BrandMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="brand-mark">
      <defs>
        <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#818cf8" /><stop offset="55%" stopColor="#c084fc" /><stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#brandGrad)" />
      <text x="256" y="350" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="800" fontSize="280" fill="#fff">P</text>
    </svg>
  )
}

const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

export function DashboardIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="8" height="10" rx="2" /><rect x="13" y="3" width="8" height="6" rx="2" />
      <rect x="13" y="11" width="8" height="10" rx="2" /><rect x="3" y="15" width="8" height="6" rx="2" />
    </svg>
  )
}

export function ListIcon() {
  return (
    <svg {...base}>
      <path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function BudgetIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 9 9h-9z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.3l.06.06A1.65 1.65 0 0 0 8.92 4.7h.09A1.65 1.65 0 0 0 10 3.2V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.3 9c.14.36.4.66.7.85.3.2.66.31 1.03.31H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function PencilIcon() {
  return (
    <svg {...base}>
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg {...base}>
      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}

export function PasskeyIcon() {
  return (
    <svg {...base}>
      <circle cx="9" cy="7" r="4" />
      <path d="M9 11c-3 0-6 1.5-6 4v2h7" />
      <path d="M15 15l2 2 4-4" />
    </svg>
  )
}
