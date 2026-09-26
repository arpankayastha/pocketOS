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

export function PlanIcon() {
  return (
    <svg {...base}>
      <path d="M3 17l5-5 4 4 8-8" /><path d="M15 8h5v5" />
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

export function VaultIcon() {
  return (
    <svg {...base}>
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function FingerprintIcon() {
  return (
    <svg {...base}>
      <path d="M12 11v3a8 8 0 0 1-1.5 4.7" /><path d="M8.5 12a3.5 3.5 0 0 1 7 0v1.5a12 12 0 0 1-.7 4" />
      <path d="M5.2 15.5A11 11 0 0 0 5.5 12a6.5 6.5 0 0 1 11.3-4.4" /><path d="M18.4 11a6 6 0 0 1 .1 1v1.5c0 2-.3 3.9-.9 5.6" />
      <path d="M3.5 9a9.5 9.5 0 0 1 14-4.6" />
    </svg>
  )
}

export function KeyIcon() {
  return (
    <svg {...base}>
      <circle cx="7.5" cy="15.5" r="4.5" /><path d="M10.7 12.3 20 3" /><path d="M16 7l3 3" /><path d="M14 9l2 2" />
    </svg>
  )
}

export function DiceIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" /><circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8" cy="16" r="1.3" fill="currentColor" stroke="none" /><circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ShieldIcon() {
  return (
    <svg {...base}>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z" /><path d="m9 12 2 2 4-4" />
    </svg>
  )
}

export function CopyIcon() {
  return (
    <svg {...base}>
      <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  )
}

export function EyeIcon({ off }) {
  return (
    <svg {...base}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  )
}
