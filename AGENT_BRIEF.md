# PocketOS: Agent Brief

You are the lead engineer on **PocketOS**, a personal finance tracker for a household in India. The owner is Arpan (Head of Applied Engineering). Work autonomously: plan, implement, verify, commit. Only stop to ask when a decision is irreversible or truly ambiguous, and then ask one question at a time.

## Product goal
One private place to see where money comes from, where it goes, and whether the month is on budget, fast enough to log a transaction in under 10 seconds from a phone.

## Current state (already built and working)
- **Stack:** React 19 + Vite, `@supabase/supabase-js`, Recharts, plain CSS (`src/index.css`, dark-only "dev tool" theme: IBM Plex Sans/Mono, near-black background). No router: tabs are in `src/App.jsx`. Installable PWA (`vite-plugin-pwa`: manifest, service worker, icons).
- **Auth:** Google OAuth + passkeys via Supabase Auth (`src/components/Auth.jsx`) — no password, no OTP. Both are live and working (Google provider + WebAuthn Passkeys configured in the Supabase dashboard, RP bound to the production domain).
- **Multi-household:** one master login manages several isolated households (workspaces), switchable from the topbar; see `## Multi-household` in `CLAUDE.md`.
- **Dashboard:** month picker; income, expense, net savings with savings rate, and net worth tiles; a 6-month income vs expense bar chart (with a proper empty state instead of a broken tiny-scale chart when there's no data); an expense-by-category donut; account balances; recent transactions.
- **Transactions:** a monthly list with search, filters (type, category, account), add/edit modal, delete, and CSV export. A universal floating "+" button (all screen sizes) opens an Income/Expense speed-dial, then the add modal.
- **Plan** (`src/components/Plan.jsx`, replaced Budgets): recurring commitments (credit card dues, SIPs, salary, bills — `recurring_items` table) with an expected amount and optional due day; shows expected income vs. expense for a chosen month (defaults to next month), filled in with real amounts as they get "Logged" (creates a normal transaction linked via `recurring_item_id`, and rolls the expected amount forward). The old per-category Budget caps feature is gone from the UI (table still exists, unused).
- **Accounts, Categories & Households:** create/rename/delete households; create and delete accounts (bank/cash/card/wallet/investment, with opening balance) and colored categories — all scoped to the active household.
- **Settings → Passkeys:** register/rename/remove passkeys for the current device.
- **Supabase project `pocketOS`** (ref `rpihmjnvcqnxfketcjit`, ap-northeast-1). The schema is already applied. See `CLAUDE.md` and `supabase/schema.sql`.

## Data model (do not break)
- `households`, `accounts`, `categories`, `transactions`, `budgets`, `recurring_items`. Each has `user_id uuid default auth.uid()`; all but `households` also have a required `household_id uuid references households(id)`.
- RLS is on for every table with one policy, "own rows" (`user_id = (select auth.uid())`) — unchanged by multi-household, since only one person ever signs in (no admin-bypass). Every new table must follow the same pattern.
- `transactions.amount` is always positive; `kind` is 'income' or 'expense'. `transactions.recurring_item_id` (nullable) links a logged transaction back to the `recurring_items` row it fulfilled.
- `budgets.month` is the first day of the month; it is unique on `(household_id, category_id, month)`. `categories` is unique on `(household_id, name, kind)`. **`budgets` is unused by the UI now** (Plan replaced it) — don't build on it without checking with the user.
- `recurring_items`: `name`, `kind`, `category_id`/`account_id` (both nullable), `expected_amount`, `day_of_month` (nullable), `active`. Powers the Plan tab; `expected_amount` rolls forward to the last logged actual.
- The `account_balances` view (security_invoker) computes balances; `household_id` is a trailing column (Postgres view columns can only be appended, not reordered, via `create or replace view`). Keep aggregation in SQL, not in the browser: the Supabase API returns at most 1,000 rows by default.
- The `seed_new_user()` trigger creates a "Home" household and seeds categories + a Cash account into it for each new user. Its EXECUTE permission is revoked from API roles.
- `rls_auto_enable()` is Supabase-provided. Do not modify it.

## Roadmap (in priority order)
Ship v1 is done: pushed to GitHub, Google OAuth + passkeys enabled, deployed to Vercel (see `CLAUDE.md` `## Deployment`), verified sign-in → seed data → add/edit/delete a transaction → Plan tab end to end. The user is now populating `recurring_items` with their real credit cards/SIPs/salary and will likely come back with refinements once they've used it for real — expect follow-up rework on Plan specifically.

1. **Transfers between accounts:** a `transfer` kind (or a paired-row design) that moves money without counting as income or expense. Update `account_balances`, the dashboard and CSV export.
2. **Recurring transactions (auto-generation):** distinct from Plan's manual "Log" step — actually auto-creating the transaction on/after the due date (Supabase cron job or on app load) for items the user marks as fully automatic.
3. **Import:** CSV import from bank statements (HDFC/ICICI/SBI formats), with column mapping, duplicate detection and auto-categorisation rules. AI receipt/screenshot capture (share-to-app) is a further-out stretch goal, seen in competing apps.
4. **Credit cards & EMIs:** limits, due-date reminders, amortization for EMIs specifically (Plan's `recurring_items` covers the monthly due amount, not a full loan schedule) — another gap noted in competing apps.
5. **Insights:** month-over-month change per category, top merchants from notes, and a simple "safe to spend" figure for the rest of the month.
6. **Performance:** code-split Recharts (the bundle is ~550 kB), lazy-load tabs, and consider caching read-only reference data (accounts/categories) in the service worker.

## Engineering rules
- **Schema changes:** append the SQL to `supabase/schema.sql` (idempotent: `if not exists`, `create or replace`), apply it as a named migration via the Supabase MCP, then run both the security and performance advisors and fix new findings.
- Never use the service_role/secret key in the frontend or commit it. `.env` stays gitignored.
- Before every commit, `npm run build` must pass. Oxlint set-state-in-effect warnings on data-fetching effects are known and acceptable.
- Test RLS whenever you touch policies: a second user must see zero rows from the first.
- Keep UI consistent with the existing CSS variables. It must work at 375px width (the app is dark-only now — no light theme to check).
- Currency: INR with `en-IN` formatting (lakhs/crores grouping) via `src/lib/format.js`. Never hardcode ₹.
- Small, focused commits with clear messages, one roadmap item per branch or PR.
- Update `CLAUDE.md` "Status / next steps" when you finish a roadmap item.

## Definition of done (per feature)
Works end to end against the real Supabase project, RLS is verified, advisors are clean (apart from `rls_auto_enable`), the build passes, mobile and dark mode have been checked, and it is committed and pushed. Finish with a 2–3 line summary for Arpan of what changed and what's next.

## Start now
Read `CLAUDE.md`, then do roadmap item 1. Report back when the app is running and v1 is verified.
