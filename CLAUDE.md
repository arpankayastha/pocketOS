# PocketOS

Personal finance tracker, used mainly as an installed PWA. React 19 + Vite, `@supabase/supabase-js`, Recharts. Plain CSS in `src/index.css` — dark-only, IBM Plex Sans/Mono for a "dev tool" feel (no light theme). No router: tabs live in `src/App.jsx`.

## Auth
Google OAuth only (`supabase.auth.signInWithOAuth({ provider: 'google' })` in `src/components/Auth.jsx`) — no email/password, no OTP. Requires the Google provider enabled in the Supabase dashboard (Authentication → Providers) with a Google Cloud OAuth client; redirect URI is `https://rpihmjnvcqnxfketcjit.supabase.co/auth/v1/callback`.

## Multi-household
One login (the master account) manages several isolated **households** (workspaces) — e.g. "Home", "Parents". Every row in `accounts`/`categories`/`transactions`/`budgets` carries a `household_id` in addition to `user_id`; RLS is still purely `user_id = auth.uid()` (no admin-bypass — only one person ever signs in). The active household is tracked client-side in `src/lib/useFinanceData.js` (persisted to `localStorage`) and threaded through every component as `activeHouseholdId`. Switch/create households via the dropdown in the topbar (`src/App.jsx`) or manage them in Settings → Households.

## Supabase
- Project: `pocketOS`, ref `rpihmjnvcqnxfketcjit`, region ap-northeast-1, Postgres 17.
- URL and publishable key are in `.env` (gitignored). See `.env.example`.
- The schema in `supabase/schema.sql` has already been applied to the remote project, including the multi-household migration at the end of that file.
- Tables: `households`, `accounts`, `categories`, `transactions`, `budgets`. Each has `user_id default auth.uid()` and one RLS policy, "own rows" (`user_id = auth.uid()`); the latter four also have a required `household_id`.
- View `account_balances` (security_invoker) computes current balance per account; carries `household_id` as a trailing column (Postgres `create or replace view` only allows appending columns, not reordering).
- Trigger `on_auth_user_created` → `seed_new_user()` creates a "Home" household plus 12 categories and a Cash account for new users. EXECUTE is revoked from anon/authenticated.
- `rls_auto_enable()` is a Supabase-provided function, not ours. Leave it alone.
- Amounts are always positive; `kind` ('income' | 'expense') decides the sign. Budgets are keyed by the first day of the month, unique on `(household_id, category_id, month)`.

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
- **Vercel:** project `pocket-os` under `arpankayasthas-projects`, imported from the GitHub repo (auto-deploys on every push to `main`; PRs/other branches get preview deployments). Production: https://pocket-os-eight.vercel.app. The four `VITE_*` env vars are set in the Vercel project's Environment Variables.
- **Supabase Auth → URL Configuration:** Site URL and the Redirect URLs allow-list (`localhost:5173`, the production URL, and a `pocket-os-*-arpankayasthas-projects.vercel.app` wildcard for previews) are already configured — required for `signInWithOAuth`'s `redirectTo` to work on each of those origins.
- Google sign-in is enabled in the Supabase dashboard (Authentication → Providers) with a Google Cloud OAuth client already wired up.

## Status / next steps
Ship v1 is done end-to-end (Google OAuth, multi-household, dark PWA UI, deployed). Improvement ideas: recurring transactions, transfers between accounts, offline data caching (the PWA app-shell is already installable), code-splitting Recharts (bundle is ~550 kB), AI receipt/statement import and credit-card/EMI tracking (seen in competing apps).
