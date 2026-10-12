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
-- STILL TO APPLY (the migration was cancelled 3 times; run it in the SQL editor): without it only one PS5
-- controller can run at a time.
drop index if exists public.shop_sessions_one_running;
-- private.session_end(session) = started_at + minutes + paused minutes (a paused session keeps its time left);
-- private.free_systems now counts seats (PS5 = 3) and uses session_end; public_book needs `players` free seats;
-- public.public_timer(code) (anon) = sessions for a 6-character booking / session code, for the #timer screen;
-- public_my_status returns seat, pause and ends_at, and sessions started from a booking (booking_id).
