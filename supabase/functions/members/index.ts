// Household member logins (Budget → Accounts & Categories → Households).
// Only the owner of a household may call this; members are rejected. Uses the service role
// (auto-injected env) to create/reset/remove auth users, which the client must never hold.
//   { action: 'list' }                                  → members of all the caller's households
//   { action: 'create', householdId, username, pin }    → new login for a household
//   { action: 'reset_pin', householdId, userId, pin }   → new PIN
//   { action: 'remove', householdId, userId }           → delete login (their entries stay, re-owned by the caller)
import { createClient } from 'npm:@supabase/supabase-js@2'

const EMAIL_DOMAIN = 'members.my-pocket-os.vercel.app'
const FINANCE_TABLES = ['accounts', 'categories', 'transactions', 'budgets', 'recurring_items', 'dues', 'due_entries', 'hisab_books', 'hisab_entries']
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return json({ error: 'Not signed in.' }, 401)
  if (user.app_metadata?.role === 'member') return json({ error: 'Only the owner can manage logins.' }, 403)

  let body: Record<string, string>
  try { body = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const { action, householdId, userId } = body

  if (action === 'list') {
    const { data: hhs } = await admin.from('households').select('id').eq('user_id', user.id)
    const ids = (hhs || []).map((h) => h.id)
    if (!ids.length) return json({ members: [] })
    const { data: rows, error } = await admin.from('household_members').select('*').in('household_id', ids)
    if (error) return json({ error: error.message }, 500)
    const members = await Promise.all((rows || []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id)
      return { ...m, last_sign_in_at: data.user?.last_sign_in_at ?? null }
    }))
    return json({ members })
  }

  // Every other action targets one household the caller must own.
  const { data: hh } = await admin.from('households').select('id, user_id').eq('id', householdId || '').maybeSingle()
  if (!hh || hh.user_id !== user.id) return json({ error: 'Not your household.' }, 403)

  const pinOk = (pin: string) => /^\d{6}$/.test(pin || '')
  const memberOf = async (id: string) => {
    const { data } = await admin.from('household_members').select('user_id').eq('household_id', hh.id).eq('user_id', id || '').maybeSingle()
    return !!data
  }

  if (action === 'create') {
    const username = String(body.username || '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) return json({ error: 'Username: 3–32 letters, digits, dot, dash or underscore.' }, 400)
    if (!pinOk(body.pin)) return json({ error: 'The PIN must be 6 digits.' }, 400)
    const { data: taken } = await admin.from('household_members').select('household_id').eq('username', username).maybeSingle()
    if (taken) return json({ error: `"${username}" is already used.` }, 409)
    const { data: existing } = await admin.from('household_members').select('user_id').eq('household_id', hh.id).maybeSingle()
    if (existing) return json({ error: 'This household already has a login.' }, 409)
    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${username}@${EMAIL_DOMAIN}`, password: body.pin, email_confirm: true,
      app_metadata: { role: 'member' }, user_metadata: { username },
    })
    if (error || !created.user) return json({ error: error?.message || 'Could not create the login.' }, 400)
    const { error: err } = await admin.from('household_members').insert({ household_id: hh.id, user_id: created.user.id, username })
    if (err) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: err.message }, 500) }
    return json({ ok: true, userId: created.user.id })
  }

  if (action === 'reset_pin') {
    if (!pinOk(body.pin)) return json({ error: 'The PIN must be 6 digits.' }, 400)
    if (!await memberOf(userId)) return json({ error: 'Not a member of this household.' }, 404)
    const { error } = await admin.auth.admin.updateUserById(userId, { password: body.pin })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  if (action === 'remove') {
    if (!await memberOf(userId)) return json({ error: 'Not a member of this household.' }, 404)
    // Rows reference auth.users with on delete cascade: hand the member's entries to the
    // owner first so removing the login never deletes household data.
    for (const t of FINANCE_TABLES) {
      const { error } = await admin.from(t).update({ user_id: user.id }).eq('user_id', userId)
      if (error) return json({ error: `${t}: ${error.message}` }, 500)
    }
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  return json({ error: 'Unknown action.' }, 400)
})
