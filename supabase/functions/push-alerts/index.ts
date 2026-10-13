// Lock-screen alerts (owner, 13 Oct): called every 30 s by pg_cron. Asks the database what is due
// (rpc push_due: 5 min left, time up, new online bookings / payments to check — each marked sent in the
// same step, so calling this again never repeats a push) and sends a web push to every staff / admin phone
// that switched alerts on. Safe to call from anywhere: it only ever sends what is due. Uses the service role.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const body = await req.json().catch(() => ({}))

  // "Send a test alert" from ⚙ → Phone alerts: only to a phone that is already switched on.
  if (body.test && body.endpoint) {
    const { data: sub } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').eq('endpoint', body.endpoint).is('disabled_at', null).maybeSingle()
    if (!sub) return Response.json({ error: 'This phone is not switched on.' }, { status: 404, headers: cors })
    const { data: keys } = await db.rpc('push_config')
    webpush.setVapidDetails('mailto:alerts@grandxgamer.app', keys.public, keys.private)
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: 'GRANDXGAMER test alert', body: 'Lock-screen alerts work on this phone.', tag: 'test', urgent: false, url: '/#/shop/slots' }), { TTL: 60, urgency: 'high' })
      return Response.json({ sent: 1 }, { headers: cors })
    } catch (e) {
      return Response.json({ error: String((e as Error).message || e) }, { status: 502, headers: cors })
    }
  }

  const { data: due, error } = await db.rpc('push_due')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!due?.length) return Response.json({ sent: 0 })

  const { data: keys } = await db.rpc('push_config')
  webpush.setVapidDetails('mailto:alerts@grandxgamer.app', keys.public, keys.private)

  const gone: string[] = []
  let sent = 0
  await Promise.all(due.map(async (a: Record<string, unknown>) => {
    const payload = JSON.stringify({ title: a.title, body: a.body, tag: a.tag, urgent: a.urgent, url: '/#/shop/slots' })
    try {
      await webpush.sendNotification({ endpoint: a.endpoint as string, keys: { p256dh: a.p256dh as string, auth: a.auth as string } },
        payload, { TTL: 600, urgency: 'high' })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) gone.push(a.endpoint as string)
    }
  }))
  if (gone.length) await db.rpc('push_drop', { p_endpoints: [...new Set(gone)] })
  return Response.json({ sent, gone: gone.length })
})
