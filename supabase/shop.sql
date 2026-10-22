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
-- Floor takings go into the Cashbook automatically (owner's choice, applied 12 Oct 2026): per shop and day,
-- one Shop-book "money in" entry for cash and one for online (UPI) = that day's session payments + customer
-- deposits paid in. Recomputed on every session / deposit change. Deposit *use* isn't counted again (it was
-- counted when paid in). Days are Indian dates. Hand edits to these two entries get overwritten.
alter table public.hisab_entries add column if not exists shop_takings text check (shop_takings in ('cash', 'online'));
create unique index if not exists hisab_entries_shop_takings on public.hisab_entries (household_id, occurred_on, shop_takings) where shop_takings is not null;
insert into public.hisab_categories (user_id, household_id, direction, name, icon, position)
select h.user_id, h.id, 'in', 'Floor takings', '🕹️', 0 from public.households h
on conflict (household_id, direction, name) do nothing;
-- private.sync_floor_takings(household, day) and private.floor_takings_trigger(): see the migration
-- "floor_takings_sync_function" / "floor_takings_triggers" (sessions summed by started_at day, deposits 'add'
-- by created_at day; triggers shop_sessions_floor_takings and shop_deposits_floor_takings, both
-- `create or replace trigger … after insert or update or delete`).

-- ---------------------------------------------------------------------------------------------
-- Owner's answers (12 Oct 2026): rate card 2026 with happy hours (Wed–Fri, full day), per-head pricing
-- (PS5 has 3 controllers), monthly salaries, customer deposits usable within the month, event pricing
-- "first hour ₹200, then ₹100/hr", and job vacancies with a public page.
create table if not exists public.shop_settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  happy_days smallint[] not null default '{3,4,5}',      -- 0 = Sunday … 6 = Saturday
  updated_at timestamptz not null default now()
);
alter table public.shop_settings enable row level security;
drop policy if exists "shop reads" on public.shop_settings;
create policy "shop reads" on public.shop_settings for select to authenticated using (household_id in (select private.my_household_ids()));
drop policy if exists "admin writes" on public.shop_settings;
create policy "admin writes" on public.shop_settings for insert to authenticated with check (household_id in (select private.my_admin_household_ids()));
drop policy if exists "admin updates" on public.shop_settings;
create policy "admin updates" on public.shop_settings for update to authenticated
  using (household_id in (select private.my_admin_household_ids())) with check (household_id in (select private.my_admin_household_ids()));

alter table public.shop_rates add column if not exists happy boolean not null default false;
alter table public.shop_rates drop constraint if exists shop_rates_household_id_kind_minutes_key;
create unique index if not exists shop_rates_unique on public.shop_rates (household_id, kind, minutes, happy);

alter table public.shop_sessions add column if not exists players int not null default 1 check (players between 1 and 8);
alter table public.shop_sessions add column if not exists happy boolean not null default false;
alter table public.shop_sessions add column if not exists paid_deposit numeric(10,2) not null default 0;

alter table public.household_members add column if not exists monthly_salary numeric(10,2) not null default 0;
grant update (monthly_salary) on public.household_members to authenticated;

-- Customer deposits: money paid ahead, used on later visits in the same month (it lapses after).
create table if not exists public.shop_deposits (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  customer_name text not null,
  customer_phone text,
  kind text not null check (kind in ('add', 'use')),
  amount numeric(10,2) not null check (amount > 0),
  mode text check (mode in ('cash', 'online')),
  session_id uuid references public.shop_sessions(id) on delete set null,
  month date not null default (date_trunc('month', now() at time zone 'Asia/Kolkata'))::date,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists shop_deposits_household_month_idx on public.shop_deposits (household_id, month);
create index if not exists shop_deposits_session_idx on public.shop_deposits (session_id);
create index if not exists shop_deposits_user_idx on public.shop_deposits (user_id);
alter table public.shop_deposits enable row level security;
drop policy if exists "shop reads" on public.shop_deposits;
create policy "shop reads" on public.shop_deposits for select to authenticated using (household_id in (select private.my_household_ids()));
drop policy if exists "shop writes" on public.shop_deposits;
create policy "shop writes" on public.shop_deposits for insert to authenticated with check (household_id in (select private.my_household_ids()));
drop policy if exists "admin updates" on public.shop_deposits;
create policy "admin updates" on public.shop_deposits for update to authenticated
  using (household_id in (select private.my_admin_household_ids())) with check (household_id in (select private.my_admin_household_ids()));
drop policy if exists "admin deletes" on public.shop_deposits;
create policy "admin deletes" on public.shop_deposits for delete to authenticated using (household_id in (select private.my_admin_household_ids()));

-- Events: hourly slots, a booking takes 1..max_hours hours; price = first hour + later hours.
alter table public.shop_events add column if not exists first_hour_price numeric(10,2);
alter table public.shop_events add column if not exists next_hour_price numeric(10,2);
alter table public.shop_events add column if not exists max_hours int not null default 3 check (max_hours between 1 and 12);
alter table public.shop_event_bookings add column if not exists hours int not null default 1 check (hours between 1 and 12);
alter table public.shop_event_bookings add column if not exists amount numeric(10,2);

create or replace function private.event_slot_capacity() returns trigger language plpgsql security definer set search_path = '' as $$
declare cap int; sm int; taken int;
begin
  if new.status = 'cancelled' then return new; end if;
  select capacity, slot_minutes into cap, sm from public.shop_events where id = new.event_id for update;
  select count(*) into taken from public.shop_event_bookings b
    where b.event_id = new.event_id and b.status <> 'cancelled' and b.id <> new.id
      and tstzrange(b.slot_start, b.slot_start + make_interval(mins => b.hours * sm))
       && tstzrange(new.slot_start, new.slot_start + make_interval(mins => new.hours * sm));
  if taken >= cap then raise exception 'That slot is full.' using errcode = '23P01'; end if;
  return new;
end $$;
create or replace trigger shop_event_bookings_capacity before insert or update of slot_start, status, hours on public.shop_event_bookings
  for each row execute function private.event_slot_capacity();

-- Job vacancies: managed by the admin, open ones readable by anyone (public page /#jobs).
create table if not exists public.shop_vacancies (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  details text,
  timing text,
  pay text,
  contact text,
  open boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists shop_vacancies_household_idx on public.shop_vacancies (household_id);
alter table public.shop_vacancies enable row level security;
grant select on public.shop_vacancies to anon;
drop policy if exists "public reads open" on public.shop_vacancies;
create policy "public reads open" on public.shop_vacancies for select to anon, authenticated
  using (open or household_id in (select private.my_household_ids()));
drop policy if exists "admin writes" on public.shop_vacancies;
create policy "admin writes" on public.shop_vacancies for insert to authenticated with check (household_id in (select private.my_admin_household_ids()));
drop policy if exists "admin updates" on public.shop_vacancies;
create policy "admin updates" on public.shop_vacancies for update to authenticated
  using (household_id in (select private.my_admin_household_ids())) with check (household_id in (select private.my_admin_household_ids()));
drop policy if exists "admin deletes" on public.shop_vacancies;
create policy "admin deletes" on public.shop_vacancies for delete to authenticated using (household_id in (select private.my_admin_household_ids()));

-- The 2026 rate card and the GTA VI pricing for the existing shop.
insert into public.shop_settings (household_id) select id from public.households on conflict do nothing;
insert into public.shop_rates (household_id, kind, minutes, price, happy)
select h.id, r.kind, r.minutes, r.price, r.happy from public.households h, (values
  ('PS', 30, 60, false), ('PC', 30, 30, true), ('PC', 60, 60, true), ('PS', 30, 40, true), ('PS', 60, 80, true)
) as r(kind, minutes, price, happy)
on conflict (household_id, kind, minutes, happy) do update set price = excluded.price;
update public.shop_events set slot_minutes = 60, first_hour_price = 200, next_hour_price = 100, max_hours = 3, price = 200
  where name = 'GTA VI launch';

-- ---------------------------------------------------------------------------------------------
-- Online booking (12 Oct 2026): the "Scan to book" banner opens /#book (no login). Applied as migrations
-- "online_bookings_tables" and "online_bookings_functions":
--   shop_settings: open_time, close_time, online_booking, upi_id, upi_name
--   shop_bookings (kind PC/PS, starts_at, minutes, players, customer_name, customer_phone, amount, upi_ref,
--     status requested → confirmed → arrived | cancelled | no_show, source online/counter, session_id);
--     RLS shop reads/writes/updates, admin deletes; in the realtime publication.
--   private.shop_price(household, kind, minutes, happy) — whole hours × 1-hr rate + a half hour × 30-min rate
--   private.public_shop() — the shop (first household); private.free_systems(household, kind, from, to)
--   public.public_shop_info(), public.public_availability(day), public.public_book(kind, start, minutes,
--     players, name, phone, upi_ref) — security definer, executable by anon. public_book checks: online
--     booking on, today/tomorrow (IST), on the half hour, within shop hours, 30–180 min, players ≤ 3 on PS /
--     1 on PC, name + 10-digit mobile, free systems for every half hour (advisory lock), ≤ 3 open requests
--     per mobile, ≤ 60 online requests a day; amount = shop_price × players (happy days from settings).

-- ---------------------------------------------------------------------------------------------
-- Owner's list (12 Oct 2026, afternoon). Applied as migrations staff_designation_hourly_entered_by,
-- home_events_customers_tables, customer_google_signups, public_home_functions, customer_dues_payments,
-- fix_public_event_variable_names.

-- Staff: designation, hourly pay ₹33 (monthly_salary is no longer used).
alter table public.household_members add column if not exists designation text
  check (designation in ('Supervisor', 'Sr Manager', 'Manager', 'Trainee'));
grant update (designation) on public.household_members to authenticated;
alter table public.household_members alter column hourly_rate set default 33;
update public.household_members set hourly_rate = 33 where role = 'staff' and hourly_rate = 0;

-- Who made each entry ("me, Mayank, Mohit or Yashneel"): a name stamped on insert, and who changed the status.
create or replace function private.who_name(p_uid uuid) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select coalesce(m.display_name, initcap(m.username)) from public.household_members m where m.user_id = p_uid limit 1),
    (select initcap(coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1))) from auth.users u where u.id = p_uid),
    'Online')
