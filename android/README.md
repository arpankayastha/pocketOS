# eChopdo Android app (quick-add widget)

A small native app, installed from https://echopdo.vercel.app/download/ (not the Play Store).

- **Launcher icon → the whole eChopdo web app**, full screen in Chrome (Trusted Web Activity), so login,
  vault fingerprint and passkeys are the same as the installed web app. Needs
  `/.well-known/assetlinks.json` on the site with this app's signing-key SHA-256, or Chrome shows a URL bar.
- **Quick add** (`QuickAddActivity`): a sheet over the home screen — Hisab (default) or Budget, calculator
  keypad, category / book / source (or account) chips, date, note, Save / Save & next. Opened from the
  widget, the app-icon shortcuts (Spent / Received) and the quick-settings tile "eChopdo +".
- **Widget** (`QuickWidget`): Spent / Received, plus up to 4 chips of the household's frequent Hisab entries
  (same category + amount ≥ 2× in 60 days) that save in one tap, with Undo in a notification (15 min).
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
