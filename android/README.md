# eChopdo Android app (quick-add widget)

A small native app, installed from https://echopdo.vercel.app/download/ (not the Play Store).

- **Launcher icon → `MainActivity` → the whole eChopdo web app**, full screen in Chrome (Trusted Web Activity via `TwaLauncher`, always Chrome when installed — Samsung Internet is often the default browser and has no eChopdo login), so login,
  vault fingerprint and passkeys are the same as the installed web app. Needs
  `/.well-known/assetlinks.json` on the site with this app's signing-key SHA-256, or Chrome shows a URL bar.
- `MainActivity` shows its own start screen; if Chrome doesn't open within 8 s, or the app crashed last time (`App` saves the stack trace), it shows the error with Try again / Open in Chrome / Copy error report. No R8 minify (kept simple; APK ≈ 4 MB).
- **Quick add** (`QuickAddActivity`): a sheet over the home screen — Hisab (default) or Budget, calculator
  keypad, category / book / source (or account) chips, date, note, Save / Save & next. Opened from the
  widget, the app-icon shortcuts (Spent / Received) and the quick-settings tile "eChopdo +".
- **Widgets** (icons only): `QuickWidget` (large, resizable) — − / + round buttons, up to 3 icon chips of the
  household's frequent Hisab entries (same category + amount ≥ 2× in 60 days, one tap saves, Undo in a
  notification for 15 min), a "N to add" badge and, when ≥ 120 dp tall, two rows of bank payments to add with
  a one-tap ✓. `QuickWidgetSmall` (2×1) — just − / + and the badge.
- **Bank SMS capture** (`SmsParser`, `Captures`, `SmsReceiver`): off until turned on in Phone settings
  (`PairActivity`, also an icon shortcut); needs RECEIVE_SMS/READ_SMS — Android 13+ hides these for sideloaded
  apps until App info → ⋮ → *Allow restricted settings* (the app walks through it). Any business (DLT) sender
  (`XX-HEADER[-S]`) is read, for any bank: a generic reader needs an amount, a debit/credit word and a masked
  account/card number (or a bank-looking header), skips balance/limit amounts, OTP / due / request / offer
  messages, and pulls payee (VPA, `UPI-…-NAME`, `UPI/P2M/…/NAME`, to/at/from/towards/Info:), UPI ref/RRN/UTR and
  the date in any common format. Exact rules for BoB, Federal, ICICI and Kotak run first. Only the parsed fields go to
  the server (`capture` action) — never the SMS text. A notification offers ✓ <remembered category> / Change… /
  Ignore (or "Same, skip" when it matches an entry added by hand); "Change…" opens the quick-add sheet in
  capture mode (amount fixed, no keypad, "Always add <payee> like this"). "Look back 3 days" scans the inbox
  once. Offline captures queue like entries.
- **Pairing** (`PairActivity`): eChopdo → ⚙ Settings → Phone widget → Pair a phone → "Pair this phone"
  (opens `echopdo://pair?code=…`) or type the code. The phone gets a device token for one household.
- **Server**: `supabase/functions/quickadd` (verify_jwt off; the device token is the auth) + table
  `quick_devices`. The token can only add entries, undo its own for 15 min, and read picker names.
- **Offline**: entries wait in SharedPreferences and a WorkManager job sends them when back online.
- **Updates**: once a day the app reads `/download/version.json`; if `versionCode` is higher it shows a
  banner linking to the download page.

## Build
Needs JDK 17+ and the Android SDK (platform 36, build-tools 36). Maven Central rate-limits some build
machines, so `settings.gradle.kts` lists Google's Maven Central mirror first.

    ./gradlew testDebugUnitTest          # Robolectric UI tests (+ screenshots with ECHOPDO_SHOTS=dir)
    ./gradlew assembleDebug              # unsigned-for-release debug build

Release (what the download page serves): bump `echopdo.versionCode` / `versionName` in
`gradle.properties`, then

    ECHOPDO_KEYSTORE_PASSWORD=… ./build-release.sh

It decrypts `release.keystore.enc` (AES-256, the password is in the owner's eChopdo Vault), runs the
tests, builds and signs the APK into `../public/download/echopdo.apk` and writes `version.json`.
**Always sign with this key** — a different key means phones can't update and assetlinks breaks.
Signing key SHA-256: `7E:EF:CC:41:E4:07:5E:FA:8B:61:C9:9A:75:B1:82:8D:D4:1D:5B:EB:32:18:EB:0C:62:B4:05:7F:A9:CD:96:6E`
