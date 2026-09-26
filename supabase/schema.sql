-- PocketOS schema. Run in Supabase: SQL Editor → New query → paste → Run.

create extension if not exists "pgcrypto";

-- Accounts (bank, cash, card, wallet)
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'bank' check (type in ('bank','cash','card','wallet','investment')),
  opening_balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

-- Categories
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('income','expense')),
  color text not null default '#6366f1',
  created_at timestamptz not null default now(),
  unique (user_id, name, kind)
);

-- Transactions (amount always positive; kind decides sign)
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  kind text not null check (kind in ('income','expense')),
  amount numeric(14,2) not null check (amount > 0),
  note text,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, occurred_on desc);

-- Monthly budgets per expense category
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month date not null, -- first day of month, e.g. 2026-09-01
  amount numeric(14,2) not null check (amount >= 0),
  unique (user_id, category_id, month)
);

-- Row Level Security: each user sees only their own rows
alter table public.accounts     enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','budgets'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Seed default categories + a cash account for every new user
create or replace function public.seed_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.categories (user_id, name, kind, color) values
    (new.id, 'Salary',        'income',  '#16a34a'),
    (new.id, 'Freelance',     'income',  '#22c55e'),
    (new.id, 'Other income',  'income',  '#84cc16'),
    (new.id, 'Groceries',     'expense', '#f97316'),
    (new.id, 'Rent',          'expense', '#ef4444'),
    (new.id, 'Utilities',     'expense', '#eab308'),
    (new.id, 'Transport',     'expense', '#3b82f6'),
    (new.id, 'Dining out',    'expense', '#ec4899'),
    (new.id, 'Shopping',      'expense', '#a855f7'),
    (new.id, 'Health',        'expense', '#14b8a6'),
    (new.id, 'Entertainment', 'expense', '#6366f1'),
    (new.id, 'Other',         'expense', '#64748b');
  insert into public.accounts (user_id, name, type) values (new.id, 'Cash', 'cash');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.seed_new_user();

-- Current balance per account (computed in the DB; respects RLS via security_invoker)
create or replace view public.account_balances with (security_invoker = true) as
select a.id, a.name, a.type, a.opening_balance,
       a.opening_balance
         + coalesce(sum(case when t.kind = 'income'  then t.amount end), 0)
         - coalesce(sum(case when t.kind = 'expense' then t.amount end), 0) as balance
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;

-- Hardening: the seed function is only for the trigger, not the public API
revoke execute on function public.seed_new_user() from public, anon, authenticated;

-- Foreign-key indexes
create index if not exists accounts_user_id_idx on public.accounts (user_id);
create index if not exists budgets_category_id_idx on public.budgets (category_id);
create index if not exists transactions_account_id_idx on public.transactions (account_id);
create index if not exists transactions_category_id_idx on public.transactions (category_id);

-- Multi-household support: one master login manages several isolated households
-- (e.g. "My home", "Parents"). Still single-owner per row (user_id = auth.uid());
-- household_id is a scoping column, not a new security boundary — no RLS changes.
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.households enable row level security;
drop policy if exists "own rows" on public.households;
create policy "own rows" on public.households for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.accounts     add column if not exists household_id uuid references public.households(id) on delete cascade;
alter table public.categories   add column if not exists household_id uuid references public.households(id) on delete cascade;
alter table public.transactions add column if not exists household_id uuid references public.households(id) on delete cascade;
alter table public.budgets      add column if not exists household_id uuid references public.households(id) on delete cascade;

-- Backfill: give every existing user a default "Home" household and attach their existing rows to it
do $$
declare
  uid uuid;
  hh_id uuid;
begin
  for uid in
    select distinct user_id from public.accounts
    union select distinct user_id from public.categories
    union select distinct user_id from public.transactions
    union select distinct user_id from public.budgets
  loop
    insert into public.households (user_id, name) values (uid, 'Home') returning id into hh_id;
    update public.accounts     set household_id = hh_id where user_id = uid and household_id is null;
    update public.categories   set household_id = hh_id where user_id = uid and household_id is null;
    update public.transactions set household_id = hh_id where user_id = uid and household_id is null;
    update public.budgets      set household_id = hh_id where user_id = uid and household_id is null;
  end loop;
end $$;

alter table public.accounts     alter column household_id set not null;
alter table public.categories   alter column household_id set not null;
alter table public.transactions alter column household_id set not null;
alter table public.budgets      alter column household_id set not null;

alter table public.categories drop constraint if exists categories_user_id_name_kind_key;
alter table public.categories add constraint categories_household_id_name_kind_key unique (household_id, name, kind);

alter table public.budgets drop constraint if exists budgets_user_id_category_id_month_key;
alter table public.budgets add constraint budgets_household_id_category_id_month_key unique (household_id, category_id, month);

create index if not exists categories_user_id_idx on public.categories (user_id);
create index if not exists budgets_user_id_idx on public.budgets (user_id);
create index if not exists households_user_id_idx on public.households (user_id);
create index if not exists accounts_household_id_idx on public.accounts (household_id);
create index if not exists categories_household_id_idx on public.categories (household_id);
create index if not exists transactions_household_id_idx on public.transactions (household_id);
create index if not exists budgets_household_id_idx on public.budgets (household_id);

