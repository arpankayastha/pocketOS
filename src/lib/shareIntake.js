// A link shared INTO eChopdo (Google Drive → Share → eChopdo): the Android app opens the site with
// ?title=…&text=…&url=… (Android's share fields; the PWA manifest's share_target uses the same names).
// We read it once on page load, clear it from the address bar, and keep it until Docs opens the
// Add form — which can be after the unlock screen, or a reload (sessionStorage).
const KEY = 'pocketos.sharedLink'
const URL_RE = /https?:\/\/[^\s<>"']+/i

export function readSharedLink(search = location.search) {
  const q = new URLSearchParams(search)
  if (!q.has('url') && !q.has('text') && !q.has('title')) return null
  const link = (q.get('url') || '').match(URL_RE)?.[0] || (q.get('text') || '').match(URL_RE)?.[0]
  if (!link) return null
  const subject = (q.get('title') || '').trim()
  // Drive's share text is often just the link; the title field is the file name.
  const title = subject && !URL_RE.test(subject) ? subject : ''
  return { link, title }
}

let pending = null
try { pending = JSON.parse(sessionStorage.getItem(KEY)) } catch { /* ignore */ }
const fromUrl = readSharedLink()
if (fromUrl) {
  pending = fromUrl
  try { sessionStorage.setItem(KEY, JSON.stringify(fromUrl)) } catch { /* ignore */ }
  try { history.replaceState(null, '', location.pathname + location.hash) } catch { /* ignore */ }
}

export const peekSharedLink = () => pending
export function takeSharedLink() {
  const p = pending
  pending = null
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
  return p
}
