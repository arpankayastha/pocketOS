import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import {
  PBKDF2_ITERATIONS, randomBytes, toB64, fromB64, kekFromPassword, kekFromSecret, wrapVaultKey, unwrapVaultKey,
  importVaultKey, encryptItem, decryptItem, generateRecoveryCode, recoveryCodeBytes,
} from './vaultCrypto'
import { createCredential, getAssertion } from './webauthn'
import { saveVaultSession, restoreVaultSession, markVaultActive, markVaultHidden, clearVaultSession } from './vaultSession'

const IDLE_LOCK_MS = 5 * 60_000     // lock after 5 minutes without interaction
const BACKGROUND_LOCK_MS = 60_000   // lock if the app was in the background longer than this
const RECOVERY_INFO = 'pocketos-vault-recovery-v1'
const PRF_INFO = 'pocketos-vault-prf-v1'
export const DEVICE_CREDENTIAL_KEY = 'pocketos.vaultCredential' // this device's vault fingerprint credential id

export const MIN_MASTER_PASSWORD = 10

// True when THIS device has a fingerprint unlocker for THIS web address (credentials are
// per-origin; the id of the one made here is kept in this origin's localStorage).
export function fingerprintHere(unlockers) {
  let id = null
  try { id = localStorage.getItem(DEVICE_CREDENTIAL_KEY) } catch { /* ignore */ }
  return !!id && unlockers.some((u) => u.kind === 'prf' && u.credential_id === id)
}

