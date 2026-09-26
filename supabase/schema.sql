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
