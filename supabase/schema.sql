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

-- Which Budget tab a member's app opens on (set by the owner in Settings → Households).
alter table public.household_members add column if not exists start_tab text not null default 'dashboard'
  check (start_tab in ('dashboard','transactions','plan','dues','hisab'));
grant update (start_tab) on public.household_members to authenticated;
drop policy if exists "owner sets start tab" on public.household_members;
create policy "owner sets start tab" on public.household_members for update to authenticated
  using (household_id in (select h.id from public.households h where h.user_id = (select auth.uid())))
  with check (household_id in (select h.id from public.households h where h.user_id = (select auth.uid())));

-- Each household has its own colour (chip, dropdown, Settings avatar), same on every login.
alter table public.households add column if not exists color text;
with ranked as (
  select id, (row_number() over (partition by user_id order by created_at) - 1) % 8 as i
  from public.households where color is null
)
update public.households h set color = (array['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'])[r.i + 1]
from ranked r where r.id = h.id;
-- ============================================================================
-- Household vault sharing. One family vault key (the owner's); the owner can "enable Vault"
-- for a household login, which gives that member a copy of the owner's password unlocker
-- (same master password, same key). Items stay encrypted with that key; `household_ids` only
-- decides WHO CAN FETCH a row:
--   owner  → sees every item: their own + everything their members add
--   member → sees items shared with their household (read-only) + items they add
-- The owner manages their members' unlocker rows (enable/disable vault, password sync).
-- ============================================================================
alter table public.vault_items add column if not exists household_ids uuid[] not null default '{}';
create index if not exists vault_items_household_ids_idx on public.vault_items using gin (household_ids);

create or replace function private.my_member_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.user_id from public.household_members m
  join public.households h on h.id = m.household_id
  where h.user_id = auth.uid()
$$;
revoke execute on function private.my_member_ids() from public, anon;
grant execute on function private.my_member_ids() to authenticated;

drop policy if exists "own rows" on public.vault_unlockers;
drop policy if exists "own or member rows" on public.vault_unlockers;
create policy "own or member rows" on public.vault_unlockers for all to authenticated
  using (user_id = (select auth.uid()) or user_id in (select private.my_member_ids()))
  with check (user_id = (select auth.uid()) or user_id in (select private.my_member_ids()));

-- Reading: own, members' (owner), or shared with one of my households (member).
-- Writing: only own rows, or members' rows (owner) — so members can't edit shared items.
drop policy if exists "own rows" on public.vault_items;
drop policy if exists "read own member or shared" on public.vault_items;
drop policy if exists "write own or member" on public.vault_items;
drop policy if exists "insert own or member" on public.vault_items;
drop policy if exists "update own or member" on public.vault_items;
drop policy if exists "delete own or member" on public.vault_items;
create policy "read own member or shared" on public.vault_items for select to authenticated
  using (user_id = (select auth.uid()) or user_id in (select private.my_member_ids())
         or household_ids && (select coalesce(array_agg(x), '{}') from private.my_household_ids() x));
create policy "insert own or member" on public.vault_items for insert to authenticated
  with check (user_id = (select auth.uid()) or user_id in (select private.my_member_ids()));
create policy "update own or member" on public.vault_items for update to authenticated
  using (user_id = (select auth.uid()) or user_id in (select private.my_member_ids()))
  with check (user_id = (select auth.uid()) or user_id in (select private.my_member_ids()));
create policy "delete own or member" on public.vault_items for delete to authenticated
  using (user_id = (select auth.uid()) or user_id in (select private.my_member_ids()));

-- Hisab categories, managed by the owner in Settings (per household; seeded with the defaults
-- from src/lib/hisab.js the first time a household opens Hisab).
create table if not exists public.hisab_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  direction text not null default 'out' check (direction in ('out','in')),
  name text not null,
  icon text not null default '🏷️',
  position integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.hisab_categories enable row level security;
drop policy if exists "household rows" on public.hisab_categories;
create policy "household rows" on public.hisab_categories for all to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));
create index if not exists hisab_categories_household_id_idx on public.hisab_categories (household_id, direction, position);
create index if not exists hisab_categories_user_id_idx on public.hisab_categories (user_id);

-- For a household member: the name of the family owner's first household (e.g. "Arpan"),
-- shown as "Shared by …" on vault items. Returns null for the owner or anyone else.
create or replace function public.family_owner_name()
returns text language sql stable security definer set search_path = '' as $$
  select h.name from public.households h
  where h.user_id = (select o.user_id from public.households o
                     join public.household_members m on m.household_id = o.id
                     where m.user_id = auth.uid() limit 1)
  order by h.created_at limit 1