-- seed_new_user now creates a default household first and scopes seeded rows to it
create or replace function public.seed_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare hh_id uuid;
begin
  insert into public.households (user_id, name) values (new.id, 'Home') returning id into hh_id;
  insert into public.categories (user_id, household_id, name, kind, color) values
    (new.id, hh_id, 'Salary',        'income',  '#16a34a'),
    (new.id, hh_id, 'Freelance',     'income',  '#22c55e'),
    (new.id, hh_id, 'Other income',  'income',  '#84cc16'),
    (new.id, hh_id, 'Groceries',     'expense', '#f97316'),
    (new.id, hh_id, 'Rent',          'expense', '#ef4444'),
    (new.id, hh_id, 'Utilities',     'expense', '#eab308'),
    (new.id, hh_id, 'Transport',     'expense', '#3b82f6'),
    (new.id, hh_id, 'Dining out',    'expense', '#ec4899'),
    (new.id, hh_id, 'Shopping',      'expense', '#a855f7'),
    (new.id, hh_id, 'Health',        'expense', '#14b8a6'),
    (new.id, hh_id, 'Entertainment', 'expense', '#6366f1'),
    (new.id, hh_id, 'Other',         'expense', '#64748b');
  insert into public.accounts (user_id, household_id, name, type) values (new.id, hh_id, 'Cash', 'cash');
  return new;
end $$;

-- account_balances now carries household_id so clients can scope without a join.
-- household_id must be a NEW TRAILING column: `create or replace view` requires the
-- existing columns to keep their exact name/order and only allows appending after them.
create or replace view public.account_balances with (security_invoker = true) as
select a.id, a.name, a.type, a.opening_balance,
       a.opening_balance
         + coalesce(sum(case when t.kind = 'income'  then t.amount end), 0)
         - coalesce(sum(case when t.kind = 'expense' then t.amount end), 0) as balance,
       a.household_id
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;

-- Recurring commitments (credit card dues, SIPs, bills, salary) that power the
-- forward-looking Plan tab: expected amount for next month, filled in with real
-- transactions as they get logged.
create table if not exists public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('income','expense')),
  category_id uuid references public.categories(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  expected_amount numeric(14,2) not null check (expected_amount >= 0),
  day_of_month smallint check (day_of_month between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.recurring_items enable row level security;
drop policy if exists "own rows" on public.recurring_items;
create policy "own rows" on public.recurring_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Links a logged transaction back to the recurring item it fulfilled, so the
-- Plan tab knows an item is "actual" for the month rather than still "expected".
alter table public.transactions add column if not exists recurring_item_id uuid references public.recurring_items(id) on delete set null;

create index if not exists recurring_items_household_id_idx on public.recurring_items (household_id);
create index if not exists recurring_items_user_id_idx on public.recurring_items (user_id);
create index if not exists recurring_items_category_id_idx on public.recurring_items (category_id);
create index if not exists recurring_items_account_id_idx on public.recurring_items (account_id);
create index if not exists transactions_recurring_item_id_idx on public.transactions (recurring_item_id);

-- ============================================================================
-- Vault module: zero-knowledge password manager.
-- The server only ever sees ciphertext. Each user has one random 256-bit vault
-- key, generated in the browser; it is stored here only *wrapped* (AES-GCM
-- encrypted) by each "unlocker": the master password (PBKDF2), the recovery
-- code (HKDF), or a device fingerprint (WebAuthn PRF output → HKDF).
-- vault_items rows are AES-GCM encrypted with the vault key; every field
-- (title, url, username, password, notes, TOTP) lives inside the ciphertext.
-- Personal to the login: no household_id.
-- ============================================================================
create table if not exists public.vault_unlockers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('password','recovery','prf')),
  label text,                 -- device name, for kind = 'prf'
  credential_id text,         -- base64url WebAuthn credential id, for kind = 'prf'
  salt text not null,         -- base64: PBKDF2/HKDF salt, or the PRF eval input for 'prf'
  iterations integer,         -- PBKDF2 iterations, for kind = 'password'
  iv text not null,           -- base64 AES-GCM IV used to wrap the vault key
  wrapped_key text not null,  -- base64 AES-GCM ciphertext of the raw vault key
  created_at timestamptz not null default now(),
  check (kind <> 'prf' or credential_id is not null),
  check (kind <> 'password' or iterations is not null)
);
create unique index if not exists vault_unlockers_one_password_recovery
  on public.vault_unlockers (user_id, kind) where kind in ('password','recovery');
alter table public.vault_unlockers enable row level security;
drop policy if exists "own rows" on public.vault_unlockers;
create policy "own rows" on public.vault_unlockers for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.vault_items (
  id uuid primary key default gen_random_uuid(), -- generated client-side; also the AES-GCM associated data
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  iv text not null,
  ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vault_items_user_id_idx on public.vault_items (user_id);
alter table public.vault_items enable row level security;
drop policy if exists "own rows" on public.vault_items;
create policy "own rows" on public.vault_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