$$;
revoke execute on function private.who_name(uuid) from public, anon, authenticated;
create or replace function private.stamp_entered_by() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.entered_by is null then new.entered_by := private.who_name(auth.uid()); end if;
  return new;
end $$;
revoke execute on function private.stamp_entered_by() from public, anon, authenticated;
create or replace function private.stamp_handled_by() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and auth.uid() is not null then new.handled_by := private.who_name(auth.uid()); end if;
  return new;
end $$;
revoke execute on function private.stamp_handled_by() from public, anon, authenticated;
alter table public.shop_sessions add column if not exists entered_by text;
alter table public.shop_sessions add column if not exists handled_by text;
alter table public.shop_cash add column if not exists entered_by text;
alter table public.shop_deposits add column if not exists entered_by text;
alter table public.shop_event_bookings add column if not exists entered_by text;
alter table public.shop_event_bookings add column if not exists handled_by text;
alter table public.shop_bookings add column if not exists entered_by text;
alter table public.shop_bookings add column if not exists handled_by text;
create or replace trigger shop_sessions_entered_by before insert on public.shop_sessions for each row execute function private.stamp_entered_by();
create or replace trigger shop_cash_entered_by before insert on public.shop_cash for each row execute function private.stamp_entered_by();
create or replace trigger shop_deposits_entered_by before insert on public.shop_deposits for each row execute function private.stamp_entered_by();
create or replace trigger shop_event_bookings_entered_by before insert on public.shop_event_bookings for each row execute function private.stamp_entered_by();
create or replace trigger shop_bookings_entered_by before insert on public.shop_bookings for each row execute function private.stamp_entered_by();
create or replace trigger shop_sessions_handled_by before update of status on public.shop_sessions for each row execute function private.stamp_handled_by();
create or replace trigger shop_event_bookings_handled_by before update of status on public.shop_event_bookings for each row execute function private.stamp_handled_by();
create or replace trigger shop_bookings_handled_by before update of status on public.shop_bookings for each row execute function private.stamp_handled_by();

-- Events on the public home page: slot events (GTA VI) and tournaments (Valorant: name, mobile, rank, entry fee).
alter table public.shop_events add column if not exists format text not null default 'slots' check (format in ('slots', 'tournament'));
alter table public.shop_events add column if not exists image_url text;
alter table public.shop_events add column if not exists description text;
alter table public.shop_events add column if not exists entry_fee numeric(10,2);
alter table public.shop_events add column if not exists max_entries int check (max_entries is null or max_entries > 0);
alter table public.shop_events alter column starts_on drop not null;   -- tournament "date coming soon"
alter table public.shop_events alter column ends_on drop not null;
alter table public.shop_event_bookings add column if not exists source text not null default 'counter' check (source in ('counter', 'online'));
alter table public.shop_event_bookings add column if not exists payment_ok boolean not null default true;
alter table public.shop_event_bookings add column if not exists upi_ref text;
alter table public.shop_event_bookings add column if not exists customer_id uuid references auth.users(id) on delete set null;
create index if not exists shop_event_bookings_customer_idx on public.shop_event_bookings (customer_id);

create table if not exists public.shop_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  event_id uuid not null references public.shop_events(id) on delete cascade,
  name text not null, phone text not null, rank text,
  fee numeric(10,2) not null default 0, upi_ref text,
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'cancelled')),
  source text not null default 'online' check (source in ('counter', 'online')),
  customer_id uuid references auth.users(id) on delete set null,
  entered_by text, handled_by text,
  created_at timestamptz not null default now()
);
create index if not exists shop_entries_event_idx on public.shop_entries (event_id, created_at);
create index if not exists shop_entries_household_idx on public.shop_entries (household_id);
create index if not exists shop_entries_customer_idx on public.shop_entries (customer_id);
create unique index if not exists shop_entries_one_per_phone on public.shop_entries (event_id, phone) where status <> 'cancelled';
alter table public.shop_entries enable row level security;
-- policies: "shop reads" / "shop writes" / "shop updates" (my_household_ids), "admin deletes"; entered_by / handled_by triggers.

-- Customers: Google sign-in on the home page (provider must be switched on in Supabase Auth). They never read
-- shop rows; only the public_* / customer_profile rpcs. block_public_signups lets provider = 'google' through;
-- seed_new_user gives them a shop_customers row instead of a household.
create table if not exists public.shop_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  name text, email text, phone text,
  created_at timestamptz not null default now()
);
create unique index if not exists shop_customers_phone on public.shop_customers (household_id, phone) where phone is not null;
alter table public.shop_customers enable row level security;   -- "shop reads": own row, or staff/admin
alter table public.shop_sessions add column if not exists customer_id uuid references auth.users(id) on delete set null;
alter table public.shop_bookings add column if not exists customer_id uuid references auth.users(id) on delete set null;
-- private.link_session_customer (session phone → customer), private.link_booking_customer (signed-in booker),
-- private.session_from_booking (Arrived passes the customer to the session).

-- Home page picture: shop_settings.hero_url; public bucket "shop-media" (jpeg/png/webp, 5 MB), admin writes under
-- their shop id (policies "shop media admin insert/update/delete" on storage.objects).
alter table public.shop_settings add column if not exists hero_url text;

-- Public rpcs (security definer, anon): public_home() = public_shop_info + hero_url + jobs count + open events with
-- entries taken; public_event_slots(event, day) = free places per slot; public_event_book(event, start, hours,
-- players, name, phone, upi_ref) = online event booking (advance online, payment_ok false until staff tick it);
-- public_tournament_entry(event, name, phone, rank, upi_ref) (one per mobile, max_entries); public_my_status(booking
-- ids, event booking ids, entry ids) = what this phone / signed-in customer booked, and running sessions with time
-- left. customer_profile(name, phone) for signed-in customers.

-- Customer dues paid back later (Cash → Customer dues): lowers the session's owed and counts as money in that day
-- (dayTotals, and private.sync_floor_takings now adds shop_dues_paid by created_at day).
create table if not exists public.shop_dues_paid (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  session_id uuid references public.shop_sessions(id) on delete set null,
  customer_name text not null, customer_phone text,
  amount numeric(10,2) not null check (amount > 0),
  mode text not null check (mode in ('cash', 'online')),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  entered_by text,
  created_at timestamptz not null default now()
);
alter table public.shop_dues_paid enable row level security;   -- shop reads / shop writes / admin deletes
-- trigger shop_dues_paid_apply → private.apply_dues_paid(); realtime: shop_entries, shop_dues_paid, shop_event_bookings.
-- Seeded: "Valorant Tournament" (tournament, PC, date and fee to be set by the owner).

-- ---------------------------------------------------------------------------------------------
-- PS5 controllers, pause / resume, timer screen (12 Oct 2026, evening). Migrations controllers_pause_seats,
-- seat_availability_pause_timer, my_status_controllers_pause.
alter table public.shop_systems add column if not exists seats int not null default 1 check (seats between 1 and 8);
update public.shop_systems set seats = 3 where kind = 'PS' and seats = 1;          -- 3 controllers
alter table public.shop_sessions add column if not exists seat int not null default 1 check (seat between 1 and 8);
alter table public.shop_sessions add column if not exists paused_at timestamptz;
alter table public.shop_sessions add column if not exists paused_minutes numeric(10,2) not null default 0;
alter table public.shop_sessions add column if not exists booking_id uuid references public.shop_bookings(id) on delete set null;
create index if not exists shop_sessions_booking_idx on public.shop_sessions (booking_id);
create unique index if not exists shop_sessions_one_running_seat on public.shop_sessions (system_id, seat) where status = 'running';
-- Applied by the owner in the SQL editor (12 Oct): the old one-running-session-per-system index.
drop index if exists public.shop_sessions_one_running;
-- private.session_end(session) = started_at + minutes + paused minutes (a paused session keeps its time left);
-- private.free_systems now counts seats (PS5 = 3) and uses session_end; public_book needs `players` free seats;
-- public.public_timer(code) (anon) = sessions for a 6-character booking / session code, for the #timer screen;
-- public_my_status returns seat, pause and ends_at, and sessions started from a booking (booking_id).

