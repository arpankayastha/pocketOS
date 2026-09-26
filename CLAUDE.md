# PocketOS

A personal "pocket operating system", used mainly as an installed PWA. React 19 + Vite, `@supabase/supabase-js`, Recharts. Plain CSS in `src/index.css` — dark-only, IBM Plex Sans/Mono for a "dev tool" feel (no light theme). No router: modules and their tabs live in `src/App.jsx`.

## Modules
PocketOS is a shell of independent modules, picked via the module switcher in the topbar (persisted to `localStorage` as `pocketos.activeModule`). The shared `Topbar` in `src/App.jsx` holds brand, switcher and account; each module component (`BudgetModule`, `VaultModule`) renders its own tabs/content inside it. Module names are single words, **no "Pocket" prefix**.
- **Budget** — the finance features (Dashboard, Transactions, Plan, Accounts & Categories). The user's focus is forward-looking: planning next month, not analysing the past. The Dashboard is deliberately limited to last / this / next month; next month is the plan (unlogged `recurring_items` at `expected_amount` + any actuals already logged). Swipe left/right changes month on Dashboard, Transactions and Plan (`useMonthSwipe` in `src/lib/useSwipe.js`).
- **Vault** — passwords & credentials (LastPass-like), tabs Passwords / Generator / Security. See "Vault" below.

## Vault (zero-knowledge)
- **Never send plaintext to Supabase.** One random 256-bit vault key encrypts each item (AES-GCM, item id as associated data) in `src/lib/vaultCrypto.js`. Every field, including the item type, lives inside `vault_items.ciphertext`.
- **Item types** (LastPass-style) are defined in `src/lib/vaultTypes.js`: 19 types (password, passkey, secure note, contact, payment card, bank account, driver's license, passport, government ID, health/insurance/membership, Wi-Fi, email, messenger, database, server, SSH key, software license), each with its field list. The form, detail view, list subtitle, search and quick-copy button are all driven from it, so a new type or field is a registry edit only. Items without `type` (saved before types existed) are passwords. Field labels match LastPass's, so LastPass secure notes import as typed items (`typedFromLastPassNote`). The UI is `src/components/VaultItems.jsx`: + opens a type picker (full-screen on phones), and filter chips appear once there's more than one type.
- The vault key is stored only *wrapped*, once per unlocker in `vault_unlockers`: `password` (PBKDF2-SHA256, 600k iterations), `recovery` (32-char Crockford base32 code → HKDF), `prf` (per-device fingerprint: WebAuthn PRF extension output → HKDF). Lose all three and the data is unrecoverable, by design.
- Fingerprint credentials (`src/lib/webauthn.js`) are PocketOS's own WebAuthn credentials with `rp.id = location.hostname`, separate from Supabase's sign-in passkeys, so they work on any origin (incl. localhost), but are per-origin. PRF needs Chrome on Android or Safari on iOS 18+. No server-side signature verification: the PRF secret is what decrypts.
- State lives in `useVault` (`src/lib/useVault.js`), called from `Shell` so switching modules doesn't lock. Key held in memory only (refs); auto-locks after 5 min idle or 30 s in the background.
- **App lock** (`src/lib/useAppLock.js`, `AppLockScreen.jsx`): per-device setting in `localStorage` (`pocketos.appLock`); fingerprint on open and after 60 s in the background. It's a UI privacy gate only; Budget data isn't encrypted. Master password is the fallback. It reuses this device's vault credential (`pocketos.vaultCredential`) when there is one.
- Extras in `src/lib/vaultTools.js`: TOTP (RFC 6238, base32 or `otpauth://`), password generator (rejection sampling, no look-alike chars), LastPass CSV import (parsed and encrypted on device), Have I Been Pwned k-anonymity breach check (only 5 hex chars of the SHA-1 leave the device), clipboard auto-clear after 30 s.
- Autofill into other apps/sites is impossible from a PWA. Users copy and paste.

## Auth
Google OAuth (`supabase.auth.signInWithOAuth({ provider: 'google' })`) plus passkeys (`supabase.auth.signInWithPasskey()` / `registerPasskey()`, opted into via `experimental: { passkey: true }` in `src/lib/supabase.js`) — no email/password, no OTP. `src/components/Auth.jsx` offers both; passkeys can only be *registered* once already signed in (Settings → Passkeys), so Google remains the only way to create an account. Google provider redirect URI is `https://rpihmjnvcqnxfketcjit.supabase.co/auth/v1/callback` (Supabase dashboard, Authentication → Providers). Passkeys are bound to a single Relying Party ID/origin (Authentication → Passkeys) — currently the production domain, so passkey sign-in doesn't work from localhost.

## Multi-household
One login (the master account) manages several isolated **households** (workspaces) — e.g. "Home", "Parents". Every row in `accounts`/`categories`/`transactions`/`budgets` carries a `household_id` in addition to `user_id`; RLS is still purely `user_id = auth.uid()` (no admin-bypass — only one person ever signs in). The active household is tracked client-side in `src/lib/useFinanceData.js` (persisted to `localStorage`) and threaded through every component as `activeHouseholdId`. Switch/create households via the dropdown in the topbar (`src/App.jsx`) or manage them in Settings → Households.

## Supabase
- Project: `pocketOS`, ref `rpihmjnvcqnxfketcjit`, region ap-northeast-1, Postgres 17.
- URL and publishable key are in `.env` (gitignored). See `.env.example`.
- The schema in `supabase/schema.sql` has already been applied to the remote project, including the multi-household migration at the end of that file.
- Tables: `households`, `accounts`, `categories`, `transactions`, `budgets`, `recurring_items`, `vault_unlockers`, `vault_items`. Each has `user_id default auth.uid()` and one RLS policy, "own rows" (`user_id = auth.uid()`); the finance tables (all but `households` and the two `vault_*` tables) also have a required `household_id`. The Vault is personal to the login, not per household.
- View `account_balances` (security_invoker) computes current balance per account; carries `household_id` as a trailing column (Postgres `create or replace view` only allows appending columns, not reordering).
- Trigger `on_auth_user_created` → `seed_new_user()` creates a "Home" household plus 12 categories and a Cash account for new users. EXECUTE is revoked from anon/authenticated.
- `rls_auto_enable()` is a Supabase-provided function, not ours. Leave it alone.
- Amounts are always positive; `kind` ('income' | 'expense') decides the sign.
- **Between-household transfers** (`src/lib/transfers.js`, `TransferForm.jsx`, "⇄ Transfer" in the + menu when there are 2+ households): one transfer = an expense in the sender household + an income in the receiver, sharing `transactions.transfer_id`, both in each household's "Home transfer" category (matched loosely so the user's existing misspelled "Home Trasfer " is reused; created if missing). They count in normal income/expense totals by the user's choice. Edit/delete always act on both halves; the Transactions list labels them "⇄ to/from <household>".
- `budgets` (per-category caps) still exists in the schema but is **unused by the UI** — the Budgets tab was replaced by Plan (see below). Don't build on it without checking with the user first.
- `recurring_items` (name, kind, category, optional account, `expected_amount`, `day_of_month`) power the **Plan** tab (`src/components/Plan.jsx`, replaces the old Budgets tab): a forward-looking view of expected income vs. expected outflow for a chosen month (defaults to next month). `transactions.recurring_item_id` links a logged transaction back to the commitment it fulfilled — the Plan tab shows the actual amount once linked, otherwise falls back to `expected_amount`. Logging an actual also rolls `expected_amount` forward to the new value, since these amounts (credit card dues, etc.) drift month to month.

