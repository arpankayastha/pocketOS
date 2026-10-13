// Lock-screen alerts (web push, owner 13 Oct): shown even when GRANDXGAMER is closed. Loaded into the
// service worker by vite-plugin-pwa (workbox importScripts). Payload from the push-alerts function.
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { title: 'GRANDXGAMER', body: event.data && event.data.text() } }
  event.waitUntil(self.registration.showNotification(d.title || 'GRANDXGAMER', {
    body: d.body || '', tag: d.tag, renotify: true, requireInteraction: !!d.urgent,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    vibrate: d.urgent ? [400, 150, 400, 150, 400] : [250, 100, 250], data: { url: d.url || '/' },
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus() }
    return self.clients.openWindow(url)
  }))
})
