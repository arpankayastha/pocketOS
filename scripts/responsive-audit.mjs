// Responsive audit: opens every main screen and sheet of a built copy of the app (fake backend, made-up data)
// at the common phone sizes and reports what doesn't fit. Run it before pushing any UI change:
//   npm run test:responsive            (all sizes)      npm run test:responsive -- 360,393   (just these widths)
// Needs Playwright with a Chromium (the cloud box has one; locally `npx playwright install chromium`).
// Hard fails (exit 1): the page is wider than the screen (Chrome / Safari would shrink it and you'd have to zoom).
// Warnings: a sheet taller than the screen, tap targets under 32 px, a step that couldn't be reached.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const { chromium } = await import('playwright').catch(() => import(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright/index.mjs'))

// CSS px widths of real phones: small Android / iPhone SE, 360-wide Androids (A34, S21 FE), iPhone 12-16, S24 Ultra, Pixel, Pro Max.
const ALL_WIDTHS = [320, 360, 375, 384, 390, 393, 412, 414, 430]
const widths = (process.argv[2] ? process.argv[2].split(',').map(Number) : ALL_WIDTHS)
const heightOf = (w) => (w <= 320 ? 568 : w <= 375 ? 700 : 800)

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'echopdo-audit-'))
const dist = path.join(out, 'dist')
const shots = path.join(out, 'shots')
fs.mkdirSync(shots)
console.log('building a test copy…')
execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: root, stdio: 'ignore', env: { ...process.env, VITE_SUPABASE_URL: 'https://fake.supabase.co', VITE_SUPABASE_ANON_KEY: 'fakekey' } })

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/json', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  let p = path.join(dist, decodeURIComponent(req.url.split('?')[0]))
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dist, 'index.html')
  res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res)
}).listen(0)
const base = `http://localhost:${server.address().port}/`

