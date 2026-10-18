# Backup to Google Drive

Every Saturday 20:30 UTC (Sunday 02:00 IST) a `pg_cron` job calls the `backup` Edge Function, which saves everything
to the owner's Google Drive (folder **eChopdo backups**, newest 8 kept). Settings → **Backup to Google Drive** connects
it (one tap), shows the last backup and has **Back up now**.

- **What's in a file:** `echopdo-backup-YYYY-MM-DD-HHMM.json.gz` — Budget / Hisab / Plan / Dues rows as JSON; `vault_*`,
  `wills*` exactly as stored (still encrypted). Phone pairings (`quick_devices`) and sign-up tickets are not saved.
- **Access:** Google scope `drive.file` only (the app sees just the files it created). The refresh token is in
  `public.backup_settings` (RLS on, no API access); the cron secret is in the database Vault (`backup_cron_secret`) and checked
  by `public.backup_cron_ok`.
- **Secrets:** Edge Function secret `GOOGLE_CLIENT_SECRET` (the Web OAuth client's secret). The client id is public and built in.
- **Google Cloud:** the OAuth consent screen must be **In production** with only the `drive.file` scope, otherwise Google
  expires the long-term token after 7 days.
- **Restore:** `node scripts/restore-backup.mjs <file.json.gz> --dry-run` shows what's inside; see the header of that script
  for restoring into a fresh project.

## What a restore does and doesn't bring back
- **Brought back:** every Budget / Hisab / Plan / Dues / captures row, categories, accounts, and the encrypted Vault, Emergency sheet and Will, exactly as they were.
- **Not in the file (made again by hand):** the database structure and functions (apply `supabase/schema.sql`, redeploy `supabase/functions/*`, set the secrets), the owner's Google login (sign in once), household member logins and their PINs, and phone pairings (`quick_devices`).
- **Vault access after a restore:** the same master password / recovery code opens it. A member's own unlocker is dropped; **Enable Vault** for them again.
- The restore script has not been rehearsed on a real second project — do a dry run (`--dry-run`) on a downloaded backup now and then.
