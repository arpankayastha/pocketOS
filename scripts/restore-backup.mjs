#!/usr/bin/env node
// Restores an eChopdo backup (echopdo-backup-….json.gz from Google Drive) into a Supabase project.
//   node scripts/restore-backup.mjs <file.json.gz> --dry-run
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… node scripts/restore-backup.mjs <file.json.gz> [--owner <new user id>]
// For a fresh project: apply supabase/schema.sql, sign in once with Google (that creates the owner user), delete the
// starter household it seeds, then run this with --owner <that user's id> so every row belongs to the new owner.
// Household member logins and phone pairings are NOT restored (made again in Settings → Households / Phone widget); the vault stays
// encrypted exactly as it was, so the same master password / recovery code opens it.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const dry = args.includes('--dry-run')
const ownerIdx = args.indexOf('--owner')
const newOwner = ownerIdx >= 0 ? args[ownerIdx + 1] : null
if (!file) { console.error('Usage: restore-backup.mjs <file.json.gz> [--dry-run] [--owner <new user id>]'); process.exit(1) }

const backup = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'))
if (backup.app !== 'eChopdo' || backup.format !== 1) { console.error('Not an eChopdo backup file.'); process.exit(1) }
console.log(`Backup from ${backup.created_at}:`)
for (const [t, n] of Object.entries(backup.counts)) console.log(`  ${t.padEnd(18)} ${n}`)
if (dry) process.exit(0)

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1) }
const db = createClient(url, key, { auth: { persistSession: false } })

// Parents before children.
const ORDER = ['households', 'accounts', 'categories', 'hisab_books', 'hisab_categories', 'recurring_items', 'dues', 'due_entries', 'budgets',
  'transactions', 'hisab_entries', 'capture_rules', 'captures', 'vault_unlockers', 'vault_items', 'wills', 'will_versions', 'will_log']
// Rows made by a household member login (they have no account in a fresh project) go to the owner, as when a login is
// removed in the app; a member's own vault unlockers are dropped (members get theirs again from Settings → Households).
const mine = (row) => row.user_id === backup.owner
const remap = (row) => (newOwner && row.user_id ? { ...row, user_id: newOwner } : row)

for (const t of ORDER) {
  const all = backup.tables[t] || []
  const rows = (newOwner && t === 'vault_unlockers' ? all.filter(mine) : all).map(remap)
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from(t).upsert(rows.slice(i, i + 200), { onConflict: 'id' })
    if (error) { console.error(`${t}: ${error.message}`); process.exit(1) }
  }
  console.log(`restored ${t}: ${rows.length}`)
}
console.log('Done. Household member logins are made again in Settings → Households.')