// ── fake backend with made-up data ──────────────────────────────────────────────────────────────
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', role: 'authenticated', exp: 4102444800 })}.sig`
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'test.user.with.a.long.address@example.com', app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Test User' }, created_at: '2026-01-01T00:00:00Z' }
const session = { access_token: jwt, refresh_token: 'r', expires_at: 4102444800, expires_in: 99999999, token_type: 'bearer', user }
const today = new Date().toISOString().slice(0, 10)
const H = 'h1'
const dataFor = (status) => ({
  households: [{ id: H, user_id: 'u1', name: 'A household with a rather long name', color: '#5d6dc4', start_tab: 'dashboard', hidden_instruments: [], created_at: '2026-01-01' }, { id: 'h2', user_id: 'u1', name: 'Parents', color: '#16a34a', start_tab: 'dashboard', hidden_instruments: [], created_at: '2026-01-02' }],
  signup_requests: [{ user_id: 'u1', email: user.email, name: 'Test User', status, is_admin: status === 'approved', created_at: '2026-01-01' }, { user_id: 'u2', email: 'someone.else@example.com', name: 'Someone Else With A Long Name', status: 'pending', is_admin: false, created_at: today }],
  categories: ['Salary:income', 'Groceries:expense', 'Rent:expense', 'Transport:expense', 'Dining out:expense'].map((s, i) => ({ id: 'c' + i, household_id: H, name: s.split(':')[0], kind: s.split(':')[1], color: '#f97316' })),
  accounts: [{ id: 'a1', household_id: H, name: 'Cash', type: 'cash', color: '#22c55e', opening_balance: 0, digits: [] }, { id: 'a2', household_id: H, name: 'A very long credit card account name', type: 'credit', color: '#3b82f6', opening_balance: 0, digits: ['1234'], statement_day: 15, due_day: 3 }],
  transactions: [{ id: 't1', household_id: H, kind: 'expense', amount: 1250, date: today, category_id: 'c1', account_id: 'a1', note: 'A long note about groceries from the weekly market trip and more', created_at: today }],
  recurring_items: [{ id: 'r0', household_id: H, name: 'Salary', kind: 'income', category: 'Salary', expected_amount: 90000, day_of_month: 1, active: true }, { id: 'r1', household_id: H, name: 'House rent for the flat', kind: 'expense', category: 'Rent', expected_amount: 25000, day_of_month: 5, active: true }],
  hisab_books: [{ id: 'b1', household_id: H, name: 'Daily', kind: 'daily', created_at: today }, { id: 'b2', household_id: H, name: 'Diwali shopping and sweets', kind: 'occasion', target: 50000, created_at: today }],
  hisab_entries: [
    { id: 'e1', household_id: H, book_id: 'b1', direction: 'out', amount: 450.5, occurred_on: today, category: 'Food', source: 'UPI', note: 'Lunch with a really long note that keeps going on', created_at: today },
    ...[[1, 1850, 'Food'], [3, 420, 'Fuel'], [4, 3200, 'Shopping'], [6, 640, 'Food'], [9, 1200, 'Food'], [10, 2800, 'Medical'], [12, 540, 'Fuel'], [15, 8900, 'Travel'], [16, 1450, 'Food'], [19, 2100, 'Shopping']]
      .map(([d, a, c], i) => ({ id: 'x' + i, household_id: H, book_id: 'b1', direction: 'out', amount: a, occurred_on: today.slice(0, 8) + String(d).padStart(2, '0'), category: c, source: 'UPI', note: c, created_at: today })),
    { id: 'rent', household_id: H, book_id: 'b1', direction: 'out', amount: 25000, occurred_on: today.slice(0, 8) + '05', category: 'Housing', source: 'UPI', note: 'House rent', recurring_item_id: 'r1', created_at: today },
    { id: 'in1', household_id: H, book_id: 'b1', direction: 'in', amount: 5000, occurred_on: today.slice(0, 8) + '08', category: 'Refund', source: 'Cash', note: 'Returned', created_at: today },
  ],
  hisab_categories: [{ id: 'hc1', household_id: H, direction: 'out', name: 'Food', icon: '🍽️', position: 0 }, { id: 'hc2', household_id: H, direction: 'in', name: 'Salary', icon: '💼', position: 0 }],
  dues: [{ id: 'd1', household_id: H, person: 'Ramesh Kumar', created_at: today }],
  due_entries: [{ id: 'de1', household_id: H, due_id: 'd1', direction: 'out', amount: 50000, date: today }],
  loans: [{ id: 'l1', household_id: H, user_id: 'u1', kind: 'home', name: 'Home loan', lender: 'Some Bank', principal: 5000000, rate: 8.5, tenure_months: 240, emi: 43391, start_date: '2025-01-10', interest_only: false, events: [], shared_with: [], created_at: today }, { id: 'l2', household_id: H, user_id: 'u1', kind: 'gold', name: 'Gold loan', lender: 'Another Bank', principal: 300000, rate: 9, start_date: '2025-06-01', interest_only: true, due_date: '2026-12-01', grams: 40, events: [], shared_with: [], created_at: today }],
  property_deals: [{ id: 'p1', household_id: H, name: 'New flat', kind: 'buy', price: 8500000, checklist: [{ id: 'k1', label: 'Sale agreement', done: true, where: '', note: '' }], archived: false, created_at: today }],
  lists: [{ id: 'L1', household_id: H, user_id: 'u1', name: 'Groceries', icon: '🛒', kind: 'list', sections: ['Vegetables', 'Dairy'], shared_with: [], tabs: [], is_template: false, archived: false, created_at: today }, { id: 'L2', household_id: H, user_id: 'u1', name: 'Griha pravesh', icon: '🏠', kind: 'occasion', sections: [], shared_with: [], tabs: ['tasks', 'samagri', 'people'], event_date: '2026-12-12', event_time: '07:00', place: 'New flat', is_template: false, archived: false, created_at: today }],
  list_items: [{ id: 'i1', list_id: 'L1', household_id: H, tab: 'items', name: 'Onions', qty: '2 kg', section: 'Vegetables', done: false, cleared: false, created_at: today }, { id: 'i3', list_id: 'L2', household_id: H, tab: 'tasks', name: 'Book pandit', due_date: '2026-12-01', assignee: 'Asha', done: false, cleared: false, created_at: today }],
  captures: [], quick_devices: [], household_members: [], vault_items: [], vault_unlockers: [],
})