$$;
revoke execute on function public.family_owner_name() from public, anon;
grant execute on function public.family_owner_name() to authenticated;
alter table public.hisab_categories drop constraint if exists hisab_categories_household_direction_name_key;
alter table public.hisab_categories add constraint hisab_categories_household_direction_name_key unique (household_id, direction, name);

-- Quick-add phones (Android app widget). A phone is paired to one household with a one-time
-- code created in Settings → Phone widget; the `quickadd` Edge Function exchanges it for a
-- device token (only its SHA-256 is stored) that can add Hisab / Budget entries to that
-- household and read the names its pickers need — nothing else. Delete the row to unpair.
create table if not exists public.quick_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null default 'Phone',
  default_target text not null default 'hisab' check (default_target in ('hisab','budget')),
  pair_code_hash text,
  pair_expires timestamptz,
  token_hash text unique,
  paired_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.quick_devices enable row level security;
drop policy if exists "household rows" on public.quick_devices;
create policy "household rows" on public.quick_devices for select to authenticated
  using (household_id in (select private.my_household_ids()));
drop policy if exists "own insert" on public.quick_devices;
create policy "own insert" on public.quick_devices for insert to authenticated
  with check (user_id = (select auth.uid()) and household_id in (select private.my_household_ids()) and token_hash is null);
drop policy if exists "household update" on public.quick_devices;
create policy "household update" on public.quick_devices for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));
drop policy if exists "household delete" on public.quick_devices;
create policy "household delete" on public.quick_devices for delete to authenticated
  using (household_id in (select private.my_household_ids()));
-- The client may only change the name and the default; tokens are set by the function.
revoke update on public.quick_devices from authenticated;
grant update (name, default_target) on public.quick_devices to authenticated;
create index if not exists quick_devices_household_id_idx on public.quick_devices (household_id);
create index if not exists quick_devices_user_id_idx on public.quick_devices (user_id);
create index if not exists quick_devices_pair_code_idx on public.quick_devices (pair_code_hash) where pair_code_hash is not null;
-- Bank SMS capture (Android app). The phone parses bank SMS itself and sends only
-- { direction, amount, date, account/card last digits, payee, UPI ref, bank } — never the SMS.
-- A capture waits in the household's "To add" list until it is filed (Hisab / Budget entry),
-- ignored, or matched to an entry already added by hand.
create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  device_id uuid references public.quick_devices(id) on delete set null,
  direction text not null check (direction in ('out','in')),
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null,
  account_hint text,
  card boolean not null default false,
  payee text,
  ref text,
  bank text,
  status text not null default 'new' check (status in ('new','filed','ignored','matched')),
  target text check (target in ('hisab','budget')),
  entry_id uuid,
  match_target text check (match_target in ('hisab','budget')),
  match_entry_id uuid,
  created_at timestamptz not null default now(),
  filed_at timestamptz,
  constraint captures_household_ref_key unique (household_id, ref)
);
alter table public.captures enable row level security;
drop policy if exists "household rows" on public.captures;
create policy "household rows" on public.captures for all to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));
create index if not exists captures_household_status_idx on public.captures (household_id, status, created_at desc);
create index if not exists captures_user_id_idx on public.captures (user_id);
create index if not exists captures_device_id_idx on public.captures (device_id);

-- What was chosen last time for a payee ('payee:<name or vpa>') or a card/account
-- ('acct:<bank>:<digits>'), so the next capture comes pre-filled; `auto` files it on arrival.
create table if not exists public.capture_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  key text not null,
  target text check (target in ('hisab','budget')),
  category text,
  category_id uuid references public.categories(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  source text,
  book_id uuid references public.hisab_books(id) on delete set null,
  hits integer not null default 0,
  auto boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint capture_rules_household_key_key unique (household_id, key)
);
alter table public.capture_rules enable row level security;
drop policy if exists "household rows" on public.capture_rules;
create policy "household rows" on public.capture_rules for all to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));
create index if not exists capture_rules_user_id_idx on public.capture_rules (user_id);
create index if not exists capture_rules_category_id_idx on public.capture_rules (category_id);
create index if not exists capture_rules_account_id_idx on public.capture_rules (account_id);
create index if not exists capture_rules_book_id_idx on public.capture_rules (book_id);

