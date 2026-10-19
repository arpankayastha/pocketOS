# GRANDXGAMER shop phone app (Android)

A small native app for the café's Android phone that receives the bank's SMS. Installed from
https://grandxgamer.vercel.app/download/ (not the Play Store). Package `app.grandxgamer` (this folder was the
eChopdo app on `main`; on the `grandxgamer` branch it is GRANDXGAMER's own app — the branches never merge).

- **Launcher icon → `MainActivity` → the GRANDXGAMER web app** full screen in Chrome (Trusted Web Activity,
  `TwaLauncher`); needs `/.well-known/assetlinks.json` with this app's signing-key SHA-256 or Chrome shows a URL bar.
  If Chrome doesn't open within 8 s, or the app crashed last time, it explains and offers Try again / Open in
  Chrome / Bank SMS settings / Copy error report.
- **Bank SMS** (`SmsParser` — the same generic bank-SMS reader as eChopdo, any bank; `Captures`, `SmsReceiver`):
  only **money received** is sent, as { amount, at, ref, payer, bank, account_hint } to the Edge Function
  `bank-sms` (action `capture`) — never the SMS text; money out, OTPs, offers and card bills are only logged.
  The server matches it (an online booking / event advance / tournament fee → received; else a session paid
  online → "✓ seen in bank"; else Cash → UPI received) and the notification says "₹160 received from X · ✓ …".
  Offline: queued (`SyncWorker`). Every bank SMS is logged on the phone only (`SmsLogActivity`, last 300).
  Needs RECEIVE_SMS/READ_SMS — Android 13+ hides these for sideloaded apps until App info → ⋮ → *Allow
  restricted settings* (the app walks through it).
- **Pairing** (`PairActivity`, also the bank SMS / updates screen): GRANDXGAMER → ⚙ → Bank SMS phone → Pair the
  shop phone shows an 8-character code (`grandxgamer://pair?code=…`). The phone gets a device token
  (`shop_bank_phones`, SHA-256 stored) that can only send payments for that shop.
- **Updates** (`Updates.kt`): every 6 h / on open it reads `/download/version.json`; a newer `versionCode` is
  downloaded, its SHA-256 and signing key checked, and installed with `PackageInstaller` (needs "Install unknown
  apps" for the app once).
- **Play Protect** blocks installing an SMS-reading APK from a browser: pause *Scan apps with Play Protect* for the
  install, then turn it back on (the download page explains).

## Build
JDK 17+, Android SDK (platform 36; `local.properties` → `/opt/android-sdk` here).

    ./gradlew testDebugUnitTest          # SmsParser, Captures (money in only), launch screen
    ./gradlew assembleDebug

Release: bump `gx.versionCode` / `gx.versionName` in `gradle.properties`, then

    GX_KEYSTORE_PASSWORD=… ./build-release.sh

It decrypts `release.keystore.enc` (AES-256-CBC, pbkdf2; the password is the owner's — keep it in the
GRANDXGAMER Vault), runs the tests, signs the APK into `../public/download/grandxgamer.apk` and writes
`version.json`. **Always sign with this key** — another key breaks updates and assetlinks.
Signing key SHA-256: `B8:63:66:7C:26:46:C7:D1:09:EF:CA:E3:AF:A6:89:77:94:5A:DD:16:14:F5:48:B7:40:0F:9A:08:90:5E:E7:31`