## UI notes
- On phones, the floating + button and bottom nav hide while a text field is focused (CSS `:has` in `src/index.css`), and `.content` has extra bottom padding, so the + never covers a Save button.
- Splash screen: static markup + inline CSS inside `#root` in `index.html` (paints before JS), and the matching `<Splash />` in `src/App.jsx` while the session loads. Keep the two in sync if the logo changes.

## Conventions
- Data access happens directly in components via `supabase.from(...)`. Shared loaders are in `src/lib/useFinanceData.js`.
- Money and date helpers are in `src/lib/format.js` (INR / en-IN by default via env).
- After any schema change: add the SQL to `supabase/schema.sql`, apply it as a migration, then run the Supabase security and performance advisors.

## Commands
- `npm run dev`: start the dev server
- `npm run build`: production build
- `npm run lint`: oxlint. The set-state-in-effect warnings on data-fetching effects are known and acceptable.

## Deployment
- **GitHub:** pushed to https://github.com/arpankayastha/pocketOS (`main`). Local git/`gh` must be authenticated as `arpankayastha` — a different account (`arpanGrip-alchemy`) has no write access there.
- **Vercel:** project `pocket-os` under `arpankayasthas-projects`, imported from the GitHub repo (auto-deploys on every push to `main`; PRs/other branches get preview deployments). Production: **https://my-pocket-os.vercel.app** (custom domain — the project's own auto-generated domain, `pocket-os-eight.vercel.app`, no longer resolves). The four `VITE_*` env vars are set in the Vercel project's Environment Variables.
- **Supabase Auth → URL Configuration:** Site URL and the Redirect URLs allow-list (`localhost:5173`, `https://my-pocket-os.vercel.app`, and a `pocket-os-*-arpankayasthas-projects.vercel.app` wildcard for previews — still valid since only the *domain* was renamed, not the underlying Vercel project) — required for `signInWithOAuth`'s `redirectTo` to work on each origin.
- **Supabase Auth → Passkeys:** Relying Party ID/Origins point at `my-pocket-os.vercel.app`. **If the production domain changes again, update this along with URL Configuration** — passkeys are cryptographically bound to the RP ID, so a mismatch here silently breaks passkey sign-in (existing passkeys would also need re-registering).
- Google sign-in is enabled in the Supabase dashboard (Authentication → Providers) with a Google Cloud OAuth client already wired up.

## Status / next steps
Vault is built (all three phases: core, app lock, extras) and awaiting the user's real-device testing; expect follow-ups. Ship v1 is done end-to-end (Google OAuth + passkeys, multi-household, dark PWA UI, deployed). The user is populating their own `recurring_items` (credit cards, SIPs, salary) in the Plan tab now; expect follow-up refinement once they've used it with real data. Other improvement ideas: recurring *transactions* (auto-generating actual entries, distinct from the Plan tab's manual "Log" step), transfers between accounts, offline data caching (the PWA app-shell is already installable), code-splitting Recharts (bundle is ~550 kB), AI receipt/statement import and credit-card/EMI tracking (seen in competing apps).
