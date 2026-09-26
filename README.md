# PocketOS (React + Vite + Supabase)

Personal finance tracker: income/expenses, accounts, categories, monthly budgets, dashboard charts and CSV export. Every user's data is isolated with Supabase Row Level Security.

## Setup (about 5 minutes)

1. **Create a Supabase project** at https://supabase.com/dashboard.
2. **Run the schema:** SQL Editor → New query → paste `supabase/schema.sql` → Run.
   This creates the tables, RLS policies, the `account_balances` view, and a trigger that seeds default categories and a "Cash" account for each new user.
3. **Get your keys:** Project Settings → API → copy the Project URL and the anon / publishable key.
4. **Configure and run:**
   ```bash
   cp .env.example .env      # paste URL + key
   npm install
   npm run dev               # http://localhost:5173
   ```
5. Sign up in the app. For quick local testing you can turn off "Confirm email" under Authentication → Sign In / Providers → Email.

Currency defaults to INR (`en-IN` formatting); change `VITE_CURRENCY` / `VITE_LOCALE` in `.env`.

## Deploy

`npm run build` outputs static files to `dist/`. On Vercel or Netlify, set the same `VITE_*` env vars, and add your production URL under Supabase → Authentication → URL Configuration.

## Structure

```
supabase/schema.sql          tables, RLS, seed trigger, balances view
src/lib/supabase.js          client
src/lib/useFinanceData.js    accounts/categories loader + transaction query
src/components/
  Auth.jsx                   email + password sign in / sign up
  Dashboard.jsx              month tiles, 6-month trend, category breakdown, balances
  Transactions.jsx           monthly list, filters, search, edit/delete, CSV export
  TransactionForm.jsx        add/edit modal
  Budgets.jsx                per-category monthly budgets with progress bars
  Settings.jsx               manage accounts and categories
```

## Notes

- Amounts are stored positive; `kind` (income/expense) decides the sign.
- Supabase's API returns at most 1,000 rows per request by default (Settings → API → Max rows). Raise it if a single month can have more than that.
