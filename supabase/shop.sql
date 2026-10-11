-- GRANDXGAMER shop schema. Applied on top of schema.sql (the eChopdo base) in the grandxgamer project.
-- One shop = one household owned by the admin login. Staff are household_members with role 'staff'
-- (username + PIN logins made by the `members` Edge Function). Customers (phase 2) will be members with
-- role 'customer' and never see shop or money rows.

-- ---------------------------------------------------------------------------------------------
-- Roles and pay
alter table public.household_members add column if not exists role text not null default 'staff'
  check (role in ('staff', 'customer'));
alter table public.household_members add column if not exists hourly_rate numeric(10,2) not null default 0;
alter table public.household_members add column if not exists display_name text;
grant update (hourly_rate, display_name) on public.household_members to authenticated;
drop policy if exists "owner sets start tab" on public.household_members;
create policy "owner updates staff" on public.household_members for update to authenticated
  using (household_id in (select h.id from public.households h where h.user_id = (select auth.uid())))
  with check (household_id in (select h.id from public.households h where h.user_id = (select auth.uid())));

-- Shops the caller works in: owned, or joined as staff (customers excluded).
create or replace function private.my_household_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select h.id from public.households h where h.user_id = auth.uid()
  union
  select m.household_id from public.household_members m where m.user_id = auth.uid() and m.role = 'staff'
$$;

