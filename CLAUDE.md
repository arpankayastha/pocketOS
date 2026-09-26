# PocketOS

Personal finance tracker, used mainly as an installed PWA. React 19 + Vite, `@supabase/supabase-js`, Recharts. Plain CSS in `src/index.css` — dark-only, IBM Plex Sans/Mono for a "dev tool" feel (no light theme). No router: tabs live in `src/App.jsx`.

## Auth
Google OAuth (`supabase.auth.signInWithOAuth({ provider: 'google' })`) plus passkeys (`supabase.auth.signInWithPasskey()` / `registerPasskey()`, opted into via `experimental: { passkey: true }` in `src/lib/supabase.js`) — no email/password, no OTP. `src/components/Auth.jsx` offers both; passkeys can only be *registered* once already signed in (Settings → Passkeys), so Google remains the only way to create an account. Google provider redirect URI is `https://rpihmjnvcqnxfketcjit.supabase.co/auth/v1/callback` (Supabase dashboard, Authentication → Providers). Passkeys are bound to a single Relying Party ID/origin (Authentication → Passkeys) — currently the production domain, so passkey sign-in doesn't work from localhost.

## Multi-household
One login (the master account) manages several isolated **households** (workspaces) — e.g. "Home", "Parents". Every row in `accounts`/`categories`/`transactions`/`budgets` carries a `household_id` in addition to `user_id`; RLS is still purely `user_id = auth.uid()` (no admin-bypass — only one person ever signs in). The active household is tracked client-side in `src/lib/useFinanceData.js` (persisted to `localStorage`) and threaded through every component as `activeHouseholdId`. Switch/create households via the dropdown in the topbar (`src/App.jsx`) or manage them in Settings → Households.

## Supabase
- Project: `pocketOS`, ref `rpihmjnvcqnxfketcjit`, region ap-northeast-1, Postgres 17.
- URL and publishable key are in `.env` (gitignored). See `.env.example`.
- The schema in `supabase/schema.sql` has already been applied to the remote project, including the multi-household migration at the end of that file.
- Tables: `households`, `accounts`, `categories`, `transactions`, `budgets`, `recurring_items`. Each has `user_id default auth.uid()` and one RLS policy, "own rows" (`user_id = auth.uid()`); all but `households` also have a required `household_id`.
- View `account_balances` (security_invoker) computes current balance per account; carries `household_id` as a trailing column (Postgres `create or replace view` only allows appending columns, not reordering).
- Trigger `on_auth_user_created` → `seed_new_user()` creates a "Home" household plus 12 categories and a Cash account for new users. EXECUTE is revoked from anon/authenticated.
- `rls_auto_enable()` is a Supabase-provided function, not ours. Leave it alone.
- Amounts are always positive; `kind` ('income' | 'expense') decides the sign.
- `budgets` (per-category caps) still exists in the schema but is **unused by the UI** — the Budgets tab was replaced by Plan (see below). Don't build on it without checking with the user first.
- `recurring_items` (name, kind, category, optional account, `expected_amount`, `day_of_month`) power the **Plan** tab (`src/components/Plan.jsx`, replaces the old Budgets tab): a forward-looking view of expected income vs. expected outflow for a chosen month (defaults to next month). `transactions.recurring_item_id` links a logged transaction back to the commitment it fulfilled — the Plan tab shows the actual amount once linked, otherwise falls back to `expected_amount`. Logging an actual also rolls `expected_amount` forward to the new value, since these amounts (credit card dues, etc.) drift month to month.

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
Ship v1 is done end-to-end (Google OAuth + passkeys, multi-household, dark PWA UI, deployed). The user is populating their own `recurring_items` (credit cards, SIPs, salary) in the Plan tab now; expect follow-up refinement once they've used it with real data. Other improvement ideas: recurring *transactions* (auto-generating actual entries, distinct from the Plan tab's manual "Log" step), transfers between accounts, offline data caching (the PWA app-shell is already installable), code-splitting Recharts (bundle is ~550 kB), AI receipt/statement import and credit-card/EMI tracking (seen in competing apps).
