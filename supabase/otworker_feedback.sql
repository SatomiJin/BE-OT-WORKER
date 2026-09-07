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

drop trigger if exists otworker_feedback_set_updated_at on public.otworker_feedback;

create trigger otworker_feedback_set_updated_at
before update on public.otworker_feedback
for each row
execute function public.set_otworker_updated_at();

alter table public.otworker_feedback enable row level security;

grant select, insert, update, delete on public.otworker_feedback to authenticated;

drop policy if exists "Users can read own OTWORKER feedback" on public.otworker_feedback;
create policy "Users can read own OTWORKER feedback"
on public.otworker_feedback
for select
to authenticated
using (auth.uid() = auth_user_id or public.is_otworker_admin());

drop policy if exists "Users can insert own OTWORKER feedback" on public.otworker_feedback;
create policy "Users can insert own OTWORKER feedback"
on public.otworker_feedback
for insert
to authenticated
with check (auth.uid() = auth_user_id);

-- Only admins triage feedback, so updates are intentionally admin-only.
drop policy if exists "Admins can update OTWORKER feedback" on public.otworker_feedback;
create policy "Admins can update OTWORKER feedback"
on public.otworker_feedback
for update
to authenticated
using (public.is_otworker_admin())
with check (public.is_otworker_admin());

drop policy if exists "Admins can delete OTWORKER feedback" on public.otworker_feedback;
create policy "Admins can delete OTWORKER feedback"
on public.otworker_feedback
for delete
to authenticated
using (public.is_otworker_admin());

-- Feedback is addressed to one person, so the inbox is gated on that account
-- rather than on the ADMIN role. Change the username here to hand it over.
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

grant execute on function public.is_otworker_feedback_owner() to authenticated;

drop policy if exists "Users can read own OTWORKER feedback" on public.otworker_feedback;
create policy "Users can read own OTWORKER feedback"
on public.otworker_feedback
for select
to authenticated
using (auth.uid() = auth_user_id or public.is_otworker_feedback_owner());

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