-- ---------------------------------------------------------------------------------------------
-- Owner's test (12 Oct, afternoon): migration controller4_cashout_budgets.
-- Controller 4 (broken until replaced): shop_systems.off_seats smallint[] (PS5: seats 4, off {4}). free_systems
-- counts working seats and each running session's `players` (2 players = 2 controllers busy).
alter table public.shop_systems add column if not exists off_seats smallint[] not null default '{}';
-- Cash out → Cashbook: shop_cash.category; private.sync_cash_out() (trigger shop_cash_to_cashbook, after insert /
-- update / delete) keeps one Shop-book "out" entry per cash out (hisab_entries.shop_cash_id, unique), paid from
-- the cash drawer account, note "… · paid by <who>".
alter table public.shop_cash add column if not exists category text;
alter table public.hisab_entries add column if not exists shop_cash_id uuid;
create unique index if not exists hisab_entries_shop_cash on public.hisab_entries (shop_cash_id) where shop_cash_id is not null;
-- Monthly budget per Cashbook out-category (e.g. Snacks stock ₹12,000): hisab_categories.monthly_limit;
-- public.shop_spend(household) = out-categories (+ limit and this month's spend for the admin).
alter table public.hisab_categories add column if not exists monthly_limit numeric(12,2) check (monthly_limit is null or monthly_limit >= 0);

-- One staff member on duty at a time (owner, 12 Oct): migration one_staff_on_duty — unique index
-- shop_shifts_one_on_duty (household_id) where clock_out is null; shop_clock('in') raises
-- "<name> is on duty since <time>. Only one person can be logged in — ask them to log out first."
create unique index if not exists shop_shifts_one_on_duty on public.shop_shifts (household_id) where clock_out is null;

-- Owner (12 Oct, 3 pm): designations Super Senior Manager / Sr Manager / Manager / Temporary Manager / Trainee
-- (migration designations_super_senior_temporary; 'Supervisor' still allowed for old rows), and pay deductions /
-- bonuses per staff per month (migration staff_pay_adjustments): admin only, never shown to staff.
create table if not exists public.shop_pay_adjustments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  staff_name text,
  month date not null,
  amount numeric(10,2) not null check (amount <> 0),   -- negative = deduction, positive = bonus
  reason text not null,
  entered_by text,
  created_at timestamptz not null default now()
);
alter table public.shop_pay_adjustments enable row level security;   -- policy "admin only" (my_admin_household_ids)

-- Owner: "amount can be anything, but when marking an expense I should claim it against the Plan"
-- (migration cash_out_claim_plan): shop_cash.recurring_item_id → the Cashbook entry's recurring_item_id;
-- public.shop_plan_items(household) = expense Plan items (+ expected / claimed this month for the admin).
-- Plan (runway.js) adds up several claims per item in a month. The category monthly_limit preset was undone.
alter table public.shop_cash add column if not exists recurring_item_id uuid references public.recurring_items(id) on delete set null;

-- Staff bookings for customers who call (Slots → + Book), migration counter_bookings_paid: shop_bookings with
-- source 'counter', status 'confirmed', paid (advance, 0 = pay at the counter), paid_mode, note. An advance is
-- also saved as the customer's deposit (money in that day), used in the End sheet when they play.
alter table public.shop_bookings add column if not exists paid numeric(10,2) check (paid is null or paid >= 0);
alter table public.shop_bookings add column if not exists paid_mode text check (paid_mode in ('cash', 'online'));
alter table public.shop_bookings add column if not exists note text;

-- Customer look-up while typing a name or mobile (owner, 12 Oct): migration customer_search —
-- public.shop_customer_search(household, q) (shop staff / admin): one row per mobile from sessions, bookings,
-- deposits, event bookings and signed-up customers, latest name, visits, last seen; matched by name word start
-- or mobile digits; max 8. Index shop_sessions_household_phone_idx.

-- App PIN (owner, 12 Oct: "on the shop PC it opened straight away"), migration app_pin_lock:
-- private.app_pins (user_id, bcrypt hash, fails); public.app_pin_status() {set, fresh}, set_app_pin(pin, current)
-- (current PIN needed unless none yet or signed in within 10 min — private.fresh_sign_in() reads the JWT "amr"),
-- check_app_pin(pin) {ok, left} (5 wrong in a row → the client signs out), app_pin_signed_in() resets the count.
create table if not exists private.app_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hash text not null,
  fails int not null default 0,
  updated_at timestamptz not null default now()
);

-- Staff who signed in with Google before linking (owner, 12 Oct — Mohit), migration admin_link_staff_google:
-- public.link_staff_google(staff, gmail) — admin only, onto their own staff, from a plain customer account: moves
-- the Google identity onto the staff login, bans the leftover customer account. public.staff_google(household)
-- = staff user_id → linked Gmail, for the staff cards.

-- Owner (12 Oct, 6 pm): migrations shop_day_hours, customer_list_hide.
-- shop_day_hours (household, day, open_time, close_time, closed): hours for one date, set from Slots → Calendar →
-- Hours (staff + admin); private.day_hours(household, day) → open_at / close_at (null = closed) is used by
-- public_availability and public_book. shop_customer_hidden (household, phone): numbers the admin removed from the
-- customer drop-down; shop_customer_search skips them.
-- public.unlink_staff_google(staff) (migration admin_unlink_staff_google): admin only; marks the staff login's
-- Google identity 'google-unlinked' (no delete) so another Gmail can be linked.

-- Jobs page for signed-out visitors (12 Oct): the old "public reads open" policy called
-- private.my_household_ids(), which anon can't execute ("permission denied for function"). Split it:
-- signed-in users keep the old rule, anon reads open rows only.
alter policy "public reads open" on public.shop_vacancies to authenticated;
create policy "anon reads open" on public.shop_vacancies for select to anon using (open);

-- ===== Multiple admins (owner, 12 Oct; migration multiple_admins) =====
-- Besides the household owner, any number of admins with the owner's rights, managed from Staff → Admins.
-- Added by the Gmail they signed in with (or a staff username); their app_metadata.role becomes 'admin', so
-- the app opens the admin shell. Removing sets removed_at (no deletes) and drops the role again.
create table if not exists public.shop_admins (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by text,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (household_id, user_id)
);
alter table public.shop_admins enable row level security;
create index if not exists shop_admins_user_idx on public.shop_admins (user_id);

create or replace function private.my_admin_household_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select h.id from public.households h where h.user_id = auth.uid()
  union
  select a.household_id from public.shop_admins a where a.user_id = auth.uid() and a.removed_at is null
$$;
create or replace function private.my_household_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select h.id from public.households h where h.user_id = auth.uid()
  union
  select a.household_id from public.shop_admins a where a.user_id = auth.uid() and a.removed_at is null
  union
  select m.household_id from public.household_members m where m.user_id = auth.uid() and m.role = 'staff'
$$;

create policy "admins read" on public.shop_admins for select to authenticated
  using (household_id in (select private.my_admin_household_ids()));

alter policy "owner or self reads" on public.household_members
  using (user_id = (select auth.uid()) or household_id in (select private.my_admin_household_ids()));
alter policy "owner updates staff" on public.household_members
  using (household_id in (select private.my_admin_household_ids()))
  with check (household_id in (select private.my_admin_household_ids()));
alter policy "owner updates" on public.households
  using (id in (select private.my_admin_household_ids()))
  with check (id in (select private.my_admin_household_ids()));

create or replace function public.shop_admin_list(p_household uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_household not in (select private.my_admin_household_ids()) then raise exception 'Admins only.'; end if;
  return (select coalesce(jsonb_agg(x order by x->>'since'), '[]') from (
    select jsonb_build_object('user_id', u.id, 'email', u.email, 'owner', true, 'since', h.created_at,
      'name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'username', split_part(u.email, '@', 1))) x
    from public.households h join auth.users u on u.id = h.user_id where h.id = p_household
    union all
    select jsonb_build_object('user_id', u.id, 'email', u.email, 'owner', false, 'since', a.created_at, 'added_by', a.added_by,
      'name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)))
    from public.shop_admins a join auth.users u on u.id = a.user_id where a.household_id = p_household and a.removed_at is null) t);
end $$;

create or replace function public.add_shop_admin(p_household uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user auth.users; v_email text := lower(trim(coalesce(p_email, '')));
begin
  if p_household not in (select private.my_admin_household_ids()) then raise exception 'Admins only.'; end if;
  if v_email !~ '@' then v_email := v_email || '@staff.grandxgamer.app'; end if;
  select * into v_user from auth.users u where lower(u.email) = v_email limit 1;
  if v_user.id is null then raise exception 'No sign-in found for %. Ask them to sign in once with Google on the home page, then add them again.', p_email; end if;
  if exists (select 1 from public.households h where h.id = p_household and h.user_id = v_user.id) then raise exception 'They are already the owner.'; end if;
  if exists (select 1 from public.household_members m where m.user_id = v_user.id and m.role = 'staff') then
    raise exception 'That is a staff login. Remove it from Staff first, or add their Gmail instead.'; end if;
  insert into public.shop_admins (household_id, user_id, added_by) values (p_household, v_user.id, private.who_name(auth.uid()))
    on conflict (household_id, user_id) do update set removed_at = null, created_at = now(), added_by = excluded.added_by;
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"admin"}' where id = v_user.id;
  return jsonb_build_object('user_id', v_user.id, 'email', v_user.email);
end $$;

create or replace function public.remove_shop_admin(p_household uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_household not in (select private.my_admin_household_ids()) then raise exception 'Admins only.'; end if;
  if exists (select 1 from public.households h where h.id = p_household and h.user_id = p_user) then raise exception 'The owner can''t be removed.'; end if;
  update public.shop_admins a set removed_at = now() where a.household_id = p_household and a.user_id = p_user;
  if not exists (select 1 from public.shop_admins a where a.user_id = p_user and a.removed_at is null) then
    update auth.users set raw_app_meta_data = raw_app_meta_data - 'role' where id = p_user and raw_app_meta_data->>'role' = 'admin';
  end if;
end $$;

revoke execute on function public.shop_admin_list(uuid), public.add_shop_admin(uuid, text), public.remove_shop_admin(uuid, uuid) from public, anon;
grant execute on function public.shop_admin_list(uuid), public.add_shop_admin(uuid, text), public.remove_shop_admin(uuid, uuid) to authenticated;

-- "Entered by" for Google admins: their first name, not the Gmail prefix.
create or replace function private.who_name(p_uid uuid) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select coalesce(m.display_name, initcap(m.username)) from public.household_members m where m.user_id = p_uid limit 1),
    (select coalesce(nullif(split_part(u.raw_user_meta_data->>'full_name', ' ', 1), ''), initcap(coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1))))
       from auth.users u where u.id = p_uid),
    'Online')
