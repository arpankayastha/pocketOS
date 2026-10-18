// Guest view (Settings → Guest view): lets the signed-in OWNER open the empty demo account without typing a
// password. Returns a one-time token for demo@echopdo.vercel.app, which the app exchanges with
// supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }). Household members and the demo login itself are refused.
import { createClient } from 'npm:@supabase/supabase-js@2'

const DEMO_EMAIL = 'demo@echopdo.vercel.app'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return json({ error: 'Not signed in.' }, 401)
  if (user.app_metadata?.role === 'member' || user.email === DEMO_EMAIL) return json({ error: 'Only the owner can open guest view.' }, 403)

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: DEMO_EMAIL })
  if (error || !data?.properties?.hashed_token) return json({ error: error?.message || 'Could not open guest view.' }, 500)
  return json({ token_hash: data.properties.hashed_token })
})
