-- Feedback channel for the OT tracker.
--
-- Self-contained: safe to run on its own, and safe to re-run. It only needs
-- public.otworker_profiles to already exist (from otworker_profiles.sql),
-- because feedback rows link to a profile.

create table if not exists public.otworker_feedback (
  id text primary key,
  auth_user_id uuid,
  profile_id bigint references public.otworker_profiles(id) on delete set null,
  username text not null default '',
  category text not null default 'other',
  message text not null,
  context jsonb,
  status text not null default 'NEW',
  admin_note text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'otworker_feedback_category_check'
      and conrelid = 'public.otworker_feedback'::regclass
  ) then
    alter table public.otworker_feedback
    add constraint otworker_feedback_category_check
    check (category in ('bug', 'idea', 'other'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'otworker_feedback_status_check'
      and conrelid = 'public.otworker_feedback'::regclass
  ) then
    alter table public.otworker_feedback
    add constraint otworker_feedback_status_check
    check (status in ('NEW', 'TRIAGED', 'RESOLVED', 'WONT_FIX'));
  end if;
end;
$$;

create index if not exists otworker_feedback_created_at_idx
on public.otworker_feedback (created_at desc);

create index if not exists otworker_feedback_auth_user_id_created_at_idx
on public.otworker_feedback (auth_user_id, created_at desc);

create index if not exists otworker_feedback_status_created_at_idx
on public.otworker_feedback (status, created_at desc);

-- Defined here as well as in otworker_profiles.sql so this file can be applied
-- on its own. "create or replace" keeps the existing profiles/entries triggers
-- working, since the body is identical.
create or replace function public.set_otworker_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists otworker_feedback_set_updated_at on public.otworker_feedback;

create trigger otworker_feedback_set_updated_at
before update on public.otworker_feedback
for each row
execute function public.set_otworker_updated_at();

-- Feedback is addressed to one person, so the inbox is gated on that account
-- rather than on the ADMIN role. Change the username here to hand it over, and
-- keep it in sync with FEEDBACK_OWNER_USERNAME in the backend and frontend.
create or replace function public.is_otworker_feedback_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.otworker_profiles
    where auth_user_id = auth.uid()
      and username = 'trong-dong'
  );
$$;

alter table public.otworker_feedback enable row level security;

grant select, insert, update, delete on public.otworker_feedback to authenticated;
grant execute on function public.is_otworker_feedback_owner() to authenticated;

-- A user sees only their own submissions; the owner sees every row.
drop policy if exists "Users can read own OTWORKER feedback" on public.otworker_feedback;
create policy "Users can read own OTWORKER feedback"
on public.otworker_feedback
for select
to authenticated
using (auth.uid() = auth_user_id or public.is_otworker_feedback_owner());

drop policy if exists "Users can insert own OTWORKER feedback" on public.otworker_feedback;
create policy "Users can insert own OTWORKER feedback"
on public.otworker_feedback
for insert
to authenticated
with check (auth.uid() = auth_user_id);

-- Triage and deletion belong to the owner alone, so a submitter cannot edit
-- their own row after sending it.
drop policy if exists "Admins can update OTWORKER feedback" on public.otworker_feedback;
drop policy if exists "Feedback owner can update OTWORKER feedback" on public.otworker_feedback;
create policy "Feedback owner can update OTWORKER feedback"
on public.otworker_feedback
for update
to authenticated
using (public.is_otworker_feedback_owner())
with check (public.is_otworker_feedback_owner());

drop policy if exists "Admins can delete OTWORKER feedback" on public.otworker_feedback;
drop policy if exists "Feedback owner can delete OTWORKER feedback" on public.otworker_feedback;
create policy "Feedback owner can delete OTWORKER feedback"
on public.otworker_feedback
for delete
to authenticated
using (public.is_otworker_feedback_owner());
