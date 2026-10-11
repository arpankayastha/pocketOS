import { WalletIcon, VaultIcon, GamepadIcon } from './icons'

// GRANDXGAMER modules, in switcher order. Shop is the café (floor, staff, events, cash); Money is
// eChopdo's Budget module for the admin only; Vault is shared passwords.
export const SHOP = { id: 'shop', label: 'Shop', icon: GamepadIcon }
export const MONEY = { id: 'budget', label: 'Money', icon: WalletIcon }
export const VAULT = { id: 'vault', label: 'Vault', icon: VaultIcon }
export const MODULES = [SHOP, MONEY, VAULT]
