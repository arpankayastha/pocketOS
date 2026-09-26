import { useCallback, useEffect, useRef, useState } from 'react'
import { createCredential, getAssertion } from './webauthn'
import { DEVICE_CREDENTIAL_KEY } from './useVault'

// App lock: a per-device privacy screen that asks for a fingerprint when PocketOS opens
// or returns from the background. It gates the UI only; Budget data isn't encrypted
// (the Vault is, independently). Setting is stored per device in localStorage.
const APP_LOCK_KEY = 'pocketos.appLock'
const RELOCK_AFTER_MS = 60_000

function readSetting() {
  try { return JSON.parse(localStorage.getItem(APP_LOCK_KEY)) } catch { return null }
}

export function useAppLock(session) {
  const [setting, setSetting] = useState(readSetting) // { credentialId } | null
  const [locked, setLocked] = useState(() => !!readSetting())
  const hiddenAt = useRef(null)

  useEffect(() => {
    if (!setting) return
    const onVisibility = () => {
      if (document.hidden) hiddenAt.current = Date.now()
      else if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS) setLocked(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [setting])

  const save = (value) => {
    try {
      if (value) localStorage.setItem(APP_LOCK_KEY, JSON.stringify(value))
      else localStorage.removeItem(APP_LOCK_KEY)
    } catch { /* ignore */ }
    setSetting(value)
  }

  // Reuses this device's vault fingerprint credential if there is one, so the user
  // doesn't end up with two "PocketOS" passkeys on the same phone.
  const enable = useCallback(async () => {
    let credentialId = null
    try { credentialId = localStorage.getItem(DEVICE_CREDENTIAL_KEY) } catch { /* ignore */ }
    if (credentialId) await getAssertion({ credentials: [{ credentialId }] })
    else credentialId = (await createCredential({ name: session.user.email, displayName: 'PocketOS' })).credentialId
    save({ credentialId })
  }, [session])

  const disable = useCallback(() => { save(null); setLocked(false) }, [])

  const unlock = useCallback(async () => {
    await getAssertion({ credentials: [{ credentialId: setting.credentialId }] })
    setLocked(false)
  }, [setting])

  return { enabled: !!setting, locked: !!setting && locked, enable, disable, unlock, unlockWithoutFingerprint: () => setLocked(false), lockNow: () => setLocked(true) }
}
