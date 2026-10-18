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
