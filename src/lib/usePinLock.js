import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { createCredential, getAssertion, platformAuthenticatorAvailable } from './webauthn'

// App PIN (owner: "on the shop PC it opened straight away — anyone could open it"). Admin and staff unlock the
// app with a 4-digit PIN (checked on the server, rpc check_app_pin; 5 wrong tries → signed out) when it's
// opened, or after 15 minutes without use. A refresh doesn't ask (sessionStorage, cleared when the app or tab
// is closed). Just signed in (password / Google / passkey within 10 min) counts as unlocked. On phones the
// fingerprint can stand in for the PIN (a credential on this device, gx.pinFinger.<user>).
const SESSION = 'gx.pinOk'
const IDLE_MS = 15 * 60_000
const read = () => { try { return JSON.parse(sessionStorage.getItem(SESSION)) } catch { return null } }
const mark = (uid) => { try { sessionStorage.setItem(SESSION, JSON.stringify({ uid, active: Date.now() })) } catch { /* ignore */ } }
const clear = () => { try { sessionStorage.removeItem(SESSION) } catch { /* ignore */ } }
const fingerKey = (uid) => `gx.pinFinger.${uid}`

export function usePinLock(session) {
  const uid = session.user.id
  const [state, setState] = useState('loading') // loading | setup | locked | open
  const [reset, setReset] = useState(false) // setup after a lock-out
  const [finger, setFinger] = useState(() => { try { return localStorage.getItem(fingerKey(uid)) } catch { return null } })
  const [canFinger, setCanFinger] = useState(false)
  useEffect(() => { platformAuthenticatorAvailable().then(setCanFinger) }, [])

  useEffect(() => {
    let live = true
    supabase.rpc('app_pin_status').then(({ data, error }) => {
      if (!live) return
      if (error) { setState('open'); return } // never lock someone out because the check failed to load
      const s = read()
      if (!data.set) setState('setup')
      // Just signed in after being locked out (5 wrong tries, or "Forgot PIN?") → set a new PIN; else open.
      // The rpc must be awaited/then'd: an un-awaited supabase.rpc() never sends, so the wrong-try count
      // stayed at 5 and every later PIN — even the right one — signed staff out again (Atharva, 28 Oct).
      else if (data.fresh && data.blocked) { setReset(true); setState('setup') }
      else if (data.fresh) { supabase.rpc('app_pin_signed_in').then(() => {}); mark(uid); setState('open') }
      else if (s?.uid === uid && Date.now() - s.active < IDLE_MS) { mark(uid); setState('open') }
      else setState('locked')
    })
    return () => { live = false }
  }, [uid])

  // Activity keeps it open; 15 min without a tap (or 15 min in the background) locks it.
  useEffect(() => {
    if (state !== 'open') return
    let last = 0
    const touch = () => { const now = Date.now(); if (now - last > 15_000) { last = now; mark(uid) } }
    const check = () => { const s = read(); if (!s || Date.now() - s.active > IDLE_MS) setState('locked') }
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('pointerdown', touch, true)
    document.addEventListener('keydown', touch, true)
    document.addEventListener('visibilitychange', onVis)
    const t = setInterval(check, 60_000)
    return () => { document.removeEventListener('pointerdown', touch, true); document.removeEventListener('keydown', touch, true); document.removeEventListener('visibilitychange', onVis); clearInterval(t) }
  }, [state, uid])

  const unlock = useCallback(async (pin) => {
    const { data, error } = await supabase.rpc('check_app_pin', { p_pin: pin })
    if (error) throw error
    if (data.ok) { mark(uid); setState('open'); return { ok: true } }
    if (data.left <= 0) { clear(); await supabase.auth.signOut(); return { ok: false, left: 0 } }
    return { ok: false, left: data.left }
  }, [uid])

  const setPin = useCallback(async (pin, current) => {
    const { error } = await supabase.rpc('set_app_pin', { p_pin: pin, p_current: current || null })
    if (error) throw error
    mark(uid); setState('open')
  }, [uid])

  const unlockWithFinger = useCallback(async () => {
    await getAssertion({ credentials: [{ credentialId: finger }] })
    mark(uid); setState('open')
  }, [finger, uid])

  const enableFinger = useCallback(async () => {
    const { credentialId } = await createCredential({ name: session.user.email, displayName: 'GRANDXGAMER app lock' })
    try { localStorage.setItem(fingerKey(uid), credentialId) } catch { /* ignore */ }
    setFinger(credentialId)
  }, [session, uid])
  const disableFinger = useCallback(() => { try { localStorage.removeItem(fingerKey(uid)) } catch { /* ignore */ } setFinger(null) }, [uid])

  return { state, reset, unlock, setPin, lockNow: () => { clear(); setState('locked') }, finger: !!finger && canFinger, canFinger, unlockWithFinger, enableFinger, disableFinger }
}
