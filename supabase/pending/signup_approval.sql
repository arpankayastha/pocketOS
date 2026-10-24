-- ============================================================================
-- Sign-up approval (Oct 2026): anyone can sign in with Google, but gets NO access until the owner
-- approves them once in Settings. Each approved person has their own separate workspace.
--   * public.signup_requests   one row per user: pending / approved / rejected (+ is_admin = the owner)
--   * new Google users         allowed through private.block_public_signups; seed_new_user only
--                              records a pending request (no household, no data)
--   * approval gate            a RESTRICTIVE policy "approved only" on every app table, so an
--                              unapproved login can read and write nothing (service role unaffected)
--   * public.decide_signup()   owner-only: approve (creates their Home workspace) or reject
-- Run AFTER loans_and_property_deals so those tables get the gate too (the loop skips missing tables).
-- ============================================================================
create table if not exists public.signup_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.signup_requests enable row level security;
revoke all on public.signup_requests from anon, authenticated;
grant select on public.signup_requests to authenticated;   -- decisions go through decide_signup() only

create or replace function private.is_approved() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.signup_requests where user_id = auth.uid() and status = 'approved')
$$;
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.signup_requests where user_id = auth.uid() and status = 'approved' and is_admin)
$$;
revoke execute on function private.is_approved() from public, anon;
revoke execute on function private.is_admin() from public, anon;
grant execute on function private.is_approved() to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Everyone who exists today is approved (member logins and the guest login included); the owner is the admin.
insert into public.signup_requests (user_id, email, name, status, is_admin, decided_at)
select u.id, coalesce(u.email, ''), coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), 'approved',
       (coalesce(u.raw_app_meta_data->>'role', '') <> 'member'
        and coalesce(u.email, '') not like '%@members.echopdo.vercel.app'
        and coalesce(u.email, '') <> 'demo@echopdo.vercel.app'),
       now()
from auth.users u
on conflict (user_id) do nothing;

drop policy if exists "read own or all as admin" on public.signup_requests;
create policy "read own or all as admin" on public.signup_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- The starter workspace (was inline in seed_new_user); run when a request is approved.
create or replace function private.seed_workspace(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare hh_id uuid;
begin
  if exists (select 1 from public.households where user_id = p_user) then return; end if;
  insert into public.households (user_id, name) values (p_user, 'Home') returning id into hh_id;
  insert into public.categories (user_id, household_id, name, kind, color) values
    (p_user, hh_id, 'Salary',        'income',  '#16a34a'),
    (p_user, hh_id, 'Freelance',     'income',  '#22c55e'),
    (p_user, hh_id, 'Other income',  'income',  '#84cc16'),
    (p_user, hh_id, 'Groceries',     'expense', '#f97316'),
    (p_user, hh_id, 'Rent',          'expense', '#ef4444'),
    (p_user, hh_id, 'Utilities',     'expense', '#eab308'),
    (p_user, hh_id, 'Transport',     'expense', '#3b82f6'),
    (p_user, hh_id, 'Dining out',    'expense', '#ec4899'),
    (p_user, hh_id, 'Shopping',      'expense', '#a855f7'),
    (p_user, hh_id, 'Health',        'expense', '#14b8a6'),
    (p_user, hh_id, 'Entertainment', 'expense', '#6366f1'),
    (p_user, hh_id, 'Other',         'expense', '#64748b');
  insert into public.accounts (user_id, household_id, name, type) values (p_user, hh_id, 'Cash', 'cash');
end $$;
revoke execute on function private.seed_workspace(uuid) from public, anon, authenticated;

-- New users: member logins are approved at once (the owner made them); everyone else only files a request.
create or replace function public.seed_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_app_meta_data->>'role', '') = 'member' or new.email like '%@members.echopdo.vercel.app' then
    insert into public.signup_requests (user_id, email, status, decided_at) values (new.id, coalesce(new.email, ''), 'approved', now())
      on conflict (user_id) do nothing;
    return new;
  end if;
  insert into public.signup_requests (user_id, email, name)
    values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
    on conflict (user_id) do nothing;
  return new;
end $$;
revoke execute on function public.seed_new_user() from public, anon, authenticated;

-- Sign-ups: ticketed member logins as before, plus Google sign-ins (which only file a request above).
-- Email/password and every other provider stay closed.
create or replace function private.block_public_signups() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email like '%@members.echopdo.vercel.app'
     and exists (select 1 from public.member_signup_tickets t where t.email = lower(new.email) and t.expires_at > now()) then
    delete from public.member_signup_tickets where email = lower(new.email);
    return new;
  end if;
  if coalesce(new.raw_app_meta_data->>'provider', '') = 'google' then
    return new;
  end if;
  raise exception 'Sign-ups are closed for eChopdo.' using errcode = '42501';
end $$;

-- Owner only: approve (creates their own empty Home workspace) or reject / remove access.
create or replace function public.decide_signup(p_user uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Only the owner can decide sign-ups.' using errcode = '42501'; end if;
  update public.signup_requests
     set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now()
   where user_id = p_user and not is_admin;
  if not found then raise exception 'No such request.' using errcode = 'P0002'; end if;
  if p_approve then perform private.seed_workspace(p_user); end if;
end $$;
revoke execute on function public.decide_signup(uuid, boolean) from public, anon;
grant execute on function public.decide_signup(uuid, boolean) to authenticated;

-- The gate: AND-ed with every existing policy, so unapproved logins see and write nothing.
do $$
declare t text;
begin
  foreach t in array array['households','household_members','quick_devices','captures','capture_rules',
    'accounts','categories','transactions','budgets','recurring_items','dues','due_entries',
    'hisab_books','hisab_entries','hisab_categories','vault_unlockers','vault_items',
    'wills','will_versions','will_log','loans','property_deals'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "approved only" on public.%I', t);
      execute format('create policy "approved only" on public.%I as restrictive for all to authenticated
        using ((select private.is_approved())) with check ((select private.is_approved()))', t);
    end if;
  end loop;
end $$;