async function newContext(browser, w, { signedIn = true, status = 'approved' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: heightOf(w) }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' })
  if (signedIn) await ctx.addInitScript((s) => { try { localStorage.setItem('sb-fake-auth-token', JSON.stringify(s)) } catch { /* ignore */ } }, session)
  const data = dataFor(status)
  await ctx.route('https://fake.supabase.co/**', async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    const json = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (p.startsWith('/auth/v1/user')) return json(user)
    if (p.includes('passkey')) return json([])
    if (p.startsWith('/auth/v1')) return json({ ...session })
    if (p.startsWith('/rest/v1/rpc/')) return json([])
    if (p.startsWith('/functions/')) return json({})
    if (p.startsWith('/rest/v1/')) {
      const t = p.split('/')[3]
      if (req.method() !== 'GET' && req.method() !== 'HEAD') return json([], req.method() === 'POST' ? 201 : 200)
      let rows = data[t] || []
      // honour simple `column=eq.value` filters, like PostgREST (an app asking for one row must get one)
      for (const [k, v] of new URL(req.url()).searchParams) if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3))
      if ((req.headers().accept || '').includes('vnd.pgrst.object')) {
        return rows[0] ? json(rows[0]) : json({ code: 'PGRST116', details: 'The result contains 0 rows', message: '0 rows' }, 406)
      }
      return json(rows)
    }
    return json({})
  })
  return ctx
}

// ── the measuring ───────────────────────────────────────────────────────────────────────────────
const results = []
async function check(page, w, label) {
  await page.waitForTimeout(450)
  const r = await page.evaluate(() => {
    const iw = window.innerWidth, ih = window.innerHeight
    const visible = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
    const bad = []
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue
      const b = el.getBoundingClientRect()
      if (b.right <= iw + 1 && b.left >= -1) continue
      let p = el.parentElement, scrolled = false
      while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.getBoundingClientRect().right <= iw + 1) { scrolled = true; break } p = p.parentElement }
      if (!scrolled) bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(b.right)} "${(el.textContent || '').trim().slice(0, 22)}"`)
    }
    const tall = [...document.querySelectorAll('.modal')].filter(visible).filter((m) => m.getBoundingClientRect().height > ih + 1 && getComputedStyle(m).overflowY === 'visible').length
    const small = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')].filter(visible).filter((el) => {
      const b = el.getBoundingClientRect(); const t = el.type
      if (t === 'checkbox' || t === 'radio' || t === 'range') return false
      // a big invisible hit area drawn with ::after / ::before counts (e.g. the 22 px tick box has a 44 px one)
      let w = b.width, h = b.height
      for (const ps of ['::after', '::before']) {
        const c = getComputedStyle(el, ps)
        if (c.content !== 'none' && c.position === 'absolute') { w = Math.max(w, parseFloat(c.width) || 0); h = Math.max(h, parseFloat(c.height) || 0) }
      }
      return h < 32 || w < 32
    }).map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`)
    return { iw, sw: document.documentElement.scrollWidth, bad: bad.slice(0, 3), tall, small: [...new Set(small)].slice(0, 4), nsmall: small.length }
  })
  const fail = r.sw > r.iw + 1 || r.bad.length > 0
  const warns = []
  if (r.tall) warns.push('sheet taller than screen and not scrollable')
  if (r.nsmall) warns.push(`${r.nsmall} small tap target(s) e.g. ${r.small.join(', ')}`)
  results.push({ w, label, fail, detail: fail ? `scrollWidth ${r.sw} > ${r.iw}; ${r.bad.join(' | ')}` : '', warns })
  if (fail || warns.length || process.env.AUDIT_ALL_SHOTS) await page.screenshot({ path: path.join(shots, `w${w}-${label.replace(/\W+/g, '_')}.png`), fullPage: !!process.env.AUDIT_FULL })
}
const errorsOf = new WeakMap()
const watch = (page) => { const errs = []; errorsOf.set(page, errs); page.on('pageerror', (e) => errs.push(e.message.split('\n')[0].slice(0, 110))) }
const step = async (page, w, label, fn, { measure = true } = {}) => {
  try {
    await fn(); if (measure) await check(page, w, label)
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))) // closes any swiped-open row
    await page.waitForTimeout(250)
    const errs = errorsOf.get(page) || []
    if (errs.length) { results.push({ w, label, fail: true, detail: `script error on this screen: ${errs.join(' | ')}`, warns: [] }); errs.length = 0 }
  } catch (e) {
    const seen = process.env.AUDIT_DEBUG ? ' | page: ' + (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 120) : ''
    results.push({ w, label, fail: false, detail: '', warns: [`couldn't reach this step (${e.message.split('\n')[0].slice(0, 60)})${seen}`] })
  }
}
const clickBy = (page, sel, text) => page.evaluate(([sel, text]) => {
  const el = [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.trim().toLowerCase().includes(text.toLowerCase()))
  if (!el) throw new Error(`no ${sel} "${text || ''}"`); el.click()
}, [sel, text])
// Swipe a row with real touch events (Chrome DevTools protocol), then require its quick-action buttons to be showing.
async function swipeOpen(page, sel, dx) {
  await page.waitForSelector(sel, { timeout: 6000 })
  const box = await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }, sel)
  if (!box) throw new Error(`no ${sel}`)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: box.y }] })
  await touch('touchStart', box.x)
  for (let i = 1; i <= 8; i++) await touch('touchMove', box.x + (dx * i) / 8)
  await touch('touchEnd', box.x + dx)
  await page.waitForTimeout(400)
  const shown = await page.evaluate(() => [...document.querySelectorAll('.sw-under')].filter((u) => u.style.visibility === 'visible').reduce((n, u) => n + u.querySelectorAll('.sw-act').length, 0))
  if (!shown) throw new Error('the swipe did not reveal any action')
}
const closeTop = (page) => page.evaluate(() => { const m = [...document.querySelectorAll('.modal-bg, .dialog-bg')].pop(); m?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })

