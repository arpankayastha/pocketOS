
-- ============================================================================
-- Loans (Budget → Loans, Oct 2026): home loan, gold loan, any other loan, plus temporary
-- "property deals" (buy / sell) with a paper checklist. Plain household rows like the rest of
-- Budget (not encrypted). The EMI maths is computed in the app (src/lib/loans.js); only the
-- loan terms and what happened since (prepayments, rate changes) are stored in `events`.
-- ============================================================================
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null default 'home' check (kind in ('home','gold','other')),
  name text not null,
  lender text,
  principal numeric(14,2) not null check (principal > 0),
  rate numeric(6,3) not null default 0,            -- annual interest, %
  tenure_months int check (tenure_months is null or tenure_months > 0),
  emi numeric(14,2),                               -- null = worked out from principal, rate, tenure
  start_date date not null,
  interest_only boolean not null default false,    -- gold loan style: interest only, principal at the end
  due_date date,                                   -- gold loan renewal / closing date
  grams numeric(8,2),                              -- gold pledged
  note text,
  events jsonb not null default '[]'::jsonb,       -- [{id, type: 'prepay'|'rate', date, amount | rate}]
  closed_on date,
  created_at timestamptz not null default now()
);
create table if not exists public.property_deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  kind text not null default 'buy' check (kind in ('buy','sell')),
  price numeric(14,2),
  book_id uuid references public.hisab_books(id) on delete set null,   -- the occasion book tracking its expenses
  due_id uuid references public.dues(id) on delete set null,           -- the due tracking payments to / from the builder or buyer
  loan_id uuid references public.loans(id) on delete set null,
  checklist jsonb not null default '[]'::jsonb,    -- [{id, label, done, where, note}] — a checklist, no files
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['loans','property_deals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "household rows" on public.%I', t);
    execute format('create policy "household rows" on public.%I for all to authenticated
      using (household_id in (select private.my_household_ids()))
      with check (household_id in (select private.my_household_ids()))', t);
  end loop;
end $$;
create index if not exists loans_household_id_idx on public.loans (household_id);
create index if not exists loans_user_id_idx on public.loans (user_id);
create index if not exists property_deals_household_id_idx on public.property_deals (household_id);
create index if not exists property_deals_user_id_idx on public.property_deals (user_id);
create index if not exists property_deals_book_id_idx on public.property_deals (book_id);
create index if not exists property_deals_due_id_idx on public.property_deals (due_id);
create index if not exists property_deals_loan_id_idx on public.property_deals (loan_id);