-- Money (Budget module) is the admin's only: staff never read or write it.
create or replace function private.my_admin_household_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select h.id from public.households h where h.user_id = auth.uid()
$$;
revoke execute on function private.my_admin_household_ids() from public, anon;
grant execute on function private.my_admin_household_ids() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','budgets','recurring_items','dues','due_entries',
                           'hisab_books','hisab_entries','hisab_categories','captures','capture_rules'] loop
    execute format('drop policy if exists "household rows" on public.%I', t);
    execute format('create policy "admin rows" on public.%I for all to authenticated
      using (household_id in (select private.my_admin_household_ids()))
      with check (household_id in (select private.my_admin_household_ids()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Systems (PC1…, PS5) and the rate card per kind of system
create table if not exists public.shop_systems (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  kind text not null default 'PC',
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists public.shop_rates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null,
  minutes int not null check (minutes > 0),
  price numeric(10,2) not null check (price >= 0),
  created_at timestamptz not null default now(),
  unique (household_id, kind, minutes)
);

-- ---------------------------------------------------------------------------------------------
-- Sessions: one row per customer on a system (the sheet's rows). Amounts are worked out in the app
-- from the rate card and stored, so changing rates later never rewrites old bills.
create table if not exists public.shop_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  system_id uuid references public.shop_systems(id) on delete set null,
  system_name text not null,
  customer_name text not null default 'Walk-in',
  customer_phone text,
  started_at timestamptz not null default now(),
  base_minutes int not null check (base_minutes > 0),
  minutes int not null check (minutes > 0),
  gaming_amount numeric(10,2) not null default 0,
  extend_amount numeric(10,2) not null default 0,
  fnb_before numeric(10,2) not null default 0,
  fnb_while numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  paid_cash numeric(10,2) not null default 0,
  paid_online numeric(10,2) not null default 0,
  owed numeric(10,2) not null default 0,
  status text not null default 'running' check (status in ('running', 'closed', 'cancelled')),
  ended_at timestamptz,
  note text,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists shop_sessions_household_started_idx on public.shop_sessions (household_id, started_at desc);
create unique index if not exists shop_sessions_one_running on public.shop_sessions (system_id) where status = 'running';
create index if not exists shop_sessions_user_idx on public.shop_sessions (user_id);
create index if not exists shop_sessions_closed_by_idx on public.shop_sessions (closed_by);

-- ---------------------------------------------------------------------------------------------
-- Staff shifts (clock in / out). Staff change them only through shop_clock(); the admin can fix any.
create table if not exists public.shop_shifts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  edited_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  check (clock_out is null or clock_out >= clock_in)
);
create unique index if not exists shop_shifts_one_open on public.shop_shifts (household_id, user_id) where clock_out is null;
create index if not exists shop_shifts_household_in_idx on public.shop_shifts (household_id, clock_in desc);
create index if not exists shop_shifts_user_idx on public.shop_shifts (user_id);
create index if not exists shop_shifts_edited_by_idx on public.shop_shifts (edited_by);

create or replace function public.shop_clock(p_household uuid, p_action text)
returns public.shop_shifts language plpgsql security definer set search_path = '' as $$
declare r public.shop_shifts;
begin
  if p_household not in (select private.my_household_ids()) then
    raise exception 'Not your shop.' using errcode = '42501';
  end if;
  if p_action = 'in' then
    insert into public.shop_shifts (household_id, user_id) values (p_household, auth.uid()) returning * into r;
  elsif p_action = 'out' then
    update public.shop_shifts set clock_out = now()
      where household_id = p_household and user_id = auth.uid() and clock_out is null returning * into r;
    if r.id is null then raise exception 'You are not clocked in.'; end if;
  else
    raise exception 'Unknown action.';
  end if;
  return r;
exception when unique_violation then
  raise exception 'You are already clocked in.';
end $$;
revoke execute on function public.shop_clock(uuid, text) from public, anon;
grant execute on function public.shop_clock(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Counter cash that isn't a session payment: opening cash, cash out (snacks, repairs), cash in, counts.
create table if not exists public.shop_cash (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('open', 'in', 'out', 'count')),
  amount numeric(10,2) not null check (amount >= 0),
  note text,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists shop_cash_household_at_idx on public.shop_cash (household_id, at desc);
create index if not exists shop_cash_user_idx on public.shop_cash (user_id);

-- ---------------------------------------------------------------------------------------------
-- Events with bookable slots (GTA VI launch now, anything else later): all set in the app.
create table if not exists public.shop_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  system_kind text not null default 'PS',
  starts_on date not null,
  ends_on date not null,
  open_time time not null default '10:00',
  close_time time not null default '22:00',
  slot_minutes int not null default 120 check (slot_minutes > 0),
  capacity int not null default 1 check (capacity > 0),
  price numeric(10,2) not null default 0,
  advance numeric(10,2) not null default 0,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists shop_events_household_idx on public.shop_events (household_id, starts_on);

create table if not exists public.shop_event_bookings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  event_id uuid not null references public.shop_events(id) on delete cascade,
  slot_start timestamptz not null,
  customer_name text not null,
  customer_phone text,
  players int not null default 1 check (players > 0),
  advance_paid numeric(10,2) not null default 0,
  advance_mode text check (advance_mode in ('cash', 'online')),
  status text not null default 'booked' check (status in ('booked', 'arrived', 'cancelled')),
  note text,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists shop_event_bookings_event_idx on public.shop_event_bookings (event_id, slot_start);
create index if not exists shop_event_bookings_household_idx on public.shop_event_bookings (household_id);
create index if not exists shop_event_bookings_user_idx on public.shop_event_bookings (user_id);

-- A slot holds at most `capacity` bookings (e.g. one PS5).
create or replace function private.event_slot_capacity() returns trigger language plpgsql security definer set search_path = '' as $$
declare cap int; taken int;
begin
  if new.status = 'cancelled' then return new; end if;
  select capacity into cap from public.shop_events where id = new.event_id for update;
  select count(*) into taken from public.shop_event_bookings
    where event_id = new.event_id and slot_start = new.slot_start and status <> 'cancelled' and id <> new.id;
  if taken >= cap then raise exception 'That slot is full.' using errcode = '23P01'; end if;
  return new;
end $$;
revoke execute on function private.event_slot_capacity() from public, anon, authenticated;
drop trigger if exists shop_event_bookings_capacity on public.shop_event_bookings;
create trigger shop_event_bookings_capacity before insert or update of slot_start, status on public.shop_event_bookings
  for each row execute function private.event_slot_capacity();

-- ---------------------------------------------------------------------------------------------
-- RLS: staff and admin read the shop; staff add/update day-to-day rows; settings and deletes are admin's.
do $$
declare t text;
begin
  foreach t in array array['shop_systems','shop_rates','shop_sessions','shop_shifts','shop_cash','shop_events','shop_event_bookings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "shop reads" on public.%I', t);
    execute format('create policy "shop reads" on public.%I for select to authenticated
      using (household_id in (select private.my_household_ids()))', t);
    execute format('drop policy if exists "admin deletes" on public.%I', t);
    execute format('create policy "admin deletes" on public.%I for delete to authenticated
      using (household_id in (select private.my_admin_household_ids()))', t);
  end loop;
  -- Admin-only writes: settings and shifts (staff use shop_clock).
  foreach t in array array['shop_systems','shop_rates','shop_events','shop_shifts'] loop
    execute format('drop policy if exists "admin writes" on public.%I', t);
    execute format('create policy "admin writes" on public.%I for insert to authenticated
      with check (household_id in (select private.my_admin_household_ids()))', t);
    execute format('drop policy if exists "admin updates" on public.%I', t);
    execute format('create policy "admin updates" on public.%I for update to authenticated
      using (household_id in (select private.my_admin_household_ids()))
      with check (household_id in (select private.my_admin_household_ids()))', t);
  end loop;
  -- Day-to-day rows: anyone working in the shop.
  foreach t in array array['shop_sessions','shop_cash','shop_event_bookings'] loop
    execute format('drop policy if exists "shop writes" on public.%I', t);
    execute format('create policy "shop writes" on public.%I for insert to authenticated
      with check (household_id in (select private.my_household_ids()))', t);
    execute format('drop policy if exists "shop updates" on public.%I', t);
    execute format('create policy "shop updates" on public.%I for update to authenticated
      using (household_id in (select private.my_household_ids()))
      with check (household_id in (select private.my_household_ids()))', t);
  end loop;
end $$;

-- Live floor for every screen at once.
do $$ begin
  begin alter publication supabase_realtime add table public.shop_sessions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.shop_event_bookings; exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Starting set-up for a new shop: PC1–PC5 + PS5, rates from the old sheet, and the GTA VI launch event.
create or replace function private.seed_shop(p_household uuid) returns void language sql security definer set search_path = '' as $$
  insert into public.shop_systems (household_id, name, kind, sort) values
    (p_household, 'PC1', 'PC', 1), (p_household, 'PC2', 'PC', 2), (p_household, 'PC3', 'PC', 3),
    (p_household, 'PC4', 'PC', 4), (p_household, 'PC5', 'PC', 5), (p_household, 'PS5', 'PS', 6)
  on conflict do nothing;
  insert into public.shop_rates (household_id, kind, minutes, price) values
    (p_household, 'PC', 30, 50), (p_household, 'PC', 60, 80), (p_household, 'PS', 60, 100)
  on conflict do nothing;
  insert into public.shop_events (household_id, name, system_kind, starts_on, ends_on, open_time, close_time, slot_minutes, capacity, price, advance)
  select p_household, 'GTA VI launch', 'PS', '2026-11-19', '2026-11-23', '10:00', '22:00', 120, 1, 200, 100
  where not exists (select 1 from public.shop_events where household_id = p_household);
$$;
revoke execute on function private.seed_shop(uuid) from public, anon, authenticated;

-- Shifts outlive a removed staff login (salary history): the user link is cleared, the name is kept.
alter table public.shop_shifts add column if not exists staff_name text;
alter table public.shop_shifts alter column user_id drop not null;
alter table public.shop_shifts drop constraint if exists shop_shifts_user_id_fkey;
alter table public.shop_shifts add constraint shop_shifts_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- Floor takings go into the Cashbook automatically (owner's choice): per shop and day, one Shop-book
-- "money in" entry for cash and one for online (UPI), kept equal to that day's session payments.
-- Recomputed on every session change, so ending, extending or removing a session corrects the day.
-- Days are Indian dates of the session start. Hand edits to these two entries get overwritten.
alter table public.hisab_entries add column if not exists shop_takings text check (shop_takings in ('cash', 'online'));
create unique index if not exists hisab_entries_shop_takings on public.hisab_entries (household_id, occurred_on, shop_takings) where shop_takings is not null;

create or replace function private.sync_floor_takings(p_household uuid, p_day date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid; v_book uuid; v_cash numeric; v_online numeric; v_n int; v_cash_acct uuid; v_bank_acct uuid; m text; amt numeric;
begin
  if p_household is null or p_day is null then return; end if;
  select user_id into v_owner from public.households where id = p_household;
  select id into v_book from public.hisab_books where household_id = p_household and kind = 'daily' order by created_at limit 1;
  if v_book is null then
    insert into public.hisab_books (user_id, household_id, name, kind) values (v_owner, p_household, 'Shop', 'daily') returning id into v_book;
  end if;
  select coalesce(sum(paid_cash), 0), coalesce(sum(paid_online), 0), count(*) into v_cash, v_online, v_n
    from public.shop_sessions
    where household_id = p_household and status <> 'cancelled' and (started_at at time zone 'Asia/Kolkata')::date = p_day;
  select id into v_cash_acct from public.accounts where household_id = p_household and type = 'cash' order by created_at limit 1;
  select id into v_bank_acct from public.accounts where household_id = p_household and type = 'bank' order by created_at limit 1;
  foreach m in array array['cash', 'online'] loop
    amt := case m when 'cash' then v_cash else v_online end;
    if amt > 0 then
      insert into public.hisab_entries (user_id, household_id, book_id, direction, amount, occurred_on, category, source, note, account_id, shop_takings)
      values (v_owner, p_household, v_book, 'in', amt, p_day, 'Floor takings', case m when 'cash' then 'Cash' else 'UPI' end,
              format('Floor takings · %s session%s', v_n, case when v_n = 1 then '' else 's' end),
              case m when 'cash' then v_cash_acct else v_bank_acct end, m)
      on conflict (household_id, occurred_on, shop_takings) where shop_takings is not null
      do update set amount = excluded.amount, note = excluded.note, book_id = excluded.book_id;
    else
      delete from public.hisab_entries where household_id = p_household and occurred_on = p_day and shop_takings = m;
    end if;
  end loop;
end $$;
revoke execute on function private.sync_floor_takings(uuid, date) from public, anon, authenticated;

create or replace function private.floor_takings_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.sync_floor_takings(old.household_id, (old.started_at at time zone 'Asia/Kolkata')::date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.sync_floor_takings(new.household_id, (new.started_at at time zone 'Asia/Kolkata')::date);
  end if;
  return null;
end $$;
revoke execute on function private.floor_takings_trigger() from public, anon, authenticated;
drop trigger if exists shop_sessions_floor_takings on public.shop_sessions;
create trigger shop_sessions_floor_takings after insert or update or delete on public.shop_sessions
  for each row execute function private.floor_takings_trigger();

-- The Cashbook category for it.
insert into public.hisab_categories (user_id, household_id, direction, name, icon, position)
select h.user_id, h.id, 'in', 'Floor takings', '🕹️', 0 from public.households h
on conflict (household_id, direction, name) do nothing;

-- Fill in the days already recorded.
select private.sync_floor_takings(s.household_id, (s.started_at at time zone 'Asia/Kolkata')::date)
from (select distinct household_id, started_at from public.shop_sessions) s;
