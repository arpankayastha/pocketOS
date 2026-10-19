// Bank SMS from the café's phone (GRANDXGAMER Android app). No user JWT: a paired phone holds a device token
// (public.shop_bank_phones, SHA-256 stored). The phone reads the bank's "money received" SMS itself and sends
// only the parsed fields — the SMS text never leaves it. Deployed with verify_jwt = false; every action checks
// the token itself. Uses the service role.
//   { action: 'pair', code, name, version }            → { token, shop }
//   { action: 'ping', token, version }                 → { ok, shop }
//   { action: 'capture', token, amount, at, ref, payer, bank, account_hint }
//                                                      → { id, matched, match: { kind, label } } | { duplicate }
// A capture is matched on arrival (rpc bank_sms_capture → private.match_payment_in): a waiting online booking /
// event advance / tournament fee of that amount is marked received; else a session whose online part is that
// amount is linked; else it waits on Cash → UPI received.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const clean = (s: unknown, max = 200) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null)
function instantOf(v: unknown) {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isFinite(t) && t > Date.UTC(2026, 0, 1) && t < Date.now() + 3600_000 ? new Date(t).toISOString() : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const action = body.action
  const shopName = async (hid: string) => (await db.from('households').select('name').eq('id', hid).single()).data?.name || 'GRANDXGAMER'

  if (action === 'pair') {
    const code = String(body.code || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    if (code.length < 6) return json({ error: 'Enter the code shown in GRANDXGAMER → ⚙ → Bank SMS phone.' }, 400)
    const { data: ph } = await db.from('shop_bank_phones').select('id, household_id, pair_expires, token_hash')
      .eq('pair_code_hash', await sha256(code)).maybeSingle()
    if (!ph || ph.token_hash || !ph.pair_expires || new Date(ph.pair_expires).getTime() < Date.now()) {
      return json({ error: 'That code has expired or is wrong. Make a new one in GRANDXGAMER → ⚙ → Bank SMS phone.' }, 400)
    }
    const token = randomToken()
    const { error } = await db.from('shop_bank_phones').update({
      token_hash: await sha256(token), pair_code_hash: null, pair_expires: null, paired_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(), name: clean(body.name, 60) || 'Shop phone', app_version: clean(body.version, 20),
    }).eq('id', ph.id)
    if (error) return json({ error: error.message }, 500)
    return json({ token, shop: await shopName(ph.household_id) })
  }

  const token = String(body.token || '')
  if (!token) return json({ error: 'This phone is not paired.', unpaired: true }, 401)
  const { data: ph } = await db.from('shop_bank_phones').select('id, household_id').eq('token_hash', await sha256(token)).maybeSingle()
  if (!ph) return json({ error: 'This phone was removed in GRANDXGAMER. Pair it again.', unpaired: true }, 401)
  await db.from('shop_bank_phones').update({ last_seen_at: new Date().toISOString(), ...(clean(body.version, 20) ? { app_version: clean(body.version, 20) } : {}) }).eq('id', ph.id)

  if (action === 'ping') return json({ ok: true, shop: await shopName(ph.household_id) })

  if (action === 'capture') {
    const amount = Math.round(Number(body.amount) * 100) / 100
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e7) return json({ error: 'No amount.' }, 400)
    const { data, error } = await db.rpc('bank_sms_capture', {
      p_household: ph.household_id, p_phone: ph.id,
      p: { amount, at: instantOf(body.at) || new Date().toISOString(), ref: clean(body.ref, 60), payer: clean(body.payer, 80), bank: clean(body.bank, 30), account_hint: clean(body.account_hint, 8) },
    })
    if (error) return json({ error: error.message }, 500)
    return json(data)
  }
  return json({ error: 'Unknown action.' }, 400)
})
