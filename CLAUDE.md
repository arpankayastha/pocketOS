# PocketOS

Personal finance tracker. React 19 + Vite, `@supabase/supabase-js`, Recharts. Plain CSS in `src/index.css` (light and dark via CSS variables). No router: tabs live in `src/App.jsx`.

## Supabase
- Project: `pocketOS`, ref `rpihmjnvcqnxfketcjit`, region ap-northeast-1, Postgres 17.
- URL and publishable key are in `.env` (gitignored). See `.env.example`.
- The schema in `supabase/schema.sql` has already been applied to the remote project, plus the hardening/index migration at the end of that file.
- Tables: `accounts`, `categories`, `transactions`, `budgets`. Each has `user_id default auth.uid()` and one RLS policy, "own rows" (`user_id = auth.uid()`).
- View `account_balances` (security_invoker) computes current balance per account.
- Trigger `on_auth_user_created` → `seed_new_user()` seeds 12 categories and a Cash account for new users. EXECUTE is revoked from anon/authenticated.
- `rls_auto_enable()` is a Supabase-provided function, not ours. Leave it alone.
- Amounts are always positive; `kind` ('income' | 'expense') decides the sign. Budgets are keyed by the first day of the month.

## Conventions
- Data access happens directly in components via `supabase.from(...)`. Shared loaders are in `src/lib/useFinanceData.js`.
- Money and date helpers are in `src/lib/format.js` (INR / en-IN by default via env).
- After any schema change: add the SQL to `supabase/schema.sql`, apply it as a migration, then run the Supabase security and performance advisors.

## Commands
- `npm run dev`: start the dev server
- `npm run build`: production build
- `npm run lint`: oxlint. The set-state-in-effect warnings on data-fetching effects are known and acceptable.

## Status / next steps
1. Push to https://github.com/arpankayastha/pocketOS (`origin` is already set).
2. Run locally, sign up, and confirm the seed data appears. For local testing you may disable "Confirm email" in Supabase Auth.
3. Deploy (Vercel/Netlify) with the `VITE_*` env vars and add the production URL in Supabase Auth → URL Configuration.
4. Improvement ideas: recurring transactions, transfers between accounts, PWA/offline, code-splitting Recharts (bundle is ~550 kB).