$$;

-- Owner (13 Oct): details first, clock later. A waiting session holds its PC / controller (status running) but is
-- paused from the moment it is saved; Slots → ▶ Start timer sets started_at = now, paused_at = null, waiting = false.
alter table public.shop_sessions add column if not exists waiting boolean not null default false;

-- Owner (13 Oct): Instagram / Facebook / YouTube icons on the home page; links in ⚙ → Home page. public_home
-- returns them as 'social' (migration home_social_links re-created public_home with that one extra key).
alter table public.shop_settings add column if not exists instagram_url text, add column if not exists facebook_url text, add column if not exists youtube_url text;
alter table public.shop_settings add column if not exists whatsapp_url text; -- WhatsApp community link (13 Oct; public_home 'social'.whatsapp)

-- ===== Lock-screen alerts (13 Oct; migrations lock_screen_push, push_alerts_cron) =====
-- The VAPID private key was stored with vault.create_secret(<key>, 'vapid_private') outside migrations; never commit it.
-- Lock-screen alerts (owner, 13 Oct): web push to staff / admin phones even with the app closed.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null, auth text not null, device text,
  created_at timestamptz not null default now(), disabled_at timestamptz
);
alter table public.push_subscriptions enable row level security;
create policy "own subscriptions" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create index if not exists push_subscriptions_household_idx on public.push_subscriptions (household_id) where disabled_at is null;

alter table public.shop_sessions add column if not exists push_5_at timestamptz, add column if not exists push_0_at timestamptz;
alter table public.shop_bookings add column if not exists push_at timestamptz;
alter table public.shop_event_bookings add column if not exists push_at timestamptz;
alter table public.shop_entries add column if not exists push_at timestamptz;

-- This phone: save / switch off its push subscription (staff and admins of the shop only).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device text, p_on boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare h uuid := (select x from private.my_household_ids() x limit 1);
begin
  if h is null then raise exception 'Staff and admins only.'; end if;
  insert into public.push_subscriptions (endpoint, household_id, user_id, p256dh, auth, device, disabled_at)
  values (p_endpoint, h, auth.uid(), p_p256dh, p_auth, left(p_device, 80), case when p_on then null else now() end)
  on conflict (endpoint) do update set household_id = excluded.household_id, user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, device = excluded.device, disabled_at = excluded.disabled_at;
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text, boolean) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text, boolean) to authenticated;