-- Files a capture as a Hisab or Budget entry and remembers the choice. Used by the quickadd
-- Edge Function (service role, acting as the paired phone's user) and, through file_capture
-- below, by the web app. Returns { id, target } or { already: status }.
create or replace function public.file_capture_as(
  p_user uuid, p_capture uuid, p_target text, p_category text default null, p_category_id uuid default null,
  p_account_id uuid default null, p_source text default null, p_book_id uuid default null, p_note text default null,
  p_auto boolean default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.captures;
  v_target text := case when p_target = 'budget' then 'budget' else 'hisab' end;
  v_cat_id uuid; v_acct uuid; v_book uuid; v_entry uuid; v_source text;
begin
  select * into c from public.captures where id = p_capture for update;
  if not found then raise exception 'Capture not found'; end if;
  if c.status <> 'new' then return jsonb_build_object('already', c.status, 'id', c.entry_id, 'target', c.target); end if;

  if v_target = 'budget' then
    select id into v_cat_id from public.categories where id = p_category_id and household_id = c.household_id
      and kind = case when c.direction = 'in' then 'income' else 'expense' end;
    select id into v_acct from public.accounts where id = p_account_id and household_id = c.household_id;
    insert into public.transactions (user_id, household_id, kind, amount, occurred_on, note, category_id, account_id)
    values (p_user, c.household_id, case when c.direction = 'in' then 'income' else 'expense' end, c.amount, c.occurred_on,
            coalesce(nullif(trim(p_note), ''), c.payee), v_cat_id, v_acct)
    returning id into v_entry;
  else
    select id into v_book from public.hisab_books where id = p_book_id and household_id = c.household_id;
    if v_book is null then
      select id into v_book from public.hisab_books where household_id = c.household_id and kind = 'daily' order by created_at limit 1;
    end if;
    if v_book is null then
      insert into public.hisab_books (user_id, household_id, name, kind) values (p_user, c.household_id, 'Daily', 'daily') returning id into v_book;
    end if;
    v_source := coalesce(nullif(trim(p_source), ''), case when c.card then 'Card' else 'UPI' end);
    insert into public.hisab_entries (user_id, household_id, book_id, direction, amount, occurred_on, category, source, note)
    values (p_user, c.household_id, v_book, c.direction, c.amount, c.occurred_on, nullif(trim(p_category), ''), v_source,
            coalesce(nullif(trim(p_note), ''), c.payee))
    returning id into v_entry;
  end if;

  update public.captures set status = 'filed', target = v_target, entry_id = v_entry, filed_at = now() where id = c.id;

  if c.payee is not null and trim(c.payee) <> '' then
    insert into public.capture_rules as r (user_id, household_id, key, target, category, category_id, account_id, source, book_id, hits, auto)
    values (p_user, c.household_id, 'payee:' || lower(trim(c.payee)), v_target, nullif(trim(p_category), ''), v_cat_id, v_acct,
            case when v_target = 'hisab' then v_source end, v_book, 1, coalesce(p_auto, false))
    on conflict (household_id, key) do update set
      hits = case when r.target is not distinct from excluded.target and r.category is not distinct from excluded.category
                   and r.category_id is not distinct from excluded.category_id then r.hits + 1 else 1 end,
      target = excluded.target, category = excluded.category, category_id = excluded.category_id,
      account_id = coalesce(excluded.account_id, r.account_id), source = coalesce(excluded.source, r.source),
      book_id = excluded.book_id, auto = coalesce(p_auto, r.auto), updated_at = now();
  end if;
  if c.account_hint is not null and v_target = 'budget' and v_acct is not null then
    insert into public.capture_rules as r (user_id, household_id, key, target, account_id, hits)
    values (p_user, c.household_id, 'acct:' || coalesce(lower(c.bank), '') || ':' || c.account_hint, 'budget', v_acct, 1)
    on conflict (household_id, key) do update set account_id = excluded.account_id, hits = r.hits + 1, updated_at = now();
  end if;
  return jsonb_build_object('id', v_entry, 'target', v_target);
end $$;
revoke execute on function public.file_capture_as(uuid, uuid, text, text, uuid, uuid, text, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.file_capture_as(uuid, uuid, text, text, uuid, uuid, text, uuid, text, boolean) to service_role;

-- Web app: file a capture of one of my households as myself.
create or replace function public.file_capture(
  p_capture uuid, p_target text, p_category text default null, p_category_id uuid default null,
  p_account_id uuid default null, p_source text default null, p_book_id uuid default null, p_note text default null,
  p_auto boolean default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.captures where id = p_capture and household_id in (select private.my_household_ids())) then
    raise exception 'Capture not found';
  end if;
  return public.file_capture_as(auth.uid(), p_capture, p_target, p_category, p_category_id, p_account_id, p_source, p_book_id, p_note, p_auto);
end $$;
revoke execute on function public.file_capture(uuid, text, text, uuid, uuid, text, uuid, text, boolean) from public, anon;
grant execute on function public.file_capture(uuid, text, text, uuid, uuid, text, uuid, text, boolean) to authenticated;

-- Automatic bank SMS filing (replaces file_capture/_as above with a p_learn flag).
drop function if exists public.file_capture(uuid, text, text, uuid, uuid, text, uuid, text, boolean);
drop function if exists public.file_capture_as(uuid, uuid, text, text, uuid, uuid, text, uuid, text, boolean);

-- Files a capture as a Hisab or Budget entry and (unless p_learn is false, e.g. an automatic guess)
-- remembers the choice for the payee. Used by the quickadd
-- Edge Function (service role, acting as the paired phone's user) and, through file_capture
-- below, by the web app. Returns { id, target } or { already: status }.
create or replace function public.file_capture_as(
  p_user uuid, p_capture uuid, p_target text, p_category text default null, p_category_id uuid default null,
  p_account_id uuid default null, p_source text default null, p_book_id uuid default null, p_note text default null,
  p_auto boolean default null, p_learn boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.captures;
  v_target text := case when p_target = 'budget' then 'budget' else 'hisab' end;
  v_cat_id uuid; v_acct uuid; v_book uuid; v_entry uuid; v_source text;
begin
  select * into c from public.captures where id = p_capture for update;
  if not found then raise exception 'Capture not found'; end if;
  if c.status <> 'new' then return jsonb_build_object('already', c.status, 'id', c.entry_id, 'target', c.target); end if;

  if v_target = 'budget' then
    select id into v_cat_id from public.categories where id = p_category_id and household_id = c.household_id
      and kind = case when c.direction = 'in' then 'income' else 'expense' end;
    select id into v_acct from public.accounts where id = p_account_id and household_id = c.household_id;
    insert into public.transactions (user_id, household_id, kind, amount, occurred_on, note, category_id, account_id)
    values (p_user, c.household_id, case when c.direction = 'in' then 'income' else 'expense' end, c.amount, c.occurred_on,
            coalesce(nullif(trim(p_note), ''), c.payee), v_cat_id, v_acct)
    returning id into v_entry;
  else
    select id into v_book from public.hisab_books where id = p_book_id and household_id = c.household_id;
    if v_book is null then
      select id into v_book from public.hisab_books where household_id = c.household_id and kind = 'daily' order by created_at limit 1;
    end if;
    if v_book is null then
      insert into public.hisab_books (user_id, household_id, name, kind) values (p_user, c.household_id, 'Daily', 'daily') returning id into v_book;
    end if;
    v_source := coalesce(nullif(trim(p_source), ''), case when c.card then 'Card' else 'UPI' end);
    insert into public.hisab_entries (user_id, household_id, book_id, direction, amount, occurred_on, category, source, note)
    values (p_user, c.household_id, v_book, c.direction, c.amount, c.occurred_on, nullif(trim(p_category), ''), v_source,
            coalesce(nullif(trim(p_note), ''), c.payee))
    returning id into v_entry;
  end if;

  update public.captures set status = 'filed', target = v_target, entry_id = v_entry, filed_at = now() where id = c.id;

  if p_learn and c.payee is not null and trim(c.payee) <> '' then
    insert into public.capture_rules as r (user_id, household_id, key, target, category, category_id, account_id, source, book_id, hits, auto)
    values (p_user, c.household_id, 'payee:' || lower(trim(c.payee)), v_target, nullif(trim(p_category), ''), v_cat_id, v_acct,
            case when v_target = 'hisab' then v_source end, v_book, 1, coalesce(p_auto, false))
    on conflict (household_id, key) do update set
      hits = case when r.target is not distinct from excluded.target and r.category is not distinct from excluded.category
                   and r.category_id is not distinct from excluded.category_id then r.hits + 1 else 1 end,
      target = excluded.target, category = excluded.category, category_id = excluded.category_id,
      account_id = coalesce(excluded.account_id, r.account_id), source = coalesce(excluded.source, r.source),
      book_id = excluded.book_id, auto = coalesce(p_auto, r.auto), updated_at = now();
  end if;
  if p_learn and c.account_hint is not null and v_target = 'budget' and v_acct is not null then
    insert into public.capture_rules as r (user_id, household_id, key, target, account_id, hits)
    values (p_user, c.household_id, 'acct:' || coalesce(lower(c.bank), '') || ':' || c.account_hint, 'budget', v_acct, 1)
    on conflict (household_id, key) do update set account_id = excluded.account_id, hits = r.hits + 1, updated_at = now();
  end if;
  return jsonb_build_object('id', v_entry, 'target', v_target);
end $$;
revoke execute on function public.file_capture_as(uuid, uuid, text, text, uuid, uuid, text, uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.file_capture_as(uuid, uuid, text, text, uuid, uuid, text, uuid, text, boolean, boolean) to service_role;

-- Web app: file a capture of one of my households as myself.
create or replace function public.file_capture(
  p_capture uuid, p_target text, p_category text default null, p_category_id uuid default null,
  p_account_id uuid default null, p_source text default null, p_book_id uuid default null, p_note text default null,
  p_auto boolean default null, p_learn boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.captures where id = p_capture and household_id in (select private.my_household_ids())) then
    raise exception 'Capture not found';
  end if;
  return public.file_capture_as(auth.uid(), p_capture, p_target, p_category, p_category_id, p_account_id, p_source, p_book_id, p_note, p_auto, p_learn);
end $$;
revoke execute on function public.file_capture(uuid, text, text, uuid, uuid, text, uuid, text, boolean, boolean) from public, anon;
grant execute on function public.file_capture(uuid, text, text, uuid, uuid, text, uuid, text, boolean, boolean) to authenticated;

-- Bank SMS payments are added automatically (per phone; "ask first" = off). Editing the category of
-- an auto-added entry teaches its payee's rule, so the next payment to them gets it right.
alter table public.quick_devices add column if not exists auto_capture boolean not null default true;
grant update (name, default_target, auto_capture) on public.quick_devices to authenticated;

create or replace function private.learn_from_entry() returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.captures;
begin
  select * into c from public.captures where entry_id = new.id and status = 'filed' limit 1;
  if not found or c.payee is null or trim(c.payee) = '' then return new; end if;
  if tg_table_name = 'hisab_entries' then
    insert into public.capture_rules as r (user_id, household_id, key, target, category, source, book_id, hits)
    values (c.user_id, c.household_id, 'payee:' || lower(trim(c.payee)), 'hisab', nullif(trim(new.category), ''), new.source, new.book_id, 1)
    on conflict (household_id, key) do update set target = 'hisab', category = excluded.category, source = coalesce(excluded.source, r.source),
      book_id = excluded.book_id, category_id = null, hits = r.hits + 1, updated_at = now();
  else
    insert into public.capture_rules as r (user_id, household_id, key, target, category_id, account_id, hits)
    values (c.user_id, c.household_id, 'payee:' || lower(trim(c.payee)), 'budget', new.category_id, new.account_id, 1)
    on conflict (household_id, key) do update set target = 'budget', category_id = excluded.category_id, category = null,
      account_id = coalesce(excluded.account_id, r.account_id), hits = r.hits + 1, updated_at = now();
  end if;
  return new;
end $$;
drop trigger if exists hisab_entries_learn on public.hisab_entries;
create trigger hisab_entries_learn after update of category on public.hisab_entries
  for each row when (old.category is distinct from new.category) execute function private.learn_from_entry();
drop trigger if exists transactions_learn on public.transactions;
create trigger transactions_learn after update of category_id, account_id on public.transactions
  for each row when (old.category_id is distinct from new.category_id or old.account_id is distinct from new.account_id)
  execute function private.learn_from_entry();

-- Transfers between the family's own accounts aren't spending: a capture that pairs with an opposite one
-- (same amount, ±1 day, another account) or whose payee is marked "My account" (is_self) gets status 'transfer'.
alter table public.captures drop constraint if exists captures_status_check;
alter table public.captures add constraint captures_status_check check (status in ('new','filed','ignored','matched','transfer'));
alter table public.capture_rules add column if not exists is_self boolean not null default false;

-- Occasion books are short-lived: a payee's rule only ever remembers the Daily book, so moving one
-- payment into "Diwali" doesn't send every later payment to that payee there too.
create or replace function private.rule_book_daily_only() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.book_id is not null and not exists (select 1 from public.hisab_books where id = new.book_id and kind = 'daily') then
    new.book_id := null;
  end if;
  return new;
end $$;
drop trigger if exists capture_rules_book_daily on public.capture_rules;
create trigger capture_rules_book_daily before insert or update of book_id on public.capture_rules
  for each row execute function private.rule_book_daily_only();

-- Member logins: GoTrue inserts the auth user *before* it adds app_metadata.role, so the sign-up
-- block can't rely on the role. The members Edge Function (service role) writes a one-time ticket
-- for the exact address first; the block lets only a ticketed @members address through and uses it up.
create table if not exists public.member_signup_tickets (
  email text primary key,
  expires_at timestamptz not null default now() + interval '2 minutes'
);
alter table public.member_signup_tickets enable row level security;
revoke all on public.member_signup_tickets from anon, authenticated;

create or replace function private.block_public_signups() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email like '%@members.echopdo.vercel.app'
     and exists (select 1 from public.member_signup_tickets t where t.email = lower(new.email) and t.expires_at > now()) then
    delete from public.member_signup_tickets where email = lower(new.email);
    return new;
  end if;
  raise exception 'Sign-ups are closed for eChopdo.' using errcode = '42501';
end $$;

-- The owner's own "opens on" tab per household (members have household_members.start_tab).
alter table public.households add column if not exists start_tab text not null default 'dashboard'
  check (start_tab in ('dashboard','transactions','plan','dues','hisab'));

-- When a Hisab entry happened (shown on the list): the SMS's time for captured payments (the phone
-- sends `at`; a resync fills older ones in), the time it was added for entries typed in on the day.
alter table public.hisab_entries add column if not exists occurred_at timestamptz;
alter table public.captures add column if not exists occurred_at timestamptz;
-- public.file_capture_as copies captures.occurred_at into the Hisab entry it creates (see the function above; re-created with that column).

-- Cards & bank accounts (Hisab ↔ Budget link). A Budget account can be a real instrument: the last
-- digits bank SMS show for it, and for a credit card its statement (cut-off) and due days. Hisab entries
-- and captures point at the instrument they were paid from, so card spends build that card's bill in
-- Plan and bank spends count against this month.
alter table public.accounts add column if not exists digits text[] not null default '{}';
alter table public.accounts add column if not exists bank text;
alter table public.accounts add column if not exists statement_day smallint check (statement_day between 1 and 31);
alter table public.accounts add column if not exists due_day smallint check (due_day between 1 and 31);
alter table public.hisab_entries add column if not exists account_id uuid references public.accounts(id) on delete set null;
alter table public.captures add column if not exists account_id uuid references public.accounts(id) on delete set null;
alter table public.recurring_items add column if not exists auto_card boolean not null default false;
create index if not exists hisab_entries_account_id_idx on public.hisab_entries (account_id, occurred_on);
create index if not exists captures_account_id_idx on public.captures (account_id);

-- The account an SMS's last digits belong to: digits match by suffix (SMS show 3–4 digits); when two
-- accounts share digits, the one with the same bank wins.
create or replace function private.instrument_for(p_household uuid, p_bank text, p_hint text) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.id from public.accounts a, unnest(a.digits) d
  where p_hint is not null and a.household_id = p_household and length(d) >= 3 and length(p_hint) >= 3
    and right(d, least(length(d), length(p_hint))) = right(p_hint, least(length(d), length(p_hint)))
  order by (lower(coalesce(a.bank, '')) = lower(coalesce(p_bank, ''))) desc, a.created_at
  limit 1
$$;

-- Re-point a household's captures, and the Hisab entries made from them, after digits change.
create or replace function private.relink_instruments(p_household uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.captures c set account_id = private.instrument_for(c.household_id, c.bank, c.account_hint)
    where c.household_id = p_household
      and c.account_id is distinct from private.instrument_for(c.household_id, c.bank, c.account_hint);
  update public.hisab_entries e set account_id = c.account_id
    from public.captures c
    where c.household_id = p_household and c.entry_id = e.id and c.target = 'hisab'
      and e.account_id is distinct from c.account_id;
end $$;

-- A card with a statement day has one automatic Plan line ("<card> bill") whose amount Plan computes
-- from the card's spends. Kept in step with the card here.
create or replace function private.sync_card_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cat uuid;
begin
  if tg_op = 'INSERT' or new.digits is distinct from old.digits or new.bank is distinct from old.bank then
    perform private.relink_instruments(new.household_id);
  end if;
  if new.type = 'card' and new.statement_day is not null then
    if exists (select 1 from public.recurring_items where account_id = new.id and auto_card) then
      update public.recurring_items set name = trim(new.name) || ' bill', day_of_month = new.due_day, active = true
        where account_id = new.id and auto_card;
    else
      select id into v_cat from public.categories where household_id = new.household_id and kind = 'expense' and lower(trim(name)) = 'card bills';
      if v_cat is null then
        insert into public.categories (user_id, household_id, name, kind, color)
          values (new.user_id, new.household_id, 'Card bills', 'expense', '#8b5cf6') returning id into v_cat;
      end if;
      insert into public.recurring_items (user_id, household_id, name, kind, category_id, account_id, expected_amount, day_of_month, auto_card)
        values (new.user_id, new.household_id, trim(new.name) || ' bill', 'expense', v_cat, new.id, 0, new.due_day, true);
    end if;
  else
    update public.recurring_items set active = false where account_id = new.id and auto_card and active;
  end if;
  return new;
end $$;
create or replace trigger accounts_sync_card after insert or update of digits, bank, type, statement_day, due_day, name on public.accounts
  for each row execute function private.sync_card_account();

-- Filing a capture records the instrument on the capture and on the entry it makes.
create or replace function public.file_capture_as(p_user uuid, p_capture uuid, p_target text, p_category text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_account_id uuid DEFAULT NULL::uuid, p_source text DEFAULT NULL::text, p_book_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_auto boolean DEFAULT NULL::boolean, p_learn boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.captures;
  v_target text := case when p_target = 'budget' then 'budget' else 'hisab' end;
  v_cat_id uuid; v_acct uuid; v_book uuid; v_entry uuid; v_source text; v_inst uuid;
begin
  select * into c from public.captures where id = p_capture for update;
  if not found then raise exception 'Capture not found'; end if;
  if c.status <> 'new' then return jsonb_build_object('already', c.status, 'id', c.entry_id, 'target', c.target); end if;
  v_inst := private.instrument_for(c.household_id, c.bank, c.account_hint);

  if v_target = 'budget' then
    select id into v_cat_id from public.categories where id = p_category_id and household_id = c.household_id
      and kind = case when c.direction = 'in' then 'income' else 'expense' end;
    select id into v_acct from public.accounts where id = coalesce(p_account_id, v_inst) and household_id = c.household_id;
    insert into public.transactions (user_id, household_id, kind, amount, occurred_on, note, category_id, account_id)
    values (p_user, c.household_id, case when c.direction = 'in' then 'income' else 'expense' end, c.amount, c.occurred_on,
            coalesce(nullif(trim(p_note), ''), c.payee), v_cat_id, v_acct)
    returning id into v_entry;
  else
    select id into v_book from public.hisab_books where id = p_book_id and household_id = c.household_id;
    if v_book is null then
      select id into v_book from public.hisab_books where household_id = c.household_id and kind = 'daily' order by created_at limit 1;
    end if;
    if v_book is null then
      insert into public.hisab_books (user_id, household_id, name, kind) values (p_user, c.household_id, 'Daily', 'daily') returning id into v_book;
    end if;
    v_source := coalesce(nullif(trim(p_source), ''), case when c.card then 'Card' else 'UPI' end);
    insert into public.hisab_entries (user_id, household_id, book_id, direction, amount, occurred_on, occurred_at, category, source, note, account_id)
    values (p_user, c.household_id, v_book, c.direction, c.amount, c.occurred_on, c.occurred_at, nullif(trim(p_category), ''), v_source,
            coalesce(nullif(trim(p_note), ''), c.payee), v_inst)
    returning id into v_entry;
  end if;

  update public.captures set status = 'filed', target = v_target, entry_id = v_entry, filed_at = now(), account_id = v_inst where id = c.id;

  if p_learn and c.payee is not null and trim(c.payee) <> '' then
    insert into public.capture_rules as r (user_id, household_id, key, target, category, category_id, account_id, source, book_id, hits, auto)
    values (p_user, c.household_id, 'payee:' || lower(trim(c.payee)), v_target, nullif(trim(p_category), ''), v_cat_id, v_acct,
            case when v_target = 'hisab' then v_source end, v_book, 1, coalesce(p_auto, false))
    on conflict (household_id, key) do update set
      hits = case when r.target is not distinct from excluded.target and r.category is not distinct from excluded.category
                   and r.category_id is not distinct from excluded.category_id then r.hits + 1 else 1 end,
      target = excluded.target, category = excluded.category, category_id = excluded.category_id,
      account_id = coalesce(excluded.account_id, r.account_id), source = coalesce(excluded.source, r.source),
      book_id = excluded.book_id, auto = coalesce(p_auto, r.auto), updated_at = now();
  end if;
  if p_learn and c.account_hint is not null and v_target = 'budget' and v_acct is not null then
    insert into public.capture_rules as r (user_id, household_id, key, target, account_id, hits)
    values (p_user, c.household_id, 'acct:' || coalesce(lower(c.bank), '') || ':' || c.account_hint, 'budget', v_acct, 1)
    on conflict (household_id, key) do update set account_id = excluded.account_id, hits = r.hits + 1, updated_at = now();
  end if;
  return jsonb_build_object('id', v_entry, 'target', v_target);
end $function$;

-- Bank + digits seen in a household's SMS that no account claims yet (Settings → "From your SMS").
create or replace function public.unlinked_instruments(p_household uuid)
returns table (bank text, digits text, card boolean, n bigint, total numeric, last_seen date)
language sql stable security definer set search_path = '' as $$
  select c.bank, c.account_hint, bool_or(c.card), count(*), sum(c.amount), max(c.occurred_on)
  from public.captures c
  where c.household_id = p_household and p_household in (select private.my_household_ids())
    and c.account_hint is not null and private.instrument_for(c.household_id, c.bank, c.account_hint) is null
  group by c.bank, c.account_hint
  order by count(*) desc
$$;
revoke execute on function public.unlinked_instruments(uuid) from public, anon;
grant execute on function public.unlinked_instruments(uuid) to authenticated;

-- A Hisab spend that is a Plan commitment's payment (SIP, LIC… debited by SMS): linked so Plan shows it
-- paid and "left to spend" doesn't count it twice. Auto-linked on insert when the amount is exactly
-- the commitment's expected amount and it isn't paid yet that month; editable in the entry sheet.
alter table public.hisab_entries add column if not exists recurring_item_id uuid references public.recurring_items(id) on delete set null;
create index if not exists hisab_entries_recurring_item_id_idx on public.hisab_entries (recurring_item_id);
create or replace function private.link_hisab_to_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.recurring_item_id is not null or new.direction <> 'out' then return new; end if;
  select r.id into new.recurring_item_id from public.recurring_items r
  where r.household_id = new.household_id and r.active and not r.auto_card and r.kind = 'expense'
    and r.expected_amount = new.amount
    and not exists (select 1 from public.transactions t where t.recurring_item_id = r.id
                    and date_trunc('month', t.occurred_on) = date_trunc('month', new.occurred_on))
    and not exists (select 1 from public.hisab_entries h where h.recurring_item_id = r.id
                    and date_trunc('month', h.occurred_on) = date_trunc('month', new.occurred_on))
  order by r.created_at limit 1;
  return new;
end $$;
create or replace trigger hisab_entries_link_plan before insert on public.hisab_entries
  for each row execute function private.link_hisab_to_plan();

-- The quickadd function (service role) looks up which card a "payment received" SMS is for.
create or replace function public.instrument_for_device(p_household uuid, p_bank text, p_hint text) returns uuid
language sql stable security definer set search_path = '' as $$ select private.instrument_for(p_household, p_bank, p_hint) $$;
revoke execute on function public.instrument_for_device(uuid, text, text) from public, anon, authenticated;
grant execute on function public.instrument_for_device(uuid, text, text) to service_role;

-- "Found in your SMS": bank+digits the household chose to hide (a closed account, someone else's card).
-- Keys are "<lower bank>:<digits>". sms_instruments replaces unlinked_instruments (same rows + hidden).
alter table public.households add column if not exists hidden_instruments text[] not null default '{}';
create or replace function public.set_instrument_hidden(p_household uuid, p_bank text, p_digits text, p_hidden boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare k text := lower(coalesce(p_bank, '')) || ':' || p_digits;
begin
  if p_household not in (select private.my_household_ids()) then raise exception 'Not your household'; end if;
  update public.households set hidden_instruments = case when p_hidden
    then (select array_agg(distinct x) from unnest(hidden_instruments || k) x)
    else array_remove(hidden_instruments, k) end
  where id = p_household;
end $$;
revoke execute on function public.set_instrument_hidden(uuid, text, text, boolean) from public, anon;
grant execute on function public.set_instrument_hidden(uuid, text, text, boolean) to authenticated;
create or replace function public.sms_instruments(p_household uuid)
returns table (bank text, digits text, card boolean, n bigint, total numeric, last_seen date, hidden boolean)
language sql stable security definer set search_path = '' as $$
  select c.bank, c.account_hint, bool_or(c.card), count(*), sum(c.amount), max(c.occurred_on),
    (lower(coalesce(c.bank, '')) || ':' || c.account_hint) = any (h.hidden_instruments)
  from public.captures c join public.households h on h.id = c.household_id
  where c.household_id = p_household and p_household in (select private.my_household_ids())
    and c.account_hint is not null and private.instrument_for(c.household_id, c.bank, c.account_hint) is null
  group by c.bank, c.account_hint, h.hidden_instruments
  order by count(*) desc
$$;
revoke execute on function public.sms_instruments(uuid) from public, anon;
grant execute on function public.sms_instruments(uuid) to authenticated;

-- A planned bill entry that a card's payment SMS took over (quickadd 'capture' kind 'bill'): its values
-- before, so the notification's Undo can put it back.
alter table public.transactions add column if not exists bill_original jsonb;
