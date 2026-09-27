import { WalletIcon, VaultIcon, ScrollIcon } from './icons'

// PocketOS modules, in switcher order.
export const MODULES = [
  { id: 'budget', label: 'Budget', icon: WalletIcon },
  { id: 'vault', label: 'Vault', icon: VaultIcon },
]

// Hidden module: not in the switcher. Opened by pressing and holding the PocketOS logo,
// then confirming with a fingerprint. Shown in the switcher only while it's open.
export const HIDDEN_WILL = { id: 'will', label: 'Will', icon: ScrollIcon }
