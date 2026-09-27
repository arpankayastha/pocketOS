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

-- Between-household transfers: one transfer = an expense in the sender household plus an
-- income in the receiver, created together and sharing transfer_id so editing/deleting
-- one side updates the other. Both count in their household's normal totals.
alter table public.transactions add column if not exists transfer_id uuid;
create index if not exists transactions_transfer_id_idx on public.transactions (transfer_id) where transfer_id is not null;
comment on column public.transactions.transfer_id is 'Links the two halves of a between-household transfer: an expense in the sender household and an income in the receiver, sharing this id.';

-- Account colours (shown as dots in lists) + balances as of a date.
-- The account_balances view counts every transaction, including future-dated ones
-- (e.g. next month's salary logged from the Plan tab); the Dashboard's "today"
-- balances use account_balances_on(<client's local date>) instead.
alter table public.accounts add column if not exists color text;

create or replace function public.account_balances_on(on_date date)
returns table (id uuid, name text, type text, color text, opening_balance numeric, balance numeric, household_id uuid)
language sql stable security invoker set search_path = ''
as $$
  select a.id, a.name, a.type, a.color, a.opening_balance,
         a.opening_balance
           + coalesce(sum(case when t.kind = 'income'  then t.amount end), 0)
           - coalesce(sum(case when t.kind = 'expense' then t.amount end), 0),
         a.household_id
  from public.accounts a
  left join public.transactions t on t.account_id = a.id and t.occurred_on <= on_date
  group by a.id
$$;
revoke execute on function public.account_balances_on(date) from public, anon;
grant execute on function public.account_balances_on(date) to authenticated;

-- ============================================================================
-- Will module: the whole will is one JSON document, AES-GCM encrypted in the browser with
-- the Vault key (row id as associated data). The server only stores ciphertext.
-- ============================================================================
create table if not exists public.wills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  iv text not null,
  ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wills_user_id_idx on public.wills (user_id);
alter table public.wills enable row level security;
drop policy if exists "own rows" on public.wills;
create policy "own rows" on public.wills for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Saved versions (snapshots) of a will, for transparency: each is encrypted the same way.
create table if not exists public.will_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  will_id uuid not null references public.wills(id) on delete cascade,
  iv text not null,
  ciphertext text not null,
  created_at timestamptz not null default now()
);
create index if not exists will_versions_user_id_idx on public.will_versions (user_id);
create index if not exists will_versions_will_id_idx on public.will_versions (will_id);
alter table public.will_versions enable row level security;
drop policy if exists "own rows" on public.will_versions;
create policy "own rows" on public.will_versions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Change log for the will: one row per editing session (edits within 30 minutes are merged),
-- encrypted with the Vault key like the will itself. Payload: { start, end, changes: [text] }.
create table if not exists public.will_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  will_id uuid not null references public.wills(id) on delete cascade,
  iv text not null,
  ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists will_log_user_id_idx on public.will_log (user_id);
create index if not exists will_log_will_id_idx on public.will_log (will_id);
alter table public.will_log enable row level security;
drop policy if exists "own rows" on public.will_log;
create policy "own rows" on public.will_log for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ============================================================================
-- Dues (Budget → Dues): money owed between the household and a person, both ways.
-- Balance of a due = Σ out − Σ in  (> 0: they owe the household; < 0: the household owes them).
-- Each entry can be mirrored into Budget as a transaction (or a between-household
-- transfer when the person is one of the user's own households: person_household_id).
-- An optional EMI is a recurring_items row with due_id, so it shows up in Plan.
-- ============================================================================
create table if not exists public.dues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  person text not null,
  person_household_id uuid references public.households(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.dues enable row level security;
drop policy if exists "own rows" on public.dues;
create policy "own rows" on public.dues for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.due_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  due_id uuid not null references public.dues(id) on delete cascade,
  direction text not null check (direction in ('out','in')), -- out: money went to the person; in: came from them
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null default current_date,
  note text,
  transaction_id uuid references public.transactions(id) on delete set null,
  transfer_id uuid,
  created_at timestamptz not null default now()
);
alter table public.due_entries enable row level security;
drop policy if exists "own rows" on public.due_entries;
create policy "own rows" on public.due_entries for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.recurring_items add column if not exists due_id uuid references public.dues(id) on delete cascade;

create index if not exists dues_household_id_idx on public.dues (household_id);
create index if not exists dues_user_id_idx on public.dues (user_id);
create index if not exists dues_person_household_id_idx on public.dues (person_household_id);
create index if not exists due_entries_due_id_idx on public.due_entries (due_id);
create index if not exists due_entries_household_id_idx on public.due_entries (household_id);
create index if not exists due_entries_user_id_idx on public.due_entries (user_id);
create index if not exists due_entries_transaction_id_idx on public.due_entries (transaction_id);
create index if not exists recurring_items_due_id_idx on public.recurring_items (due_id);

-- ============================================================================
-- Hisab (Budget → Hisab): Money Tracker-style cash books that do NOT affect Budget
-- totals — a "daily" book for day-to-day spends plus one book per occasion
-- (Diwali, a wedding…). Categories and sources are free text on each entry.
-- ============================================================================
create table if not exists public.hisab_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  kind text not null default 'occasion' check (kind in ('daily','occasion')),
  target numeric(14,2) check (target is null or target > 0),
  created_at timestamptz not null default now()
);
alter table public.hisab_books enable row level security;
drop policy if exists "own rows" on public.hisab_books;
create policy "own rows" on public.hisab_books for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.hisab_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  book_id uuid not null references public.hisab_books(id) on delete cascade,
  direction text not null default 'out' check (direction in ('out','in')),
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null default current_date,
  category text,
  source text,
  note text,
  created_at timestamptz not null default now()
);
alter table public.hisab_entries enable row level security;
drop policy if exists "own rows" on public.hisab_entries;
create policy "own rows" on public.hisab_entries for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create index if not exists hisab_books_household_id_idx on public.hisab_books (household_id);
create index if not exists hisab_books_user_id_idx on public.hisab_books (user_id);
create index if not exists hisab_entries_book_id_idx on public.hisab_entries (book_id, occurred_on);
create index if not exists hisab_entries_household_id_idx on public.hisab_entries (household_id);
create index if not exists hisab_entries_user_id_idx on public.hisab_entries (user_id);
-- ============================================================================
-- Household members: the owner (the one Google login) can give a household its own
-- login (username + 6-digit PIN, then fingerprint). A member sees and edits only that
-- household; the owner still sees everything. Vault and Will stay owner-only.
-- Logins are created by the `members` Edge Function (service role), never by the client.
-- ============================================================================
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null unique,
  fingerprint_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists household_members_user_id_idx on public.household_members (user_id);
