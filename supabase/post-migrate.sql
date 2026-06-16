-- Run AFTER `npm run db:migrate` (which creates the public.* tables).
-- Apply via the Supabase SQL editor, `psql "$DIRECT_URL" -f supabase/post-migrate.sql`,
-- or the Supabase MCP apply_migration tool. Idempotent.

-- 1. profiles.id → auth.users(id)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_id_fkey foreign key (id)
      references auth.users(id) on delete cascade;
  end if;
end$$;

-- 2. Auto-create a profile row on signup (owner email → admin, else member)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when lower(new.email) = 'stephen@studio-flow.co' then 'admin' else 'member' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. RLS: enabled + deny-by-default (no policies for anon/authenticated).
--    The Drizzle pooler connects as the `postgres` table-owner role, which
--    bypasses RLS — so all real access flows through app-layer requireAuth().
--    This only closes the PostgREST (supabase-js anon/authed) data path.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','brands','intelligence_sections','products','personas','usps',
    'competitors','api_keys','usage_events','scrape_jobs','competitor_ads'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end$$;

-- 4. Private storage bucket for all media (signed URLs only).
insert into storage.buckets (id, name, public)
values ('iterio-portal-assets', 'iterio-portal-assets', false)
on conflict (id) do nothing;
