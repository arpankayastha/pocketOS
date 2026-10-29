import { WalletIcon, VaultIcon, GamepadIcon, DashboardIcon } from './icons'

// GRANDXGAMER modules, in switcher order. Shop is the café (floor, staff, events, cash); Money is
// eChopdo's Budget module for the admin only; Vault is shared passwords.
// Admin = the admin portal (owner, 29 Oct), where admins land; Shop = the counter app staff use.
export const ADMIN = { id: 'admin', label: 'Admin', icon: DashboardIcon }
export const SHOP = { id: 'shop', label: 'Shop', icon: GamepadIcon }
export const MONEY = { id: 'budget', label: 'Money', icon: WalletIcon }
export const VAULT = { id: 'vault', label: 'Vault', icon: VaultIcon }
export const MODULES = [ADMIN, SHOP, MONEY, VAULT]
