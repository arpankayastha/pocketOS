import { WalletIcon, VaultIcon, ScrollIcon, ListIcon } from './icons'

// eChopdo modules, in switcher order.
export const MODULES = [
  { id: 'budget', label: 'Budget', icon: WalletIcon },
  { id: 'vault', label: 'Vault', icon: VaultIcon },
  { id: 'lists', label: 'Lists', icon: ListIcon },
]

// A household member's login has no Vault unless the owner turns it on; Lists they always have.
export const memberModules = (vaultOn) => MODULES.filter((m) => m.id !== 'vault' || vaultOn)

// Hidden module: not in the switcher. Opened by pressing and holding the eChopdo logo,
// then confirming with a fingerprint. Shown in the switcher only while it's open.
export const HIDDEN_WILL = { id: 'will', label: 'Will', icon: ScrollIcon }
