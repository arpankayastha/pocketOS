import { useId } from 'react'

// eChopdo logo: cards tucked into a stitched pocket (money + passwords in one place).
// Keep in sync with public/favicon.svg, public/icons/*.svg and the splash in index.html.
export function BrandMark({ size = 24 }) {
  const id = useId()
  const grad = `url(#${CSS.escape(id)})`
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="brand-mark">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="512" y2="512">
          <stop offset="0" stopColor="#818cf8" /><stop offset=".55" stopColor="#c084fc" /><stop offset="1" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill={grad} />
      <rect x="170" y="112" width="150" height="200" rx="18" fill="#0d0f14" opacity=".55" transform="rotate(-12 245 212)" />
      <rect x="206" y="126" width="150" height="200" rx="18" fill="#0d0f14" opacity=".8" transform="rotate(8 281 226)" />
      <path d="M124 236H388V336A68 68 0 0 1 320 404H192A68 68 0 0 1 124 336Z" fill="#fff" />
      <path d="M154 266H358" stroke={grad} strokeWidth="10" strokeLinecap="round" strokeDasharray="1 22" />
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

// ---- Vault item types ----
export function NoteIcon() {
  return <svg {...base}><path d="M5 3h10l4 4v14H5Z" /><path d="M15 3v4h4M8 11h8M8 15h8M8 19h5" /></svg>
}
export function ContactIcon() {
  return <svg {...base}><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M7 18c1-2.5 3-3.5 5-3.5s4 1 5 3.5" /></svg>
}
export function CardIcon() {
  return <svg {...base}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></svg>
}
export function BankIcon() {
  return <svg {...base}><path d="M3 10 12 4l9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18" /></svg>
}
export function CarIcon() {
  return <svg {...base}><path d="M5 17V12l2-5h10l2 5v5" /><path d="M3 12h18v5H3Z" /><circle cx="7.5" cy="17.5" r="1.5" /><circle cx="16.5" cy="17.5" r="1.5" /></svg>
}
export function PassportIcon() {
  return <svg {...base}><rect x="5" y="2" width="14" height="20" rx="2" /><circle cx="12" cy="10" r="3.5" /><path d="M8.5 10h7M12 6.5c-1.5 2-1.5 5 0 7M12 6.5c1.5 2 1.5 5 0 7M9 18h6" /></svg>
}
export function IdCardIcon() {
  return <svg {...base}><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M5 16c.6-1.5 1.7-2 3-2s2.4.5 3 2M14 10h5M14 14h4" /></svg>
}
export function HeartIcon() {
  return <svg {...base}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /><path d="M7 12h3l1-2 2 4 1-2h3" /></svg>
}
export function UmbrellaIcon() {
  return <svg {...base}><path d="M3 12a9 9 0 0 1 18 0Z" /><path d="M12 12v6a2 2 0 0 0 4 0M12 3v0" /></svg>
}
export function MemberIcon() {
  return <svg {...base}><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M5 16c.6-1.5 1.7-2 3-2s2.4.5 3 2M14 9h5M14 12h5M14 15h3" /></svg>
}
export function WifiIcon() {
  return <svg {...base}><path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" /><circle cx="12" cy="19" r="1" fill="currentColor" /></svg>
}
export function MailIcon() {
  return <svg {...base}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
}
export function ChatIcon() {
  return <svg {...base}><path d="M4 4h16v12H9l-5 4Z" /><path d="M8 9h8M8 12h5" /></svg>
}
export function DatabaseIcon() {
  return <svg {...base}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>
}
export function ServerIcon() {
  return <svg {...base}><rect x="3" y="3" width="18" height="8" rx="2" /><rect x="3" y="13" width="18" height="8" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" /></svg>
}
export function TerminalIcon() {
  return <svg {...base}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m6 9 4 3-4 3M12 15h6" /></svg>
}
export function LaptopIcon() {
  return <svg {...base}><rect x="4" y="4" width="16" height="11" rx="2" /><path d="M2 19h20l-2-4H4Z" /></svg>
}

export function WalletIcon() {
  return <svg {...base}><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M4 7l11-3v3" /><circle cx="16" cy="13.5" r="1.3" fill="currentColor" stroke="none" /></svg>
}

export function LockIcon() {
  return <svg {...base}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
}

export function ChevronDownIcon() {
  return <svg {...base} width={16} height={16}><path d="m6 9 6 6 6-6" /></svg>
}

export function CheckIcon() {
  return <svg {...base} width={16} height={16}><path d="m5 12 5 5L20 7" /></svg>
}

// ---- Will module ----
export function ScrollIcon() {
  return <svg {...base}><path d="M6 3h11a2 2 0 0 1 2 2v12" /><path d="M6 3a2 2 0 0 0-2 2v2h4" /><path d="M8 7v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2H12v2a2 2 0 0 1-2 2" /><path d="M11 8h5M11 12h5" /></svg>
}
export function UsersIcon() {
  return <svg {...base}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.8 3.1 2.6 3.5 5.2" /></svg>
}
export function HomeIcon() {
  return <svg {...base}><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>
}
export function PieIcon() {
  return <svg {...base}><path d="M12 3a9 9 0 1 0 9 9h-9Z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z" /></svg>
}
export function FileIcon() {
  return <svg {...base}><path d="M6 2h9l5 5v15H6Z" /><path d="M14 2v6h6M9 13h8M9 17h8" /></svg>
}
export function UserIcon() {
  return <svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6" /></svg>
}

// ---- Budget: Dues / Hisab ----
export function DuesIcon() {
  return <svg {...base}><path d="M4 8h14l-3-3M20 16H6l3 3" /></svg>
}
export function BookIcon() {
  return <svg {...base}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z" /><path d="M4 19V5M8 7h7M8 11h5" /></svg>
}
