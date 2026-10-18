// Backup of the whole eChopdo database to the owner's Google Drive, like WhatsApp's chat backup.
// One file per backup, "echopdo-backup-YYYY-MM-DD-HHMM.json.gz", in a Drive folder "eChopdo backups" that the
// app creates itself (scope drive.file: it only ever sees files it made, never the rest of the Drive). The last
// KEEP files are kept. Budget / Hisab rows are readable JSON; vault_items, vault_unlockers, wills… are exactly as
// stored, i.e. still encrypted — only the master password / recovery code opens them.
//   { action: 'status' }                     → owner: { connected, last_at, last_size, last_status, last_file, folder }
//   { action: 'connect', code }              → owner: exchange a Google authorization code, store the refresh token, run the first backup
//   { action: 'run' }                        → owner: back up now
//   { action: 'disconnect' }                 → owner: revoke Google access and forget it (Drive files stay)
//   { action: 'cron' } + header x-cron-secret → weekly job (pg_cron): back up every connected owner that is due
// Secret: GOOGLE_CLIENT_SECRET (the Web OAuth client; GOOGLE_CLIENT_ID may override the public id below). verify_jwt is off: user actions check the
// bearer token themselves (and refuse household member logins); cron checks a shared secret kept in the database Vault.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// The Web OAuth client's id is public (it ships in every page that signs in with Google); only the secret is a secret.
const GOOGLE_CLIENT_ID = '243462550397-r9ri19m26tuo13et7ovv0ru1r82i6tlh.apps.googleusercontent.com'
const KEEP = 8
const FOLDER_NAME = 'eChopdo backups'
const DUE_MS = 6 * 86400_000 // the weekly job backs up anyone whose last backup is older than this
const PAGE = 1000

// Tables saved, and how each is scoped to this owner. quick_devices (hashed phone tokens) and member_signup_tickets
// are left out on purpose: phones are paired again, tickets are one-time.
const BY_HOUSEHOLD = ['accounts', 'categories', 'transactions', 'budgets', 'recurring_items', 'dues', 'due_entries', 'loans', 'property_deals', 'hisab_books',
  'hisab_entries', 'hisab_categories', 'captures', 'capture_rules', 'household_members']
const BY_USER = ['vault_unlockers', 'vault_items', 'wills', 'will_versions', 'will_log']

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

async function google(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } })
  if (!res.ok) throw new Error(`Google Drive said ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GOOGLE_CLIENT_ID') || GOOGLE_CLIENT_ID, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') || '', ...params }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error_description || data.error || `Google sign-in failed (${res.status})`), { code: data.error })
  return data as { access_token: string, refresh_token?: string, scope?: string }
}

async function readAll(table: string, col: string, values: string[]) {
  const out: unknown[] = []
  if (!values.length) return out
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select('*').in(col, values).order(table === 'household_members' ? 'user_id' : 'id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return out
}

async function exportAll(owner: string) {
  const { data: hh, error } = await db.from('households').select('*').eq('user_id', owner)
  if (error) throw new Error(`households: ${error.message}`)
  const hids = (hh || []).map((h) => h.id as string)
  const { data: members } = hids.length ? await db.from('household_members').select('user_id').in('household_id', hids) : { data: [] }
  const users = [owner, ...((members || []).map((m) => m.user_id as string))]
  const tables: Record<string, unknown[]> = { households: hh || [] }
  for (const t of BY_HOUSEHOLD) tables[t] = await readAll(t, 'household_id', hids)
  for (const t of BY_USER) tables[t] = await readAll(t, 'user_id', users)
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))
  return { json: JSON.stringify({ app: 'eChopdo', format: 1, created_at: new Date().toISOString(), owner, counts, tables }), counts }
}

async function gzip(text: string) {
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}

function multipart(meta: unknown, bytes: Uint8Array, mime: string) {
  const b = 'echopdo' + crypto.randomUUID().replace(/-/g, '')
  const enc = new TextEncoder()
  const head = enc.encode(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`)
  const tail = enc.encode(`\r\n--${b}--`)
  const body = new Uint8Array(head.length + bytes.length + tail.length)
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length)
  return { body, type: `multipart/related; boundary=${b}` }
}