-- VAPID keys: the private one lives only in the vault; push_config is for the push-alerts function (service role).
create or replace function public.push_config() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('public', 'BDB7ggd8ragGp4KthqSfV4nX8NzVvli0FkK4XIkGhceVEo4WXZU_foxi3AajxPG9kZeaXyPfI2YBryzEfwMSEJw',
    'private', (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private' limit 1))
$$;
revoke execute on function public.push_config() from public, anon, authenticated;

-- What is due now, marked as sent in the same step (so a push never repeats): 5 min left, time up,
-- new online bookings / event advances / tournament entries to check. One row per alert × phone.
create or replace function public.push_due() returns jsonb language plpgsql security definer set search_path = '' as $$
declare alerts jsonb := '[]';
begin
  with five as (
    update public.shop_sessions s set push_5_at = now()
    where s.status = 'running' and not s.waiting and s.paused_at is null and s.push_5_at is null and s.minutes > 5
      and private.session_end(s) - interval '5 minutes' <= now() and private.session_end(s) > now()
    returning s.household_id, s.id, s.system_name, s.seat, s.customer_name),
  up as (
    update public.shop_sessions s set push_0_at = now()
    where s.status = 'running' and not s.waiting and s.paused_at is null and s.push_0_at is null
      and private.session_end(s) <= now() and private.session_end(s) > now() - interval '10 minutes'
    returning s.household_id, s.id, s.system_name, s.seat, s.customer_name),
  bk as (
    update public.shop_bookings b set push_at = now()
    where b.status = 'requested' and b.push_at is null and b.created_at > now() - interval '2 hours'
    returning b.household_id, b.id, b.kind, b.starts_at, b.customer_name, b.amount),
  ev as (
    update public.shop_event_bookings b set push_at = now()
    where b.source = 'online' and b.payment_ok = false and b.push_at is null and b.created_at > now() - interval '2 hours'
    returning b.household_id, b.id, b.customer_name, b.advance_paid),
  en as (
    update public.shop_entries x set push_at = now()
    where x.status = 'requested' and x.push_at is null and x.created_at > now() - interval '2 hours'
    returning x.household_id, x.id, x.name),
  a as (
    select household_id, '5 minutes left · ' || system_name || case when system_name like 'PS%' then ' controller ' || coalesce(seat, 1) else '' end as title,
      customer_name || ' has 5 minutes left' as body, 'end-' || id as tag, false as urgent from five
    union all select household_id, 'Time up · ' || system_name || case when system_name like 'PS%' then ' controller ' || coalesce(seat, 1) else '' end,
      customer_name || '''s time is over — extend or end', 'end-' || id, true from up
    union all select household_id, 'New online booking · ' || case when kind = 'PS' then 'PS5' else 'PC' end,
      customer_name || ' · ' || to_char(starts_at at time zone 'Asia/Kolkata', 'DD Mon HH12:MI am') || ' · ₹' || round(amount) || ' — check the UPI payment', 'bk-' || id, true from bk
    union all select household_id, 'New event booking', customer_name || ' · advance ₹' || round(advance_paid) || ' — check the UPI payment', 'ev-' || id, true from ev
    union all select household_id, 'New tournament entry', name || ' — confirm in Slots', 'en-' || id, true from en)
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth,
      'title', a.title, 'body', a.body, 'tag', a.tag, 'urgent', a.urgent)), '[]')
    into alerts
  from a join public.push_subscriptions p on p.household_id = a.household_id and p.disabled_at is null;
  return alerts;
end $$;
revoke execute on function public.push_due() from public, anon, authenticated;

-- Phones that the push service says are gone (uninstalled / permission revoked).
create or replace function public.push_drop(p_endpoints text[]) returns void language sql security definer set search_path = '' as $$
  update public.push_subscriptions set disabled_at = now() where endpoint = any(p_endpoints)
$$;
revoke execute on function public.push_drop(text[]) from public, anon, authenticated;
select cron.schedule('push-alerts', '30 seconds', $$select net.http_post(url := 'https://mziclowcokswuulqifbj.supabase.co/functions/v1/push-alerts', body := '{}'::jsonb, timeout_milliseconds := 20000)$$);

-- Owner (13 Oct): staff also get the ✕ in the customer drop-down (migration staff_hide_customer).
create policy "staff writes" on public.shop_customer_hidden for insert to authenticated
  with check (household_id in (select private.my_household_ids()));

-- Owner (13 Oct): staff can mark a PS5 controller out of order / back in use (migration staff_controller_out_of_order).
-- Only off_seats changes; systems and rates stay admin-only.
create or replace function public.set_seat_off(p_system uuid, p_seat int, p_off boolean) returns int[]
language plpgsql security definer set search_path = '' as $$
declare v int[];
begin
  update public.shop_systems y set off_seats = case when p_off
      then (select array_agg(distinct x order by x) from unnest(coalesce(y.off_seats, '{}') || p_seat) x)
      else array_remove(coalesce(y.off_seats, '{}'), p_seat) end
  where y.id = p_system and y.household_id in (select private.my_household_ids()) and p_seat between 1 and coalesce(y.seats, 1)
  returning y.off_seats into v;
  if not found then raise exception 'Not your shop, or no such controller.'; end if;
  return v;
end $$;
revoke execute on function public.set_seat_off(uuid, int, boolean) from public, anon;
grant execute on function public.set_seat_off(uuid, int, boolean) to authenticated;

-- Owner (13 Oct): staff also get the ✕ on Cash → Today lines; staff may remove only today's rows (migration staff_remove_today).
create policy "staff removes today" on public.shop_sessions for delete to authenticated
  using (household_id in (select private.my_household_ids()) and started_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
create policy "staff removes today" on public.shop_cash for delete to authenticated
  using (household_id in (select private.my_household_ids()) and at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
create policy "staff removes today" on public.shop_deposits for delete to authenticated
  using (household_id in (select private.my_household_ids()) and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
create policy "staff removes today" on public.shop_dues_paid for delete to authenticated
  using (household_id in (select private.my_household_ids()) and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');

-- Book a specific PC (owner, 13 Oct: "PC1 … PC5, jo book karna ho specific kar sake"). A booking may name a
-- system; that PC is then taken for the booked time (running session overlapping, or another booking naming it).
alter table public.shop_bookings add column if not exists system_id uuid references public.shop_systems(id) on delete set null;

create or replace function private.system_free(p_system uuid, p_start timestamptz, p_minutes int, p_skip uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
      select 1 from public.shop_sessions s where s.system_id = p_system and s.status = 'running'
        and private.session_end(s) > p_start and s.started_at < p_start + make_interval(mins => p_minutes))
    and not exists (
      select 1 from public.shop_bookings b where b.system_id = p_system and b.status in ('requested', 'confirmed')
        and (p_skip is null or b.id <> p_skip)
        and b.starts_at < p_start + make_interval(mins => p_minutes) and b.starts_at + make_interval(mins => b.minutes) > p_start)
$$;

-- Public: single-seat systems of a kind with free / taken for that time (names only).
create or replace function public.public_free_systems(p_kind text, p_start timestamptz, p_minutes int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name, 'free', private.system_free(y.id, p_start, p_minutes)) order by y.sort, y.name), '[]')
  from public.shop_systems y where y.household_id = private.public_shop() and y.kind = p_kind and y.active and coalesce(y.seats, 1) = 1
$$;
grant execute on function public.public_free_systems(text, timestamptz, int) to anon, authenticated;

-- Public booking for a named PC: same checks as public_book, plus that PC must be free (locked per PC).
create or replace function public.public_book_system(p_system uuid, p_kind text, p_start timestamptz, p_minutes int, p_players int,
  p_name text, p_phone text, p_upi_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if not exists (select 1 from public.shop_systems y where y.id = p_system and y.household_id = private.public_shop() and y.kind = p_kind and y.active) then
    raise exception 'Pick a PC from the list.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_system::text));
  if not private.system_free(p_system, p_start, p_minutes) then raise exception 'That PC just got booked for this time. Pick another.'; end if;
  r := public.public_book(p_kind, p_start, p_minutes, p_players, p_name, p_phone, p_upi_ref);
  update public.shop_bookings set system_id = p_system where id = (r->>'id')::uuid;
  return r || jsonb_build_object('system', (select name from public.shop_systems where id = p_system));
end $$;
grant execute on function public.public_book_system(uuid, text, timestamptz, int, int, text, text, text) to anon, authenticated;

-- Online booking up to 5 hours (owner, 14 Oct): public_book's length check is 30–300 minutes.
do $mig$
declare d text := pg_get_functiondef('public.public_book'::regproc);
begin
  d := replace(d, 'p_minutes > 180', 'p_minutes > 300');
  d := replace(d, 'Pick 30 minutes to 3 hours.', 'Pick 30 minutes to 5 hours.');
  execute d;
end $mig$;
-- Group booking (owner, 14 Oct: "5 persons ka daal, with name"): one online booking for a squad.
-- PC: one booking row per person (each gets a PC; group_id = the lead's booking), same time and length.
-- PS5: one booking with players = 2–3 and the other names in the note. The lead's name + mobile are
-- required; the others need a name, their mobile is optional (the lead's is used to reach them).
alter table public.shop_bookings add column if not exists group_id uuid;
create index if not exists shop_bookings_group_idx on public.shop_bookings (group_id) where group_id is not null;

create or replace function public.public_book_group(p_kind text, p_start timestamptz, p_minutes int, p_people jsonb, p_upi_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h uuid := private.public_shop(); n int := jsonb_array_length(coalesce(p_people, '[]')); r jsonb; t timestamptz;
  lead jsonb := p_people -> 0; x jsonb; i int; v_name text; v_phone text; lead_phone text; amt numeric; maxn int;
begin
  if n < 1 then raise exception 'Enter at least one name.'; end if;
  maxn := case p_kind when 'PS' then 3 else (select count(*) from public.shop_systems y where y.household_id = h and y.kind = 'PC' and y.active) end;
  if n > maxn then raise exception 'At most % people for %.', maxn, case p_kind when 'PS' then 'the PS5' else 'PCs' end; end if;
  for i in 1 .. n - 1 loop
    v_name := trim(coalesce(p_people -> i ->> 'name', ''));
    if length(v_name) < 2 or length(v_name) > 40 then raise exception 'Enter a name for player %.', i + 1; end if;
  end loop;
  if p_kind = 'PS' then
    r := public.public_book('PS', p_start, p_minutes, n, lead ->> 'name', lead ->> 'phone', p_upi_ref);
    if n > 1 then
      update public.shop_bookings set note = 'With: ' || (select string_agg(trim(e ->> 'name') || coalesce(' ' || nullif(private.clean_phone(e ->> 'phone'), ''), ''), ', ')
        from jsonb_array_elements(p_people) with ordinality as q(e, k) where k > 1) where id = (r ->> 'id')::uuid;
    end if;
    return r || jsonb_build_object('people', n);
  end if;
  -- PCs: hold the lock, check n PCs are free for the whole time, then one booking per person.
  perform pg_advisory_xact_lock(hashtext(h::text || p_kind));
  t := p_start;
  while t < p_start + make_interval(mins => p_minutes) loop
    if private.free_systems(h, p_kind, t, t + interval '30 minutes') < n then raise exception 'Not enough free PCs for % people at that time. Pick another time.', n; end if;
    t := t + interval '30 minutes';
  end loop;
  r := public.public_book('PC', p_start, p_minutes, 1, lead ->> 'name', lead ->> 'phone', p_upi_ref);
  lead_phone := private.clean_phone(lead ->> 'phone');
  update public.shop_bookings set group_id = (r ->> 'id')::uuid where id = (r ->> 'id')::uuid;
  for i in 1 .. n - 1 loop
    x := p_people -> i;
    v_phone := private.clean_phone(x ->> 'phone');
    insert into public.shop_bookings (household_id, kind, starts_at, minutes, players, customer_name, customer_phone, amount, upi_ref, source, group_id, note, push_at)
    values (h, 'PC', p_start, p_minutes, 1, trim(x ->> 'name'), case when length(coalesce(v_phone, '')) = 10 then v_phone else lead_phone end,
      (r ->> 'amount')::numeric, nullif(trim(coalesce(p_upi_ref, '')), ''), 'online', (r ->> 'id')::uuid,
      'With ' || trim(lead ->> 'name'), now());
  end loop;
  amt := (r ->> 'amount')::numeric * n;
  return r || jsonb_build_object('amount', amt, 'people', n);
end $$;
revoke execute on function public.public_book_group(text, timestamptz, int, jsonb, text) from public;
grant execute on function public.public_book_group(text, timestamptz, int, jsonb, text) to anon, authenticated;

-- Salary paid to staff (owner, 16 Oct: "salary paid option in admin; employee sees how much was paid";
-- temporary staff are paid mid-month). Admin writes; each staff member reads their own via my_pay().
create table if not exists public.shop_salary_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null,
  staff_name text,
  amount numeric(10,2) not null check (amount > 0),
  mode text not null default 'cash' check (mode in ('cash', 'online')),
  note text,
  paid_at timestamptz not null default now(),
  entered_by text,
  created_at timestamptz not null default now()
);
create index if not exists shop_salary_payments_hh_idx on public.shop_salary_payments (household_id, paid_at desc);
create index if not exists shop_salary_payments_user_idx on public.shop_salary_payments (user_id);
alter table public.shop_salary_payments enable row level security;
create policy "admin salary" on public.shop_salary_payments for all to authenticated
  using (household_id in (select private.my_admin_household_ids())) with check (household_id in (select private.my_admin_household_ids()));
create or replace trigger shop_salary_payments_entered_by before insert on public.shop_salary_payments for each row execute function private.stamp_entered_by();

-- A staff member's own pay for a month: hours × rate − deductions + bonuses, what was paid, what's left.
create or replace function public.my_pay(p_household uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); m_from timestamptz; m_to timestamptz; rate numeric; mins numeric; adj numeric; paid numeric;
begin
  if not exists (select 1 from public.household_members where household_id = p_household and user_id = uid) then raise exception 'Staff only.'; end if;
  m_from := (date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date)))::timestamp at time zone 'Asia/Kolkata';
  m_to := ((date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date)) + interval '1 month'))::timestamp at time zone 'Asia/Kolkata';
  select coalesce(hourly_rate, 0) into rate from public.household_members where household_id = p_household and user_id = uid;
  select coalesce(sum(extract(epoch from (coalesce(clock_out, now()) - clock_in)) / 60), 0) into mins
    from public.shop_shifts where household_id = p_household and user_id = uid and clock_in >= m_from and clock_in < m_to;
  select coalesce(sum(amount), 0) into adj from public.shop_pay_adjustments where household_id = p_household and user_id = uid and month = m_from::date;
  select coalesce(sum(amount), 0) into paid from public.shop_salary_payments where household_id = p_household and user_id = uid and paid_at >= m_from and paid_at < m_to;
  return jsonb_build_object('rate', rate, 'minutes', round(mins), 'earned', round(mins / 60 * rate), 'adjust', adj,
    'pay', greatest(0, round(mins / 60 * rate) + adj), 'paid', paid,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('amount', amount, 'mode', mode, 'note', note, 'at', paid_at) order by paid_at desc)
      from public.shop_salary_payments where household_id = p_household and user_id = uid and paid_at >= m_from and paid_at < m_to), '[]'));
end $$;
revoke execute on function public.my_pay(uuid, date) from public, anon;
grant execute on function public.my_pay(uuid, date) to authenticated;

-- Owner, 16 Oct: booked customers sometimes don't come on time — staff move the booking to a new time
-- (Not arrived · change time); the first booked time and every change are kept.
alter table public.shop_bookings add column if not exists first_starts_at timestamptz;
alter table public.shop_bookings add column if not exists time_changes jsonb not null default '[]';

-- Owner, 17 Oct: a session ended at night but End & collect was pressed next morning → the out time showed
-- the morning. ended_at = when play ended (the planned end if pressed late), collected_at = when it was collected.
alter table public.shop_sessions add column if not exists collected_at timestamptz;
update public.shop_sessions s set collected_at = s.ended_at, ended_at = private.session_end(s)
  where s.status = 'closed' and s.ended_at > private.session_end(s) + interval '20 minutes';
-- PC screen links (owner, 17 Oct: "staff shouldn't type a code on every PC"): each system has a secret
-- screen_token; /#screen/<token> bookmarked on that PC shows whatever runs on it, no code. public_screen(token)
-- (anon) returns the system and its running sessions (no names), plus ones that ended in the last 2 minutes.
alter table public.shop_systems add column if not exists screen_token text not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
create unique index if not exists shop_systems_screen_token on public.shop_systems (screen_token);

create or replace function public.public_screen(p_token text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare y public.shop_systems;
begin
  select * into y from public.shop_systems s where s.screen_token = p_token and s.active;
  if y.id is null then raise exception 'This screen link is not valid any more. Ask the counter for the new one.'; end if;
  return jsonb_build_object(
    'system', jsonb_build_object('name', y.name, 'kind', y.kind, 'seats', y.seats),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('system', s.system_name, 'seat', s.seat, 'seats', y.seats, 'started_at', s.started_at,
        'minutes', s.minutes, 'paused_minutes', s.paused_minutes, 'paused_at', s.paused_at, 'status', s.status, 'waiting', s.waiting, 'ends_at', private.session_end(s)) order by s.seat)
      from public.shop_sessions s
      where s.system_id = y.id and s.started_at > now() - interval '1 day'
        and (s.status = 'running' or (s.status = 'closed' and s.ended_at > now() - interval '2 minutes'))), '[]'),
    'now', now());
end $$;
revoke all on function public.public_screen(text) from public;
grant execute on function public.public_screen(text) to anon, authenticated;
-- Owner, 17 Oct: screen links read like the PC — screen_token = lower-case name (pc1, pc2 … ps5); the app sets it on
-- add / rename (ShopSettings screenSlug).
update public.shop_systems set screen_token = lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'));
-- One-call saves (18 Oct): each counter action is one database call that saves everything or nothing, so a
-- dropped connection can't leave a session paid but its deposit not used (or the other way round).
-- Security invoker: RLS applies exactly as for the old direct writes; the stamp / takings triggers still run.

-- Deposit balance for one customer, same key as the app (lib/money.js customerKey): the mobile's last 10
-- digits, or the lower-case name for deposits saved without a mobile.
create or replace function public.shop_deposit_balance(p_household uuid, p_name text, p_phone text)
returns numeric language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(case when d.kind = 'add' then d.amount else -d.amount end), 0)
  from public.shop_deposits d
  where d.household_id = p_household
    and case when right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) <> ''
      then right(regexp_replace(coalesce(d.customer_phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(p_phone, '\D', '', 'g'), 10)
      else right(regexp_replace(coalesce(d.customer_phone, ''), '\D', '', 'g'), 10) = '' and lower(trim(d.customer_name)) = lower(trim(coalesce(p_name, ''))) end
$$;

-- Take money from a deposit (inside the caller's transaction): refuses more than is left. One shop at a time
-- (advisory lock), so two phones can't spend the same balance together.
create or replace function public.shop_deposit_use(p_household uuid, p_deposit jsonb, p_session uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare amt numeric := coalesce((p_deposit->>'amount')::numeric, 0); bal numeric;
begin
  if amt <= 0 then return; end if;
  perform pg_advisory_xact_lock(hashtext('gx-deposit:' || p_household::text));
  bal := public.shop_deposit_balance(p_household, p_deposit->>'name', p_deposit->>'phone');
  if bal + 0.5 < amt then raise exception '% has only ₹% left in their deposit. Refresh and try again.', p_deposit->>'name', round(bal); end if;
  insert into public.shop_deposits (household_id, customer_name, customer_phone, kind, amount, session_id)
  values (p_household, p_deposit->>'name', nullif(p_deposit->>'phone', ''), 'use', amt, p_session);
end $$;

-- Change a running / just-ended session: p_add = amounts to add (minutes, extend_amount, fnb_while, discount,
-- paid_cash, paid_online, paid_deposit, owed — added to what's saved now, so two phones never overwrite each
-- other), p_set = status / ended_at / collected_at / closed_by, p_note = text appended to the note,
-- p_deposit = {name, phone, amount} taken from that customer's deposit in the same transaction.
create or replace function public.shop_session_save(p_session uuid, p_add jsonb default '{}', p_set jsonb default '{}', p_note text default null, p_deposit jsonb default null)
returns public.shop_sessions language plpgsql security invoker set search_path = '' as $$
declare s public.shop_sessions; a jsonb := coalesce(p_add, '{}'); t jsonb := coalesce(p_set, '{}');
  n numeric(10,2);
begin
  select * into s from public.shop_sessions where id = p_session for update;
  if s.id is null then raise exception 'This entry is gone. Refresh Slots.'; end if;
  if t->>'status' = 'closed' and s.status <> 'running' then raise exception '% was already ended. Refresh Slots.', s.system_name; end if;
  update public.shop_sessions set
    minutes = minutes + coalesce((a->>'minutes')::int, 0),
    extend_amount = extend_amount + coalesce((a->>'extend_amount')::numeric, 0),
    fnb_while = fnb_while + coalesce((a->>'fnb_while')::numeric, 0),
    discount = discount + coalesce((a->>'discount')::numeric, 0),
    paid_cash = paid_cash + coalesce((a->>'paid_cash')::numeric, 0),
    paid_online = paid_online + coalesce((a->>'paid_online')::numeric, 0),
    paid_deposit = paid_deposit + coalesce((a->>'paid_deposit')::numeric, 0),
    owed = greatest(0, owed + coalesce((a->>'owed')::numeric, 0)),
    status = coalesce(t->>'status', status),
    ended_at = case when t ? 'ended_at' then (t->>'ended_at')::timestamptz else ended_at end,
    collected_at = case when t ? 'collected_at' then (t->>'collected_at')::timestamptz else collected_at end,
    closed_by = case when t ? 'closed_by' then (t->>'closed_by')::uuid else closed_by end,
    note = case when nullif(trim(p_note), '') is null then note else concat_ws(' · ', nullif(note, ''), p_note) end
  where id = p_session returning * into s;
  if s.paid_cash < 0 or s.paid_online < 0 or s.paid_deposit < 0 then raise exception 'That would make a payment negative.'; end if;
  perform public.shop_deposit_use(s.household_id, p_deposit, s.id);
  return s;
end $$;

-- Start: the new timers (one row per PC / controller), the deposit used by each, and the booking marked
-- arrived — together. p_rows = the session rows; p_deposit = {name, phone} whose deposit pays paid_deposit.
create or replace function public.shop_start_sessions(p_rows jsonb, p_booking uuid default null, p_deposit jsonb default null)
returns uuid[] language plpgsql security invoker set search_path = '' as $$
declare r jsonb; s public.shop_sessions; ids uuid[] := '{}';
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.shop_sessions (household_id, system_id, system_name, seat, customer_name, customer_phone, base_minutes, minutes,
      gaming_amount, fnb_before, players, happy, booking_id, paid_cash, paid_online, paid_deposit, owed, note, waiting, paused_at)
    values ((r->>'household_id')::uuid, (r->>'system_id')::uuid, r->>'system_name', coalesce((r->>'seat')::int, 1), coalesce(nullif(r->>'customer_name', ''), 'Walk-in'),
      nullif(r->>'customer_phone', ''), (r->>'base_minutes')::int, (r->>'minutes')::int, coalesce((r->>'gaming_amount')::numeric, 0),
      coalesce((r->>'fnb_before')::numeric, 0), coalesce((r->>'players')::int, 1), coalesce((r->>'happy')::boolean, false), (r->>'booking_id')::uuid,
      coalesce((r->>'paid_cash')::numeric, 0), coalesce((r->>'paid_online')::numeric, 0), coalesce((r->>'paid_deposit')::numeric, 0),
      coalesce((r->>'owed')::numeric, 0), nullif(r->>'note', ''), coalesce((r->>'waiting')::boolean, false), (r->>'paused_at')::timestamptz)
    returning * into s;
    ids := ids || s.id;
    if s.paid_deposit > 0 then
      perform public.shop_deposit_use(s.household_id, coalesce(p_deposit, '{}') || jsonb_build_object('amount', s.paid_deposit), s.id);
    end if;
  end loop;
  if p_booking is not null then
    update public.shop_bookings set status = 'arrived', session_id = ids[1] where id = p_booking;
  end if;
  return ids;
end $$;

-- + Book with an advance: the booking and the advance (saved as the customer's deposit) together.
create or replace function public.shop_book_counter(p_booking jsonb, p_advance numeric default 0, p_mode text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare b public.shop_bookings;
begin
  insert into public.shop_bookings (household_id, kind, starts_at, minutes, players, customer_name, customer_phone, system_id, amount, status, source, paid, paid_mode, note)
  values ((p_booking->>'household_id')::uuid, p_booking->>'kind', (p_booking->>'starts_at')::timestamptz, (p_booking->>'minutes')::int,
    coalesce((p_booking->>'players')::int, 1), p_booking->>'customer_name', p_booking->>'customer_phone', (p_booking->>'system_id')::uuid,
    coalesce((p_booking->>'amount')::numeric, 0), 'confirmed', 'counter', coalesce(p_advance, 0), case when p_advance > 0 then p_mode end, nullif(p_booking->>'note', ''))
  returning * into b;
  if p_advance > 0 then
    insert into public.shop_deposits (household_id, customer_name, customer_phone, kind, amount, mode)
    values (b.household_id, b.customer_name, b.customer_phone, 'add', p_advance, p_mode);
  end if;
  return b.id;
end $$;

revoke all on function public.shop_deposit_balance(uuid, text, text), public.shop_deposit_use(uuid, jsonb, uuid),
  public.shop_session_save(uuid, jsonb, jsonb, text, jsonb), public.shop_start_sessions(jsonb, uuid, jsonb),
  public.shop_book_counter(jsonb, numeric, text) from public, anon;
grant execute on function public.shop_deposit_balance(uuid, text, text), public.shop_deposit_use(uuid, jsonb, uuid),
  public.shop_session_save(uuid, jsonb, jsonb, text, jsonb), public.shop_start_sessions(jsonb, uuid, jsonb),
  public.shop_book_counter(jsonb, numeric, text) to authenticated;
-- Daily self-check (18 Oct). Dues paid now sync the Cashbook on the day they're paid (before, only a later
-- session / deposit change that day picked them up).
create or replace function private.floor_takings_trigger()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_table_name in ('shop_deposits', 'shop_dues_paid') then
    if tg_op in ('UPDATE', 'DELETE') then perform private.sync_floor_takings(old.household_id, (old.created_at at time zone 'Asia/Kolkata')::date); end if;
    if tg_op in ('INSERT', 'UPDATE') then perform private.sync_floor_takings(new.household_id, (new.created_at at time zone 'Asia/Kolkata')::date); end if;
  else
    if tg_op in ('UPDATE', 'DELETE') then perform private.sync_floor_takings(old.household_id, (old.started_at at time zone 'Asia/Kolkata')::date); end if;
    if tg_op in ('INSERT', 'UPDATE') then perform private.sync_floor_takings(new.household_id, (new.started_at at time zone 'Asia/Kolkata')::date); end if;
  end if;
  return null;
end $$;
create or replace trigger shop_dues_paid_floor_takings after insert or update or delete on public.shop_dues_paid
  for each row execute function private.floor_takings_trigger();

-- public.shop_health(household, day) (admin; security invoker): the day's checks for Today → Daily check —
-- Cashbook = the day's money in; every closed bill adds up (paid + dues + dues paid); deposits used match the
-- sessions; no deposit below zero; nothing left running from an earlier day. Each check: key, label, ok, detail,
-- items [{text, session}].
create or replace function public.shop_health(p_household uuid, p_day date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  out jsonb := '[]'; items jsonb;
  m_cash numeric; m_online numeric; b_cash numeric; b_online numeric;
  ist text := 'Asia/Kolkata';
begin
  -- 1. Cashbook (Shop book "Floor takings") = sessions' payments + deposits paid in + dues paid that day.
  select coalesce(sum(paid_cash), 0), coalesce(sum(paid_online), 0) into m_cash, m_online
    from public.shop_sessions where household_id = p_household and status <> 'cancelled' and (started_at at time zone ist)::date = p_day;
  select m_cash + coalesce(sum(amount) filter (where mode = 'cash'), 0), m_online + coalesce(sum(amount) filter (where mode = 'online'), 0) into m_cash, m_online
    from public.shop_deposits where household_id = p_household and kind = 'add' and (created_at at time zone ist)::date = p_day;
  select m_cash + coalesce(sum(amount) filter (where mode = 'cash'), 0), m_online + coalesce(sum(amount) filter (where mode = 'online'), 0) into m_cash, m_online
    from public.shop_dues_paid where household_id = p_household and (created_at at time zone ist)::date = p_day;
  select coalesce(sum(amount) filter (where shop_takings = 'cash'), 0), coalesce(sum(amount) filter (where shop_takings = 'online'), 0) into b_cash, b_online
    from public.hisab_entries where household_id = p_household and occurred_on = p_day and shop_takings is not null;
  out := out || jsonb_build_object('key', 'cashbook', 'label', 'Cashbook matches the day''s money',
    'ok', abs(m_cash - b_cash) < 0.5 and abs(m_online - b_online) < 0.5,
    'detail', format('Money in: cash ₹%s · online ₹%s. Cashbook: cash ₹%s · online ₹%s.', round(m_cash), round(m_online), round(b_cash), round(b_online)), 'items', '[]'::jsonb);

  -- 2. Closed bills that don't add up: bill − paid (cash + online + deposit) − dues − dues paid back ≠ 0.
  select coalesce(jsonb_agg(jsonb_build_object('session', x.id, 'text',
      format('%s · %s: bill ₹%s, paid ₹%s, dues ₹%s, dues paid ₹%s → ₹%s %s', x.system_name, x.customer_name, round(x.bill), round(x.paid), round(x.owed), round(x.dp),
        round(abs(x.gap)), case when x.gap > 0 then 'not accounted for' else 'paid extra' end)) order by x.started_at), '[]') into items
  from (
    select s.*, s.gaming_amount + s.extend_amount + s.fnb_before + s.fnb_while - s.discount as bill,
      s.paid_cash + s.paid_online + s.paid_deposit as paid,
      coalesce((select sum(p.amount) from public.shop_dues_paid p where p.session_id = s.id), 0) as dp,
      (s.gaming_amount + s.extend_amount + s.fnb_before + s.fnb_while - s.discount) - (s.paid_cash + s.paid_online + s.paid_deposit) - s.owed
        - coalesce((select sum(p.amount) from public.shop_dues_paid p where p.session_id = s.id), 0) as gap
    from public.shop_sessions s
    where s.household_id = p_household and s.status = 'closed' and (s.started_at at time zone ist)::date = p_day
      and coalesce(s.note, '') not ilike '%written off%'
  ) x where abs(x.gap) >= 0.5;
  out := out || jsonb_build_object('key', 'bills', 'label', 'Every bill adds up', 'ok', jsonb_array_length(items) = 0,
    'detail', case when jsonb_array_length(items) = 0 then 'Paid + dues = bill for every closed session.' else jsonb_array_length(items) || ' session(s) don''t add up.' end, 'items', items);

  -- 3. Deposit used on a session (paid_deposit) = the deposit "use" rows linked to it.
  select coalesce(jsonb_agg(jsonb_build_object('session', x.id, 'text',
      format('%s · %s: session says ₹%s from deposit, deposits show ₹%s used', x.system_name, x.customer_name, round(x.paid_deposit), round(x.used)))), '[]') into items
  from (
    select s.*, coalesce((select sum(d.amount) from public.shop_deposits d where d.session_id = s.id and d.kind = 'use'), 0) as used
    from public.shop_sessions s
    where s.household_id = p_household and s.status <> 'cancelled' and (s.started_at at time zone ist)::date = p_day
  ) x where abs(x.paid_deposit - x.used) >= 0.5;
  out := out || jsonb_build_object('key', 'deposit_use', 'label', 'Deposits used match the sessions', 'ok', jsonb_array_length(items) = 0,
    'detail', case when jsonb_array_length(items) = 0 then 'Every ₹ taken from a deposit is recorded on both sides.' else jsonb_array_length(items) || ' session(s) differ.' end, 'items', items);

  -- 4. No deposit balance below zero (any day).
  select coalesce(jsonb_agg(jsonb_build_object('text', format('%s: ₹%s', x.name, round(x.bal)))), '[]') into items
  from (
    select min(d.customer_name) as name, sum(case when d.kind = 'add' then d.amount else -d.amount end) as bal
    from public.shop_deposits d where d.household_id = p_household
    group by coalesce(nullif(right(regexp_replace(coalesce(d.customer_phone, ''), '\D', '', 'g'), 10), ''), lower(trim(d.customer_name)))
  ) x where x.bal <= -0.5;
  out := out || jsonb_build_object('key', 'deposit_balance', 'label', 'No deposit below zero', 'ok', jsonb_array_length(items) = 0,
    'detail', case when jsonb_array_length(items) = 0 then 'All deposit balances are ₹0 or more.' else 'Used more than was paid in:' end, 'items', items);

  -- 5. Nothing still running from an earlier day (forgotten End & collect).
  select coalesce(jsonb_agg(jsonb_build_object('session', s.id, 'text',
      format('%s · %s: started %s, still open', s.system_name, s.customer_name, to_char(s.started_at at time zone ist, 'DD Mon HH12:MI am')))), '[]') into items
  from public.shop_sessions s
  where s.household_id = p_household and s.status = 'running' and (s.started_at at time zone ist)::date <= p_day
    and (s.started_at at time zone ist)::date < (now() at time zone ist)::date;
  out := out || jsonb_build_object('key', 'left_running', 'label', 'No entry left open overnight', 'ok', jsonb_array_length(items) = 0,
    'detail', case when jsonb_array_length(items) = 0 then 'Every earlier session was ended.' else 'End & collect these (or Cancel entry):' end, 'items', items);

  return jsonb_build_object('day', p_day, 'checks', out);
end $$;
revoke all on function public.shop_health(uuid, date) from public, anon;
grant execute on function public.shop_health(uuid, date) to authenticated;
-- Deposit returned (owner, 19 Oct: "puts in ₹100, uses ₹50, asks for ₹50 back when leaving"): shop_deposits kind
-- 'refund' (+ mode cash / online, optional note). It lowers the balance like a use and is money out that day:
-- the drawer (dayTotals) and the Cashbook's Floor takings are net of it.
alter table public.shop_deposits drop constraint if exists shop_deposits_kind_check;
alter table public.shop_deposits add constraint shop_deposits_kind_check check (kind = any (array['add', 'use', 'refund']));
alter table public.shop_deposits add column if not exists note text;

create or replace function private.sync_floor_takings(p_household uuid, p_day date)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_owner uuid; v_book uuid; v_cash numeric; v_online numeric; v_n int; v_back numeric; v_cash_acct uuid; v_bank_acct uuid; m text; amt numeric;
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
  -- deposits paid in add, deposits returned take away
  select v_cash + coalesce(sum(case when kind = 'add' then amount else -amount end) filter (where mode = 'cash'), 0),
         v_online + coalesce(sum(case when kind = 'add' then amount else -amount end) filter (where mode = 'online'), 0),
         coalesce(sum(amount) filter (where kind = 'refund'), 0)
    into v_cash, v_online, v_back
    from public.shop_deposits
    where household_id = p_household and kind in ('add', 'refund') and (created_at at time zone 'Asia/Kolkata')::date = p_day;
  select v_cash + coalesce(sum(amount) filter (where mode = 'cash'), 0), v_online + coalesce(sum(amount) filter (where mode = 'online'), 0)
    into v_cash, v_online
    from public.shop_dues_paid
    where household_id = p_household and (created_at at time zone 'Asia/Kolkata')::date = p_day;
  select id into v_cash_acct from public.accounts where household_id = p_household and type = 'cash' order by created_at limit 1;
  select id into v_bank_acct from public.accounts where household_id = p_household and type = 'bank' order by created_at limit 1;
  foreach m in array array['cash', 'online'] loop
    amt := case m when 'cash' then v_cash else v_online end;
    if amt > 0 then
      insert into public.hisab_entries (user_id, household_id, book_id, direction, amount, occurred_on, category, source, note, account_id, shop_takings)
      values (v_owner, p_household, v_book, 'in', amt, p_day, 'Floor takings', case m when 'cash' then 'Cash' else 'UPI' end,
              format('Floor takings · %s session%s%s', v_n, case when v_n = 1 then '' else 's' end,
                case when v_back > 0 then format(' · ₹%s deposit returned', round(v_back)) else '' end),
              case m when 'cash' then v_cash_acct else v_bank_acct end, m)
      on conflict (household_id, occurred_on, shop_takings) where shop_takings is not null
      do update set amount = excluded.amount, note = excluded.note, book_id = excluded.book_id;
    else
      delete from public.hisab_entries where household_id = p_household and occurred_on = p_day and shop_takings = m;
    end if;
  end loop;
end $$;
-- shop_health's Cashbook check counts deposits returned the same way (migration health_counts_deposit_refunds:
-- deposits 'add' minus 'refund' by created_at day).
-- Bank SMS on the shop phone (owner, 19 Oct): the GRANDXGAMER Android app on the café's phone reads the bank's
-- "money received" SMS and sends only amount, time, UPI ref, payer, bank (never the SMS text) to the Edge Function
-- `bank-sms`, which saves a shop_payments_in row and matches it (private.match_payment_in): a waiting online
-- booking / event advance / tournament fee of that amount is marked received, else a session whose online part is
-- that amount is linked ("✓ seen in bank"); otherwise it waits on Cash → UPI received for staff to link.

-- Phones paired from ⚙ → Bank SMS phone (admin): an 8-character code (hash, 10 min) → a device token (hash).
create table if not exists public.shop_bank_phones (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null default 'Shop phone',
  pair_code_hash text,
  pair_expires timestamptz,
  token_hash text unique,
  paired_at timestamptz,
  last_seen_at timestamptz,
  app_version text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.shop_bank_phones enable row level security;
create policy "admin reads" on public.shop_bank_phones for select to authenticated using (household_id in (select private.my_admin_household_ids()));
create policy "admin adds" on public.shop_bank_phones for insert to authenticated
  with check (household_id in (select private.my_admin_household_ids()) and token_hash is null);
create policy "admin removes" on public.shop_bank_phones for delete to authenticated using (household_id in (select private.my_admin_household_ids()));

create table if not exists public.shop_payments_in (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  phone_id uuid references public.shop_bank_phones(id) on delete set null,
  amount numeric(10,2) not null check (amount > 0),
  received_at timestamptz not null,
  ref text, payer text, bank text, account_hint text,
  status text not null default 'new' check (status in ('new', 'matched', 'ignored')),
  match_kind text check (match_kind in ('booking', 'event', 'entry', 'session')),
  match_id uuid,
  match_label text,
  matched_by text,               -- 'auto' or the staff name who linked it
  push_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists shop_payments_in_ref on public.shop_payments_in (household_id, ref) where ref is not null;
create index if not exists shop_payments_in_day on public.shop_payments_in (household_id, received_at desc);
create index if not exists shop_payments_in_match on public.shop_payments_in (match_kind, match_id);
alter table public.shop_payments_in enable row level security;
create policy "shop reads" on public.shop_payments_in for select to authenticated using (household_id in (select private.my_household_ids()));
create policy "staff links" on public.shop_payments_in for update to authenticated
  using (household_id in (select private.my_household_ids())) with check (household_id in (select private.my_household_ids()));
create policy "admin deletes" on public.shop_payments_in for delete to authenticated using (household_id in (select private.my_admin_household_ids()));
alter publication supabase_realtime add table public.shop_payments_in;
create index if not exists shop_payments_in_phone on public.shop_payments_in (phone_id);
create index if not exists shop_bank_phones_household on public.shop_bank_phones (household_id);

-- private.match_payment_in(id) (migration bank_sms_match_fn2): requests waiting for this money (online bookings
-- grouped by group_id with their summed amount, event advances with payment_ok false, tournament fees requested;
-- made from 6 h before to 10 min after the SMS) — a UPI ref the customer typed whose last 6 digits match the SMS
-- wins, else only when exactly one fits → booking(s) confirmed / payment_ok / entry confirmed. With no request
-- candidate at all: one not-yet-linked session started 8 h before–3 h after whose paid_online = the amount.
-- Sets status 'matched', match_kind / match_id / match_label, matched_by 'auto'. (Written without temp tables:
-- a version with TRUNCATE was refused by the migration runner.)
-- public.bank_sms_capture(household, phone, {amount, at, ref, payer, bank, account_hint}) (service role only,
-- called by the Edge Function bank-sms): dedupes by ref, else same amount + payer within 3 min; inserts and matches.
-- push_due() (migration push_bank_payments) also sends "₹X received from <payer>" with "✓ <match>" or
-- "Not matched — link it in Cash → UPI received" (shop_payments_in.push_at).

-- Shift auto log-out (owner, 21 Oct: Mohit stayed logged in overnight; "6 hours k bad automatically log out"),
-- migration shift_auto_logout_6h: shop_shifts.auto_out; private.auto_clock_out() ends every shift still open
-- 6 hours after Log in at clock_in + 6 h (auto_out = true); pg_cron 'shift-auto-logout' runs it every 5 min and
-- shop_clock calls it first, so the next person's Log in is never blocked by a forgotten shift.
alter table public.shop_shifts add column if not exists auto_out boolean not null default false;
create or replace function private.auto_clock_out() returns integer
language sql security definer set search_path = '' as $$
  with done as (
    update public.shop_shifts set clock_out = clock_in + interval '6 hours', auto_out = true
    where clock_out is null and clock_in <= now() - interval '6 hours' returning 1)
  select count(*)::int from done
$$;
-- shop_clock: `perform private.auto_clock_out();` after the household check; 'out' with no open shift says
-- "You were logged out automatically after 6 hours."
-- select cron.schedule('shift-auto-logout', '*/5 * * * *', $$select private.auto_clock_out()$$);
-- Owner (21 Oct): "less hours is okay, not higher" — migration shift_max_6h_check: no shift longer than 6 h,
-- also when the admin edits one (ShiftEditor says "A shift can be at most 6 hours.").
alter table public.shop_shifts add constraint shop_shifts_max_6h check (clock_out is null or clock_out - clock_in <= interval '6 hours');
-- Shift edit history (owner, 21 Oct: "edit karne pe history me dikhna chahiye kab edit kiya aur older kya tha"),
-- migration shift_edit_history: shop_shifts.edits [{from_in, from_out, to_in, to_out, at, by}], appended by the
-- trigger below whenever someone other than the staff member changes the times (admin edit, Log out now).
alter table public.shop_shifts add column if not exists edits jsonb not null default '[]';
create or replace function private.shift_edit_log() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.clock_in is distinct from old.clock_in or new.clock_out is distinct from old.clock_out)
     and auth.uid() is not null and auth.uid() is distinct from old.user_id then
    new.edits := coalesce(old.edits, '[]'::jsonb) || jsonb_build_object(
      'from_in', old.clock_in, 'from_out', old.clock_out, 'to_in', new.clock_in, 'to_out', new.clock_out,
      'at', now(), 'by', private.who_name(auth.uid()));
  end if;
  return new;
end $$;
revoke execute on function private.shift_edit_log() from public, anon, authenticated;
create or replace trigger shop_shifts_edit_log before update on public.shop_shifts for each row execute function private.shift_edit_log();
-- Extend resets the lock-screen alerts (owner, 22 Oct: no alert when an extended time ran out — push_5_at /
-- push_0_at stayed set from the first end). Migration session_push_reset_on_extend:
create or replace function private.session_push_reset() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'running' and (new.minutes is distinct from old.minutes or new.paused_minutes is distinct from old.paused_minutes
      or new.started_at is distinct from old.started_at) then
    if private.session_end(new) - interval '5 minutes' > now() then new.push_5_at := null; end if;
    if private.session_end(new) > now() then new.push_0_at := null; end if;
  end if;
  return new;
end $$;
revoke execute on function private.session_push_reset() from public, anon, authenticated;
create or replace trigger shop_sessions_push_reset before update on public.shop_sessions for each row execute function private.session_push_reset();
-- Tournament pairs (owner, 22 Oct: "entry fee 250 · ek aur banda add kar sake, do logo ka naam aur number, 500 ho
-- jayega · mandatory mat rakhna"), migration tournament_pair_entry: shop_entries.partner_name / partner_phone;
-- rpc public_tournament_join(event, name, phone, rank, upi_ref, partner_name, partner_phone) (anon) = the old
-- public_tournament_entry + an optional partner (name + 10-digit mobile, not the same number), fee = entry_fee ×
-- players. The Valorant event's entry_fee was set to 250 (per player) in the same migration.
alter table public.shop_entries add column if not exists partner_name text, add column if not exists partner_phone text;
