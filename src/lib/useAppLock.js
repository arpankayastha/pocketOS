import { useCallback, useEffect, useRef, useState } from 'react'
import { createCredential, getAssertion } from './webauthn'
import { DEVICE_CREDENTIAL_KEY } from './useVault'

// App lock: a per-device privacy screen that asks for a fingerprint when eChopdo opens
// or returns from the background. It gates the UI only; Budget data isn't encrypted
// (the Vault is, independently). Setting is stored per device in localStorage.
const APP_LOCK_KEY = 'pocketos.appLock'
const RELOCK_AFTER_MS = 60_000
// A reload / pull-to-refresh within this tab doesn't lock again, unless the app sat in the
// background past RELOCK_AFTER_MS or went unused for IDLE_MS. sessionStorage is cleared when
// the app is closed, so reopening always asks.
const SESSION_KEY = 'pocketos.appUnlocked' // sessionStorage: { active, hiddenAt }
const IDLE_MS = 5 * 60_000

function readSetting() {
  try { return JSON.parse(localStorage.getItem(APP_LOCK_KEY)) } catch { return null }
}
const readSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) } catch { return null } }
const writeSession = (v) => { try { if (v) sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); else sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ } }
function stillUnlocked() {
  const s = readSession(), now = Date.now()
  return !!s && now - s.active <= IDLE_MS && !(s.hiddenAt && now - s.hiddenAt > RELOCK_AFTER_MS)
}

export function useAppLock(session) {
  const [setting, setSetting] = useState(readSetting) // { credentialId } | null
  const [locked, setLockedState] = useState(() => !!readSetting() && !stillUnlocked())
  const hiddenAt = useRef(null)
  const setLocked = useCallback((value) => {
    writeSession(value ? null : { active: Date.now(), hiddenAt: null })
    setLockedState(value)
  }, [])

  useEffect(() => {
    if (!setting || locked) return
    let last = 0
    const onActivity = () => { const now = Date.now(); if (now - last > 10_000) { last = now; writeSession({ active: now, hiddenAt: null }) } }
    const onVisibility = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); writeSession({ ...readSession(), hiddenAt: hiddenAt.current }) }
      else if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS) setLocked(true)
      else { last = Date.now(); writeSession({ active: last, hiddenAt: null }) }
    }
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('pointerdown', onActivity, true)
    return () => { document.removeEventListener('visibilitychange', onVisibility); document.removeEventListener('pointerdown', onActivity, true) }
  }, [setting, locked, setLocked])

  const save = (value) => {
    try {
      if (value) localStorage.setItem(APP_LOCK_KEY, JSON.stringify(value))
      else localStorage.removeItem(APP_LOCK_KEY)
    } catch { /* ignore */ }
    setSetting(value)
  }

  // Reuses this device's vault fingerprint credential if there is one, so the user
  // doesn't end up with two "eChopdo" passkeys on the same phone.
  const enable = useCallback(async () => {
    let credentialId = null
    try { credentialId = localStorage.getItem(DEVICE_CREDENTIAL_KEY) } catch { /* ignore */ }
    if (credentialId) await getAssertion({ credentials: [{ credentialId }] })
    else credentialId = (await createCredential({ name: session.user.email, displayName: 'eChopdo' })).credentialId
    save({ credentialId })
    setLocked(false) // just verified: counts as unlocked for this session
  }, [session, setLocked])

  const disable = useCallback(() => { save(null); setLocked(false) }, [setLocked])

  const unlock = useCallback(async () => {
    await getAssertion({ credentials: [{ credentialId: setting.credentialId }] })
    setLocked(false)
  }, [setting, setLocked])

  return { enabled: !!setting, locked: !!setting && locked, enable, disable, unlock, unlockWithoutFingerprint: () => setLocked(false), lockNow: () => setLocked(true) }
}
