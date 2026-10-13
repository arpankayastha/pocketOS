import { supabase } from './supabase'

// Lock-screen alerts (owner, 13 Oct): this phone subscribes to web push; the push-alerts function sends
// 5 min left / time up / new online bookings even when the app is closed. iPhone: only once the app is
// added to the home screen (iOS 16.4+).
const VAPID_PUBLIC = 'BDB7ggd8ragGp4KthqSfV4nX8NzVvli0FkK4XIkGhceVEo4WXZU_foxi3AajxPG9kZeaXyPfI2YBryzEfwMSEJw'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true

const key = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}
const deviceName = () => {
  const ua = navigator.userAgent
  return /android/i.test(ua) ? `Android · ${/chrome/i.test(ua) ? 'Chrome' : 'browser'}` : isIos() ? 'iPhone' : /windows/i.test(ua) ? 'Windows PC' : /mac/i.test(ua) ? 'Mac' : 'Device'
}

export async function pushState() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

export async function enablePush() {
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in the browser settings.')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID_PUBLIC) })
  const j = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_device: deviceName(), p_on: true })
  if (error) throw error
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const j = sub.toJSON()
  await supabase.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_device: deviceName(), p_on: false })
  await sub.unsubscribe()
}

export async function testPush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) throw new Error('Turn lock-screen alerts on first.')
  const { data, error } = await supabase.functions.invoke('push-alerts', { body: { test: true, endpoint: sub.endpoint } })
  if (error || data?.error) throw new Error(data?.error || error.message)
}
