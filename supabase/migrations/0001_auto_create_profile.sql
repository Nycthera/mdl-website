-- Auto-create a `public.profiles` row for every new `auth.users` row.
--
-- This is the single place that needs to know "a new user signed up" —
-- it fires no matter HOW the user was created:
--   - NextAuth Credentials provider -> supabase.auth.signUp() (createUser.ts)
--   - NextAuth GitHub provider      -> supabase.auth.admin.createUser() (lib/auth.ts)
--   - Any other future auth path
--
-- Without this, GitHub sign-ins (which go through the admin API directly,
-- bypassing any app-level "insert profile row" code) would create an
-- auth.users row with no matching public.profiles row, silently breaking
-- anything that joins against profiles (favorites, download_history,
-- user_settings all FK to profiles.id).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();

-- Backfill: create profiles for any existing auth.users that predate this
-- migration (safe to run repeatedly — ON CONFLICT DO NOTHING).
insert into public.profiles (id)
select u.id
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;