const browser = await chromium.launch()
for (const w of widths) {
  // signed out, and a signed-in account that isn't approved yet
  let ctx = await newContext(browser, w, { signedIn: false })
  let page = await ctx.newPage(); await page.goto(base)
  await step(page, w, 'sign-in', async () => { await page.waitForSelector('.auth') })
  await step(page, w, 'sign-in · household login', async () => { await clickBy(page, '.auth button', 'Household login') })
  await ctx.close()
  ctx = await newContext(browser, w, { status: 'pending' }); page = await ctx.newPage(); await page.goto(base)
  await step(page, w, 'waiting for approval', async () => { await page.waitForSelector('.auth') })
  await ctx.close()

  ctx = await newContext(browser, w); page = await ctx.newPage(); watch(page); await page.goto(base)
  const appUp = await page.waitForSelector('.pill-bar', { timeout: 15000 }).then(() => true).catch(() => false)
  if (!appUp) {
    const seen = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 140)
    results.push({ w, label: 'signed-in app', fail: true, detail: `the app did not load — page shows: "${seen}"`, warns: [] })
    await ctx.close(); continue
  }
  await step(page, w, 'home', async () => {})
  for (const tab of ['Month', 'Loans', 'Hisab']) {
    await step(page, w, `tab ${tab}`, async () => { await clickBy(page, '.pill-bar button', tab) })
    for (const s of await page.$$eval('.subnav button', (bs) => bs.map((b) => b.textContent.trim())).catch(() => [])) {
      await step(page, w, `${tab} · ${s}`, async () => { await clickBy(page, '.subnav button', s) })
    }
  }
  // sheets and forms
  await step(page, w, 'Hisab · add entry', async () => { await clickBy(page, '.pill-bar button', 'Hisab'); await page.waitForTimeout(500); await page.click('.fab', { force: true }); await page.waitForSelector('.modal') })
  await closeTop(page)
  await step(page, w, 'Loans · new loan', async () => { await clickBy(page, '.pill-bar button', 'Loans'); await clickBy(page, '.subnav button', 'Loans'); await clickBy(page, 'button', '+ New loan'); await page.waitForSelector('.modal') })
  await closeTop(page)
  await step(page, w, 'Loans · open loan', async () => { await clickBy(page, '.due-card', 'Home loan'); await page.waitForSelector('.modal') })
  await closeTop(page)
  await step(page, w, 'Loans · gold loan', async () => { await clickBy(page, '.due-card', 'Gold loan'); await page.waitForSelector('.modal') })
  await closeTop(page)
  await step(page, w, 'Deals · open deal', async () => { await clickBy(page, '.subnav button', 'Deals'); await clickBy(page, '.due-card', 'New flat'); await page.waitForSelector('.modal') })
  await closeTop(page)
  await step(page, w, 'Entries · add expense', async () => { await clickBy(page, '.pill-bar button', 'Month'); await page.click('.fab', { force: true }); await clickBy(page, '.fab-option', 'Expense'); await page.waitForSelector('.modal') })
  await closeTop(page)
  await step(page, w, 'Hisab · calendar', async () => { await clickBy(page, '.pill-bar button', 'Hisab'); await page.waitForSelector('.hb-swipe'); await clickBy(page, '.hb-swipe button', 'Calendar'); await page.waitForSelector('.hb-cal-grid') })
  await step(page, w, 'Hisab · calendar day', async () => { await clickBy(page, '.hb-cal-day.today', '') })
  await step(page, w, 'Hisab · summary', async () => { await clickBy(page, '.hb-swipe button', 'Summary'); await page.waitForSelector('.hb-stack') })
  await step(page, w, 'Hisab · back to daily', async () => { await clickBy(page, '.hb-swipe button', 'Daily') })
  await step(page, w, 'swipe · Hisab entry', async () => { await clickBy(page, '.pill-bar button', 'Hisab'); await page.waitForTimeout(500); await swipeOpen(page, '.hb-entry', -170) })
  await step(page, w, 'swipe · Entry', async () => { await clickBy(page, '.pill-bar button', 'Month'); await clickBy(page, '.subnav button', 'Entries'); await swipeOpen(page, '.txn', -170) })
  await step(page, w, 'swipe · Plan line (right)', async () => { await clickBy(page, '.subnav button', 'Plan'); await swipeOpen(page, '.txn', 120) })
  await step(page, w, 'swipe · Loan card', async () => { await clickBy(page, '.pill-bar button', 'Loans'); await clickBy(page, '.subnav button', 'Loans'); await swipeOpen(page, '.due-card', -170) })
  await step(page, w, 'swipe · Due card (right)', async () => { await clickBy(page, '.subnav button', 'Dues'); await swipeOpen(page, '.due-card', 120) })
  await step(page, w, 'household menu', async () => { await clickBy(page, '.hh-chip', ''); await page.waitForSelector('.hh-menu') })
  await page.evaluate(() => document.querySelector('.hh-backdrop')?.click())
  // settings, every card opened
  await step(page, w, 'settings', async () => { await clickBy(page, '.settings-btn', '') })
  // every Settings section, with all its cards opened
  for (const label of await page.$$eval('.settings .subnav button', (bs) => bs.map((b) => b.textContent.trim())).catch(() => [])) {
    await step(page, w, `settings · ${label} · all cards open`, async () => {
      await clickBy(page, '.settings .subnav button', label); await page.waitForTimeout(300)
      await page.evaluate(() => document.querySelectorAll('.coll:not(.open) .coll-toggle').forEach((b) => b.click()))
    })
  }
  // other modules
  await step(page, w, 'Vault', async () => { await clickBy(page, '.module-switch button', 'Vault') })
  await step(page, w, 'Lists', async () => { await clickBy(page, '.module-switch button', 'Lists') })
  await step(page, w, 'Lists · new', async () => { await page.click('.fab', { force: true }); await page.waitForSelector('.modal') })
  await closeTop(page)
  await step(page, w, 'swipe · Lists card', async () => { await swipeOpen(page, '.ls-card', -170) })
  await step(page, w, 'Lists · a list', async () => { await clickBy(page, '.ls-card-main', 'Groceries') })
  await step(page, w, 'swipe · list item (left)', async () => { await swipeOpen(page, '.ls-row', -170) })
  await step(page, w, 'swipe · list item (right)', async () => { await swipeOpen(page, '.ls-row', 130) })
  await step(page, w, 'Lists · share list', async () => { await clickBy(page, 'button', 'Share'); await page.waitForSelector('.share-sheet') })
  await closeTop(page)
  await step(page, w, 'Lists · an occasion', async () => { await clickBy(page, '.ls-back', 'Lists'); await clickBy(page, '.ls-seg button', 'Occasions'); await clickBy(page, '.ls-card-main', 'Griha') })
  await step(page, w, 'Lists · share occasion', async () => { await clickBy(page, 'button', 'Share'); await page.waitForSelector('.share-sheet') })
  await ctx.close()
}
await browser.close(); server.close()

// ── report ──────────────────────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => r.fail)
const warned = results.filter((r) => r.warns.length)
console.log(`\nchecked ${results.length} screens across ${widths.length} widths (${widths.join(', ')} px)`)
if (fails.length) { console.log(`\nWIDER THAN THE SCREEN — ${fails.length}:`); fails.forEach((r) => console.log(`  ${r.w}px  ${r.label}: ${r.detail}`)) }
if (warned.length) {
  const byLabel = new Map()
  for (const r of warned) for (const x of r.warns) { const k = `${r.label} — ${x.replace(/\d+ small/, 'N small')}`; byLabel.set(k, [...(byLabel.get(k) || []), r.w]) }
  console.log(`\nwarnings — ${byLabel.size}:`); for (const [k, ws] of byLabel) console.log(`  ${k}  [${ws.join(', ')}]`)
}
if (!fails.length) console.log('\nOK: nothing is wider than the screen at any size.')
console.log(`screenshots of anything flagged: ${shots}`)
process.exit(fails.length ? 1 : 0)
