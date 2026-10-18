import { WalletIcon, VaultIcon, ScrollIcon, FolderIcon } from './icons'

// eChopdo modules, in switcher order.
export const MODULES = [
  { id: 'budget', label: 'Budget', icon: WalletIcon },
  { id: 'vault', label: 'Vault', icon: VaultIcon },
  { id: 'docs', label: 'Docs', icon: FolderIcon },
]

// Hidden module: not in the switcher. Opened by pressing and holding the eChopdo logo,
// then confirming with a fingerprint. Shown in the switcher only while it's open.
export const HIDDEN_WILL = { id: 'will', label: 'Will', icon: ScrollIcon }
