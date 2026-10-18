// Google Drive access for the Docs preview. A document's Drive link is turned into a file id, and the
// file is fetched with a short-lived Google access token (read-only scope) straight from the phone to
// Google — nothing goes through eChopdo's server, and nothing is stored: the file lives in memory
// while the preview is open. Uses the Web OAuth client (override with VITE_GOOGLE_CLIENT_ID) with this site as an
// authorized JavaScript origin and the Drive API enabled).
// The client ID is public by design (it ships in every page that uses Google sign-in), so it's the default here.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '243462550397-r9ri19m26tuo13et7ovv0ru1r82i6tlh.apps.googleusercontent.com'
export const previewAvailable = !!GOOGLE_CLIENT_ID

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const MAX_BYTES = 40 * 1024 * 1024

// File id from the usual Drive link shapes; null for folders and anything else.
export function driveFileId(link) {
  if (!link) return null
  let u
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(link) ? link : `https://${link}`) } catch { return null }
  if (!/(^|\.)google\.com$/.test(u.hostname)) return null
  if (/\/folders\//.test(u.pathname)) return null
  const m = u.pathname.match(/\/(?:file|document|spreadsheets|presentation|forms)\/(?:u\/\d+\/)?d\/([\w-]{10,})/)
  return m ? m[1] : u.searchParams.get('id')
}

let gisPromise
function loadGis() {
  gisPromise ||= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { gisPromise = null; reject(new Error("Couldn't reach Google. Check your connection.")) }
    document.head.appendChild(s)
  })
  return gisPromise
}

let token = null // { value, expires } — memory only, cleared on reload
let cachedIndex = null // names of the Drive tree, memory only
export const getCachedIndex = () => cachedIndex
export const setCachedIndex = (i) => { cachedIndex = i }
export const hasDriveToken = () => !!token && token.expires > Date.now() + 30_000
export const clearDriveCache = () => { cachedIndex = null }
export const clearDriveToken = () => { token = null; cachedIndex = null }

export async function accessToken(interactive = true) {
  if (token && token.expires > Date.now() + 30_000) return token.value
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error === 'access_denied' ? 'Google access was declined.' : `Google sign-in failed (${r.error}).`))
        token = { value: r.access_token, expires: Date.now() + (Number(r.expires_in) || 3600) * 1000 }
        resolve(token.value)
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed.' : "Couldn't open Google sign-in. Allow pop-ups and try again.")),
    })
    client.requestAccessToken({ prompt: interactive ? '' : 'none' })
  })
}

async function api(path, tok) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { headers: { Authorization: `Bearer ${tok}` } })
  if (res.status === 401) { clearDriveToken(); throw new Error('Google sign-in expired. Try again.') }
  if (res.status === 403) throw new Error('Google refused access to this file. Check the Google account has it, and that Drive access is enabled for eChopdo.')
  if (res.status === 404) throw new Error("This account can't see that file. Open it with the Google account that owns or was given the document.")
  if (!res.ok) throw new Error(`Google Drive error (${res.status}).`)
  return res
}

// → { blob, name, mime }. Google Docs/Sheets/Slides are exported as PDF; other files are downloaded as they are.
export async function fetchDriveFile(id) {
  const tok = await accessToken()
  const meta = await (await api(`files/${id}?fields=name,mimeType,size&supportsAllDrives=true`, tok)).json()
  const native = meta.mimeType.startsWith('application/vnd.google-apps.')
  if (!native && Number(meta.size) > MAX_BYTES) throw new Error('This file is too large to preview here. Use Open in Google Drive.')
  const res = await api(native ? `files/${id}/export?mimeType=application%2Fpdf` : `files/${id}?alt=media&supportsAllDrives=true`, tok)
  const blob = await res.blob()
  return { blob, name: meta.name, mime: native ? 'application/pdf' : meta.mimeType }
}

// Folder id from a Drive folder link (…/folders/ID, …/drive/u/0/folders/ID, …?id=ID); null otherwise.
export function driveFolderId(link) {
  if (!link) return null
  let u
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(link) ? link : `https://${link}`) } catch { return null }
  if (!/(^|\.)google\.com$/.test(u.hostname)) return null
  return u.pathname.match(/\/folders\/([\w-]{10,})/)?.[1] || null
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Reads every file and folder the account can see (names, parents, type — never contents) in as few
// calls as possible, so browsing and searching are instant afterwards. Held in memory only; call
// again to refresh. Returns Map id → { id, name, mimeType, parents, modifiedTime, size, webViewLink }.
export async function indexDrive(onProgress) {
  const tok = await accessToken()
  const out = new Map()
  // My Drive's own folder, so "whole Drive" is browsable like any other folder.
  const my = await (await api('files/root?fields=id,name', tok)).json()
  out.set(my.id, { id: my.id, name: 'My Drive', mimeType: FOLDER_MIME, parents: [] })
  out.rootId = my.id
  let pageToken = ''
  for (let page = 0; page < 40; page++) {
    const q = new URLSearchParams({
      q: 'trashed = false',
      fields: 'nextPageToken, files(id,name,mimeType,parents,modifiedTime,size,webViewLink)',
      pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    })
    if (pageToken) q.set('pageToken', pageToken)
    const data = await (await api(`files?${q}`, tok)).json()
    for (const f of data.files || []) out.set(f.id, f)
    onProgress?.(out.size)
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return out
}

// Children of one folder, folders first then files by name; and every file below it (for search).
export function childrenOf(index, folderId) {
  const list = []
  for (const f of index.values()) if (f.parents?.includes(folderId)) list.push(f)
  return list.sort((a, b) => (b.mimeType === FOLDER_MIME) - (a.mimeType === FOLDER_MIME) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

export function subtreeOf(index, rootId) {
  const kids = new Map()
  for (const f of index.values()) for (const p of f.parents || []) (kids.get(p) || kids.set(p, []).get(p)).push(f)
  const out = []
  const stack = [rootId]
  const seen = new Set()
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    for (const f of kids.get(id) || []) { out.push(f); if (f.mimeType === FOLDER_MIME) stack.push(f.id) }
  }
  return out
}

// Folder names from the root down to (and excluding) the item: ["Member", "2025"].
export function pathNames(index, item, rootId) {
  const names = []
  let cur = item
  for (let i = 0; i < 12 && cur; i++) {
    const parent = cur.parents?.[0]
    if (!parent || parent === rootId) break
    cur = index.get(parent)
    if (cur) names.unshift(cur.name)
  }
  return names
}