// Vault state lives in the Shell (not the Vault module) so switching to Budget and back
// doesn't lock it. The decrypted vault key is held in memory, in refs — plus, so a reload or
// pull-to-refresh doesn't ask for the fingerprint again, an encrypted copy for this tab only
// (vaultSession.js), which expires with the same idle / background limits and on lock.
// `householdId` (member logins only): new items are tagged with it so the owner and the
// household both see them.
export function useVault(session, { householdId } = {}) {
  const [status, setStatus] = useState('loading') // loading | setup | locked | unlocked
  const [unlockers, setUnlockers] = useState([])
  const [items, setItems] = useState([])
  const [error, setError] = useState(null)
  const [lockedByUser, setLockedByUser] = useState(false) // skip the automatic fingerprint prompt right after "Lock"
  const rawKey = useRef(null)
  const cryptoKey = useRef(null)
  const lastActive = useRef(0) // set on unlock
  const hiddenAt = useRef(null)

  const lock = useCallback(() => {
    if (rawKey.current) rawKey.current.fill(0)
    rawKey.current = null
    cryptoKey.current = null
    clearVaultSession()
    setItems([])
    setStatus((s) => (s === 'unlocked' ? 'locked' : s))
  }, [])

  const loadUnlockers = useCallback(async () => {
    // The owner can also read their household members' unlockers (RLS); only our own count here.
    const { data, error } = await supabase.from('vault_unlockers')
      .select('id, kind, label, credential_id, salt, iterations, iv, wrapped_key, created_at').eq('user_id', session.user.id).order('created_at')
    if (error) { setError(error.message); return null }
    setUnlockers(data)
    return data
  }, [session.user.id])

  const openRef = useRef(null) // openWithRawKey, defined below
  useEffect(() => {
    let cancelled = false
    loadUnlockers().then(async (data) => {
      if (!data || cancelled) return
      if (!data.some((u) => u.kind === 'password')) { setStatus((s) => (s === 'unlocked' ? s : 'setup')); return }
      // Reloaded while unlocked (pull-to-refresh)? Carry on without asking again.
      const raw = await restoreVaultSession(session.user.id, { idleMs: IDLE_LOCK_MS, backgroundMs: BACKGROUND_LOCK_MS })
      if (cancelled) return
      if (raw) { try { await openRef.current(raw); return } catch { clearVaultSession() } }
      setStatus((s) => (s === 'unlocked' ? s : 'locked'))
    })
    return () => { cancelled = true }
  }, [loadUnlockers, session.user.id])

  const loadItems = useCallback(async () => {
    // Owner: own items + everything their household members add. Member: own + shared with them.
    const { data, error } = await supabase.from('vault_items').select('id, iv, ciphertext, created_at, updated_at, user_id, household_ids')
    if (error) throw new Error(error.message)
    const out = []
    for (const row of data) {
      try {
        out.push({ ...(await decryptItem(cryptoKey.current, row)), id: row.id, created_at: row.created_at, updated_at: row.updated_at,
          owner_id: row.user_id, household_ids: row.household_ids || [], mine: row.user_id === session.user.id })
      } catch {
        out.push({ id: row.id, title: '⚠ Unreadable item', corrupt: true, owner_id: row.user_id, household_ids: row.household_ids || [], mine: row.user_id === session.user.id })
      }
    }
    out.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }))
    setItems(out)
  }, [session.user.id])

  const openWithRawKey = useCallback(async (raw) => {
    rawKey.current = raw
    cryptoKey.current = await importVaultKey(raw)
    lastActive.current = Date.now()
    await loadItems()
    await saveVaultSession(session.user.id, raw)
    setError(null)
    setLockedByUser(false)
    setStatus('unlocked')
  }, [loadItems, session.user.id])
  useEffect(() => { openRef.current = openWithRawKey }, [openWithRawKey])

  // ----- Unlockers -----
  async function passwordRow(password, raw) {
    const salt = randomBytes(16)
    const wrapped = await wrapVaultKey(raw, await kekFromPassword(password, salt, PBKDF2_ITERATIONS))
    return { kind: 'password', salt: toB64(salt), iterations: PBKDF2_ITERATIONS, ...wrapped }
  }

  async function recoveryRow(code, raw) {
    const salt = randomBytes(16)
    const wrapped = await wrapVaultKey(raw, await kekFromSecret(recoveryCodeBytes(code), salt, RECOVERY_INFO))
    return { kind: 'recovery', salt: toB64(salt), ...wrapped }
  }

  // First-time setup. Returns the recovery code, which is shown once and never stored in clear.
  const setup = useCallback(async (password) => {
    const raw = randomBytes(32)
    const code = generateRecoveryCode()
    const rows = [await passwordRow(password, raw), await recoveryRow(code, raw)]
    const { error } = await supabase.from('vault_unlockers').insert(rows)
    if (error) throw new Error(error.message)
    await loadUnlockers()
    await openWithRawKey(raw)
    return code
  }, [loadUnlockers, openWithRawKey])

  const unlockWithPassword = useCallback(async (password) => {
    const u = unlockers.find((x) => x.kind === 'password')
    let raw
    try { raw = await unwrapVaultKey(u, await kekFromPassword(password, fromB64(u.salt), u.iterations)) }
    catch { throw new Error('Wrong master password.') }
    await openWithRawKey(raw)
  }, [unlockers, openWithRawKey])

  const unlockWithRecovery = useCallback(async (code) => {
    const u = unlockers.find((x) => x.kind === 'recovery')
    if (!u) throw new Error('No recovery code is set up for this vault.')
    const secret = recoveryCodeBytes(code)
    let raw
    try { raw = await unwrapVaultKey(u, await kekFromSecret(secret, fromB64(u.salt), RECOVERY_INFO)) }
    catch { throw new Error('That recovery code is not correct.') }
    await openWithRawKey(raw)
  }, [unlockers, openWithRawKey])

  const fingerprintUnlockers = unlockers.filter((u) => u.kind === 'prf')

  const unlockWithFingerprint = useCallback(async () => {
    const prfs = unlockers.filter((u) => u.kind === 'prf')
    const { credentialId, prf } = await getAssertion({ credentials: prfs.map((u) => ({ credentialId: u.credential_id, prfSalt: fromB64(u.salt) })) })
    const u = prfs.find((x) => x.credential_id === credentialId)
    if (!u || !prf) throw new Error('This fingerprint is not registered for the vault.')
    let raw
    try { raw = await unwrapVaultKey(u, await kekFromSecret(prf, new Uint8Array(), PRF_INFO)) }
    catch { throw new Error('Fingerprint did not unlock the vault. Use your master password.') }
    try { localStorage.setItem(DEVICE_CREDENTIAL_KEY, credentialId) } catch { /* ignore */ }
    await openWithRawKey(raw)
  }, [unlockers, openWithRawKey])

  const addFingerprint = useCallback(async (label) => {
    const prfSalt = randomBytes(32)
    const { credentialId, prf } = await createCredential({ name: session.user.email, displayName: 'eChopdo Vault', prfSalt })
    const wrapped = await wrapVaultKey(rawKey.current, await kekFromSecret(prf, new Uint8Array(), PRF_INFO))
    const { error } = await supabase.from('vault_unlockers').insert({ kind: 'prf', label, credential_id: credentialId, salt: toB64(prfSalt), ...wrapped })
    if (error) throw new Error(error.message)
    try { localStorage.setItem(DEVICE_CREDENTIAL_KEY, credentialId) } catch { /* ignore */ }
    await loadUnlockers()
  }, [session, loadUnlockers])

  const removeUnlocker = useCallback(async (u) => {
    const { error } = await supabase.from('vault_unlockers').delete().eq('id', u.id)
    if (error) throw new Error(error.message)
    try { if (localStorage.getItem(DEVICE_CREDENTIAL_KEY) === u.credential_id) localStorage.removeItem(DEVICE_CREDENTIAL_KEY) } catch { /* ignore */ }
    await loadUnlockers()
  }, [loadUnlockers])

  const changePassword = useCallback(async (password) => {
    const row = await passwordRow(password, rawKey.current)
    // No user filter on purpose: for the owner this also updates every household vault
    // (they share the owner's master password and key); for anyone else RLS limits it to self.
    const { error } = await supabase.from('vault_unlockers').update(row).eq('kind', 'password')
    if (error) throw new Error(error.message)
    await loadUnlockers()
  }, [loadUnlockers])

  const regenerateRecovery = useCallback(async () => {
    const code = generateRecoveryCode()
    const row = await recoveryRow(code, rawKey.current)
    const existing = unlockers.find((u) => u.kind === 'recovery')
    const { error } = existing
      ? await supabase.from('vault_unlockers').update(row).eq('id', existing.id)
      : await supabase.from('vault_unlockers').insert(row)
    if (error) throw new Error(error.message)
    await loadUnlockers()
    return code
  }, [unlockers, loadUnlockers])

  // ----- Items -----
  const saveItem = useCallback(async (data, id) => {
    const itemId = id || crypto.randomUUID()
    const payload = await encryptItem(cryptoKey.current, itemId, data)
    const { error } = id
      ? await supabase.from('vault_items').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id)
      : await supabase.from('vault_items').insert({ id: itemId, ...payload, household_ids: householdId ? [householdId] : [] })
    if (error) throw new Error(error.message)
    await loadItems()
  }, [loadItems, householdId])

  // Owner: which households can see an item (not secret — it only controls who can fetch it).
  const shareItem = useCallback(async (id, householdIds) => {
    const { error } = await supabase.from('vault_items').update({ household_ids: householdIds }).eq('id', id)
    if (error) throw new Error(error.message)
    await loadItems()
  }, [loadItems])

  // Owner: give a household login access to the family vault — a copy of the owner's password
  // unlocker (same master password, same key) under the member's user id.
  const enableHouseholdVault = useCallback(async (memberUserId, password) => {
    const u = unlockers.find((x) => x.kind === 'password')
    try { (await unwrapVaultKey(u, await kekFromPassword(password, fromB64(u.salt), u.iterations))).fill(0) }
    catch { throw new Error('Wrong master password.') }
    const row = await passwordRow(password, rawKey.current)
    await supabase.from('vault_unlockers').delete().eq('user_id', memberUserId).eq('kind', 'password')
    const { error } = await supabase.from('vault_unlockers').insert({ ...row, user_id: memberUserId })
    if (error) throw new Error(error.message)
  }, [unlockers])

  // Owner: turn a household's vault access off (their fingerprints too). Their items stay (you still see them).
  const disableHouseholdVault = useCallback(async (memberUserId) => {
    const { error } = await supabase.from('vault_unlockers').delete().eq('user_id', memberUserId)
    if (error) throw new Error(error.message)
  }, [])

  const deleteItem = useCallback(async (id) => {
    const { error } = await supabase.from('vault_items').delete().eq('id', id)
    if (error) throw new Error(error.message)
    await loadItems()
  }, [loadItems])

  const importItems = useCallback(async (list, onProgress) => {
    const rows = []
    for (const data of list) {
      const id = crypto.randomUUID()
      rows.push({ id, ...(await encryptItem(cryptoKey.current, id, data)) })
    }
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from('vault_items').insert(rows.slice(i, i + 100))
      if (error) throw new Error(error.message)
      onProgress?.(Math.min(i + 100, rows.length))
    }
    await loadItems()
  }, [loadItems])

  // Generic encryption with the vault key, for other modules (e.g. Will) that store their own
  // rows: `seal(id, data)` → { iv, ciphertext }, `unseal(row)` → data. `id` is bound as AAD.
  const seal = useCallback((id, data) => encryptItem(cryptoKey.current, id, data), [])
  const unseal = useCallback((row) => decryptItem(cryptoKey.current, row), [])

  // Verifies the master password without changing state (used as the app-lock fallback).
  const checkPassword = useCallback(async (password) => {
    const u = unlockers.find((x) => x.kind === 'password')
    if (!u) return false
    try { (await unwrapVaultKey(u, await kekFromPassword(password, fromB64(u.salt), u.iterations))).fill(0); return true }
    catch { return false }
  }, [unlockers])

  const lockNow = useCallback(() => { setLockedByUser(true); lock() }, [lock])

  // Fresh fingerprint check while already unlocked (e.g. to open the hidden Will).
  // Resolves true on success, false if this device has no fingerprint set up; throws if cancelled.
  const verifyUser = useCallback(async () => {
    const prfs = unlockers.filter((u) => u.kind === 'prf')
    if (!prfs.length) return false
    await getAssertion({ credentials: prfs.map((u) => ({ credentialId: u.credential_id })) })
    return true
  }, [unlockers])

  // ----- Auto-lock -----
  const touch = useCallback(() => {
    const now = Date.now()
    if (now - lastActive.current > 10_000) markVaultActive() // throttled: touch runs on every tap
    lastActive.current = now
  }, [])

  useEffect(() => {
    if (status !== 'unlocked') return
    const timer = setInterval(() => { if (Date.now() - lastActive.current > IDLE_LOCK_MS) lock() }, 15_000)
    const onVisibility = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); markVaultHidden() }
      else if (hiddenAt.current && Date.now() - hiddenAt.current > BACKGROUND_LOCK_MS) lock()
      else { lastActive.current = Date.now(); markVaultActive() }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [status, lock])

  return {
    status, error, lockedByUser, unlockers, fingerprintUnlockers, items, hasRecovery: unlockers.some((u) => u.kind === 'recovery'),
    setup, unlockWithPassword, unlockWithRecovery, unlockWithFingerprint, checkPassword,
    addFingerprint, removeUnlocker, changePassword, regenerateRecovery,
    saveItem, deleteItem, importItems, seal, unseal, lock, lockNow, touch, verifyUser,
    shareItem, enableHouseholdVault, disableHouseholdVault,
  }
}