alter table public.household_members enable row level security;
-- Only the Edge Function writes membership; a member may only stamp fingerprint_at on their own row.
revoke insert, update, delete, truncate on public.household_members from anon, authenticated;
grant update (fingerprint_at) on public.household_members to authenticated;
drop policy if exists "owner or self reads" on public.household_members;
create policy "owner or self reads" on public.household_members for select to authenticated
  using (user_id = (select auth.uid())
         or household_id in (select h.id from public.households h where h.user_id = (select auth.uid())));
drop policy if exists "self stamps fingerprint" on public.household_members;
create policy "self stamps fingerprint" on public.household_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Households the caller can open: owned, or joined as a member. Lives in a schema that
-- PostgREST doesn't expose; security definer so policies can use it without RLS recursion.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.my_household_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select h.id from public.households h where h.user_id = auth.uid()
  union
  select m.household_id from public.household_members m where m.user_id = auth.uid()
$$;
revoke execute on function private.my_household_ids() from public, anon;
grant execute on function private.my_household_ids() to authenticated;

-- households: members can read theirs; only the owner creates, renames or deletes.
drop policy if exists "own rows" on public.households;
drop policy if exists "read own or joined" on public.households;
drop policy if exists "owner inserts" on public.households;
drop policy if exists "owner updates" on public.households;
drop policy if exists "owner deletes" on public.households;
-- user_id check first: on INSERT … RETURNING the new row isn't yet visible to my_household_ids().
create policy "read own or joined" on public.households for select to authenticated
  using (user_id = (select auth.uid()) or id in (select private.my_household_ids()));
create policy "owner inserts" on public.households for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "owner updates" on public.households for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner deletes" on public.households for delete to authenticated
  using (user_id = (select auth.uid()));

-- Finance tables: any household the caller can open (was: rows the caller created).
do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','budgets','recurring_items','dues','due_entries','hisab_books','hisab_entries'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('drop policy if exists "household rows" on public.%I', t);
    execute format('create policy "household rows" on public.%I for all to authenticated
      using (household_id in (select private.my_household_ids()))
      with check (household_id in (select private.my_household_ids()))', t);
  end loop;
end $$;

-- Member logins don't get their own starter "Home" household.
create or replace function public.seed_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare hh_id uuid;
begin
  if coalesce(new.raw_app_meta_data->>'role', '') = 'member' or new.email like '%@members.echopdo.vercel.app' then
    return new;
  end if;
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
revoke execute on function public.seed_new_user() from public, anon, authenticated;

-- Public sign-ups are closed (done in SQL because the dashboard toggle wasn't reachable):
-- the only new users allowed are household member logins, which the `members` Edge Function
-- creates via the admin API (role 'member', members.* address). Existing users are unaffected;
-- this only runs on INSERT into auth.users. Drop the trigger to allow a new owner account.
create or replace function private.block_public_signups()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_app_meta_data->>'role', '') = 'member' and new.email like '%@members.echopdo.vercel.app' then
    return new;
  end if;
  raise exception 'Sign-ups are closed for eChopdo.' using errcode = '42501';
end $$;
revoke execute on function private.block_public_signups() from public, anon, authenticated;

drop trigger if exists block_public_signups on auth.users;
create trigger block_public_signups
  before insert on auth.users
  for each row execute function private.block_public_signups();