async function ensureFolder(token: string, folderId: string | null) {
  if (folderId) {
    try {
      const f = await (await google(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,trashed`, token)).json()
      if (f.id && !f.trashed) return f.id as string
    } catch { /* gone or no access: make a new one */ }
  }
  const made = await (await google('https://www.googleapis.com/drive/v3/files?fields=id', token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })).json()
  return made.id as string
}

async function runBackup(owner: string) {
  const { data: s } = await db.from('backup_settings').select('*').eq('user_id', owner).maybeSingle()
  if (!s) throw new Error('Google Drive is not connected yet.')
  try {
    const access = (await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh_token })).access_token
    const folder = await ensureFolder(access, s.folder_id)
    const { json: text, counts } = await exportAll(owner)
    const bytes = await gzip(text)
    const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 16).replace('T', '-').replace(':', '')
    const name = `echopdo-backup-${stamp}.json.gz`
    const { body, type } = multipart({ name, parents: [folder] }, bytes, 'application/gzip')
    await google('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', access, { method: 'POST', headers: { 'Content-Type': type }, body })
    // Keep the newest KEEP backups.
    const list = await (await google(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folder}' in parents and trashed = false`)}&orderBy=createdTime desc&pageSize=100&fields=files(id)`, access)).json()
    for (const f of (list.files || []).slice(KEEP)) { try { await google(`https://www.googleapis.com/drive/v3/files/${f.id}`, access, { method: 'DELETE' }) } catch { /* next time */ } }
    await db.from('backup_settings').update({ folder_id: folder, last_at: new Date().toISOString(), last_size: bytes.length, last_file: name, last_status: 'ok' }).eq('user_id', owner)
    return { ok: true, file: name, size: bytes.length, counts }
  } catch (e) {
    const code = (e as { code?: string }).code
    const msg = code === 'invalid_grant' ? 'Google access expired or was removed — connect Google Drive again.' : String((e as Error).message || e)
    await db.from('backup_settings').update({ last_status: msg.slice(0, 300) }).eq('user_id', owner)
    throw new Error(msg)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }

  if (body.action === 'cron') {
    // The shared secret lives only in the database (Vault); the function asks the database whether it matches.
    const given = req.headers.get('x-cron-secret') || ''
    const { data: ok } = given ? await db.rpc('backup_cron_ok', { p_secret: given }) : { data: false }
    if (ok !== true) return json({ error: 'Not allowed.' }, 401)
    const { data: all } = await db.from('backup_settings').select('user_id, last_at')
    const results: Record<string, string> = {}
    for (const s of all || []) {
      if (s.last_at && Date.now() - new Date(s.last_at).getTime() < DUE_MS) { results[s.user_id] = 'not due'; continue }
      try { await runBackup(s.user_id); results[s.user_id] = 'backed up' } catch (e) { results[s.user_id] = String((e as Error).message || e) }
    }
    return json({ results })
  }

  // Everything else: the signed-in owner (never a household member login).
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: u } = token ? await db.auth.getUser(token) : { data: { user: null } }
  const user = u?.user
  if (!user) return json({ error: 'Sign in again.' }, 401)
  if (user.app_metadata?.role === 'member') return json({ error: 'Only the owner can manage backups.' }, 403)

  try {
    if (body.action === 'status') {
      const { data: s } = await db.from('backup_settings').select('last_at, last_size, last_status, last_file').eq('user_id', user.id).maybeSingle()
      return json({ connected: !!s, configured: !!Deno.env.get('GOOGLE_CLIENT_SECRET'), ...(s || {}) })
    }
    if (body.action === 'connect') {
      if (!Deno.env.get('GOOGLE_CLIENT_SECRET')) return json({ error: 'The Google client secret is not set in Supabase yet (Edge Functions → Secrets → GOOGLE_CLIENT_SECRET).' }, 400)
      const code = typeof body.code === 'string' ? body.code : ''
      if (!code) return json({ error: 'No Google code.' }, 400)
      const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: 'postmessage' })
      if (!t.refresh_token) return json({ error: 'Google did not give long-term access. Remove eChopdo at myaccount.google.com/permissions, then connect again.' }, 400)
      if (t.scope && !t.scope.includes('drive.file')) return json({ error: 'The Drive permission was not granted.' }, 400)
      const { error } = await db.from('backup_settings').upsert({ user_id: user.id, refresh_token: t.refresh_token, last_status: 'connected' }, { onConflict: 'user_id' })
      if (error) return json({ error: error.message }, 500)
      return json(await runBackup(user.id))
    }
    if (body.action === 'run') return json(await runBackup(user.id))
    if (body.action === 'disconnect') {
      const { data: s } = await db.from('backup_settings').select('refresh_token').eq('user_id', user.id).maybeSingle()
      if (s) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.refresh_token)}`, { method: 'POST' }).catch(() => {})
        await db.from('backup_settings').delete().eq('user_id', user.id)
      }
      return json({ ok: true })
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400)
  }
})
