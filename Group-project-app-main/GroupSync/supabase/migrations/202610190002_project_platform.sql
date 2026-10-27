-- Additive Syncro platform migration.
-- Apply after 202610100001_initial_schema.sql in the Supabase SQL editor.
-- New enum values are not inserted in this file so the migration can run in one transaction.

alter type public.task_status add value if not exists 'blocked';

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists skills text not null default '',
  add column if not exists interests text not null default '',
  add column if not exists timezone text not null default 'UTC';

alter table public.profiles drop constraint if exists profiles_avatar_url_len;
alter table public.profiles add constraint profiles_avatar_url_len check (avatar_url is null or char_length(avatar_url) <= 500);
alter table public.profiles drop constraint if exists profiles_skills_len;
alter table public.profiles add constraint profiles_skills_len check (char_length(skills) <= 400);
alter table public.profiles drop constraint if exists profiles_interests_len;
alter table public.profiles add constraint profiles_interests_len check (char_length(interests) <= 400);

alter table public.groups
  add column if not exists outcome text not null default '',
  add column if not exists starts_on date,
  add column if not exists deadline date,
  add column if not exists status text not null default 'active',
  add column if not exists priority text not null default 'medium',
  add column if not exists archived_at timestamptz;

alter table public.groups drop constraint if exists groups_outcome_len;
alter table public.groups add constraint groups_outcome_len check (char_length(outcome) <= 2000);
alter table public.groups drop constraint if exists groups_status_check;
alter table public.groups add constraint groups_status_check check (status in ('active', 'paused', 'completed', 'archived'));
alter table public.groups drop constraint if exists groups_priority_check;
alter table public.groups add constraint groups_priority_check check (priority in ('low', 'medium', 'high'));
alter table public.groups drop constraint if exists groups_date_order;
alter table public.groups add constraint groups_date_order check (deadline is null or starts_on is null or deadline >= starts_on);

alter table public.tasks
  add column if not exists starts_at timestamptz,
  add column if not exists estimated_minutes integer,
  add column if not exists actual_minutes integer,
  add column if not exists origin text not null default 'manual',
  add column if not exists blocked_reason text not null default '';

alter table public.tasks drop constraint if exists tasks_estimated_minutes_check;
alter table public.tasks add constraint tasks_estimated_minutes_check check (estimated_minutes is null or estimated_minutes > 0);
alter table public.tasks drop constraint if exists tasks_actual_minutes_check;
alter table public.tasks add constraint tasks_actual_minutes_check check (actual_minutes is null or actual_minutes >= 0);
alter table public.tasks drop constraint if exists tasks_origin_check;
alter table public.tasks add constraint tasks_origin_check check (origin in ('manual', 'ai', 'fallback'));
alter table public.tasks drop constraint if exists tasks_blocked_reason_len;
alter table public.tasks add constraint tasks_blocked_reason_len check (char_length(blocked_reason) <= 500);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 140),
  description text not null default '' check (char_length(description) <= 2000),
  due_on date,
  completed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on uuid not null references public.tasks(id) on delete cascade,
  primary key (task_id, depends_on),
  constraint task_dependencies_no_self check (task_id <> depends_on)
);

create table if not exists public.progress_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  log_date date not null default ((now() at time zone 'utc')::date),
  accomplishments text not null check (char_length(trim(accomplishments)) between 1 and 2000),
  next_steps text not null default '' check (char_length(next_steps) <= 2000),
  blockers text not null default '' check (char_length(blockers) <= 2000),
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  constraint availability_windows_order check (end_minute > start_minute),
  unique (user_id, weekday, start_minute)
);

create table if not exists public.unavailable_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  constraint unavailable_periods_order check (ends_on >= starts_on)
);

create table if not exists public.planning_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  source text not null check (source in ('ai', 'fallback')),
  feasible boolean not null,
  summary text not null default '',
  assumptions text not null default '',
  risks text not null default '',
  input jsonb not null default '{}'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  saved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.tasks add column if not exists plan_id uuid references public.planning_sessions(id) on delete set null;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  kind text not null check (kind in ('task_assigned', 'progress_log', 'meeting', 'milestone', 'conflict')),
  title text not null check (char_length(title) between 1 and 140),
  body text not null default '' check (char_length(body) <= 500),
  href text not null default '' check (char_length(href) <= 200),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists milestones_group_idx on public.milestones(group_id, due_on);
create index if not exists task_dependencies_depends_idx on public.task_dependencies(depends_on);
create index if not exists progress_logs_group_idx on public.progress_logs(group_id, log_date desc);
create index if not exists availability_windows_user_idx on public.availability_windows(user_id);
create index if not exists unavailable_periods_user_idx on public.unavailable_periods(user_id, starts_on);
create index if not exists planning_sessions_group_idx on public.planning_sessions(group_id, created_at desc);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

drop trigger if exists milestones_updated_at on public.milestones;
create trigger milestones_updated_at before update on public.milestones
for each row execute function public.set_updated_at();

create or replace function public.notify_task_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare task_title text; gid uuid;
begin
  if new.user_id is not distinct from auth.uid() then return new; end if;
  select title, group_id into task_title, gid from public.tasks where id = new.task_id;
  insert into public.notifications(user_id, group_id, kind, title, body, href)
  values (
    new.user_id,
    gid,
    'task_assigned',
    'New task assigned',
    coalesce(task_title, 'A task was assigned to you'),
    '/task/' || new.task_id::text
  );
  return new;
end;
$$;

drop trigger if exists task_assignment_notification on public.task_assignments;
create trigger task_assignment_notification after insert on public.task_assignments
for each row execute function public.notify_task_assignment();

create or replace function public.notify_progress_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare author_name text;
begin
  select display_name into author_name from public.profiles where id = new.user_id;
  insert into public.notifications(user_id, group_id, kind, title, body, href)
  select gm.user_id, new.group_id, 'progress_log', 'New progress log',
    coalesce(nullif(author_name, ''), 'A teammate') || ' posted an update',
    '/group/' || new.group_id::text
  from public.group_memberships gm
  where gm.group_id = new.group_id and gm.user_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists progress_log_notification on public.progress_logs;
create trigger progress_log_notification after insert on public.progress_logs
for each row execute function public.notify_progress_log();

create or replace function public.notify_meeting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, group_id, kind, title, body, href)
  select gm.user_id, new.group_id, 'meeting', 'Meeting scheduled', new.title, '/group/' || new.group_id::text
  from public.group_memberships gm
  where gm.group_id = new.group_id and gm.user_id is distinct from new.created_by;
  return new;
end;
$$;

drop trigger if exists meeting_notification on public.meetings;
create trigger meeting_notification after insert on public.meetings
for each row execute function public.notify_meeting();

alter table public.milestones enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.progress_logs enable row level security;
alter table public.availability_windows enable row level security;
alter table public.unavailable_periods enable row level security;
alter table public.planning_sessions enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "members read milestones" on public.milestones;
create policy "members read milestones" on public.milestones for select to authenticated
using (public.is_group_member(group_id));
drop policy if exists "members create milestones" on public.milestones;
create policy "members create milestones" on public.milestones for insert to authenticated
with check (public.is_group_member(group_id) and created_by = (select auth.uid()));
drop policy if exists "members update milestones" on public.milestones;
create policy "members update milestones" on public.milestones for update to authenticated
using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
drop policy if exists "admins delete milestones" on public.milestones;
create policy "admins delete milestones" on public.milestones for delete to authenticated
using (public.can_manage_group(group_id));

drop policy if exists "members read dependencies" on public.task_dependencies;
create policy "members read dependencies" on public.task_dependencies for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id)));
drop policy if exists "members write dependencies" on public.task_dependencies;
create policy "members write dependencies" on public.task_dependencies for insert to authenticated
with check (exists (
  select 1 from public.tasks child
  join public.tasks parent on parent.group_id = child.group_id
  where child.id = task_id and parent.id = depends_on and public.is_group_member(child.group_id)
));
drop policy if exists "members delete dependencies" on public.task_dependencies;
create policy "members delete dependencies" on public.task_dependencies for delete to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id)));

drop policy if exists "members read progress logs" on public.progress_logs;
create policy "members read progress logs" on public.progress_logs for select to authenticated
using (public.is_group_member(group_id));
drop policy if exists "authors create progress logs" on public.progress_logs;
create policy "authors create progress logs" on public.progress_logs for insert to authenticated
with check (user_id = (select auth.uid()) and public.is_group_member(group_id));
drop policy if exists "authors update progress logs" on public.progress_logs;
create policy "authors update progress logs" on public.progress_logs for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.is_group_member(group_id));
drop policy if exists "authors or admins delete progress logs" on public.progress_logs;
create policy "authors or admins delete progress logs" on public.progress_logs for delete to authenticated
using (user_id = (select auth.uid()) or public.can_manage_group(group_id));

drop policy if exists "owner reads availability" on public.availability_windows;
create policy "owner reads availability" on public.availability_windows for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.group_memberships mine
    join public.group_memberships theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = availability_windows.user_id
  )
);
drop policy if exists "owner writes availability" on public.availability_windows;
create policy "owner writes availability" on public.availability_windows for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "owner updates availability" on public.availability_windows;
create policy "owner updates availability" on public.availability_windows for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "owner deletes availability" on public.availability_windows;
create policy "owner deletes availability" on public.availability_windows for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "owner reads unavailable" on public.unavailable_periods;
create policy "owner reads unavailable" on public.unavailable_periods for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.group_memberships mine
    join public.group_memberships theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = unavailable_periods.user_id
  )
);
drop policy if exists "owner writes unavailable" on public.unavailable_periods;
create policy "owner writes unavailable" on public.unavailable_periods for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "owner deletes unavailable" on public.unavailable_periods;
create policy "owner deletes unavailable" on public.unavailable_periods for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "members read plans" on public.planning_sessions;
create policy "members read plans" on public.planning_sessions for select to authenticated
using (public.is_group_member(group_id));
drop policy if exists "members create plans" on public.planning_sessions;
create policy "members create plans" on public.planning_sessions for insert to authenticated
with check (public.is_group_member(group_id) and created_by = (select auth.uid()));
drop policy if exists "authors update plans" on public.planning_sessions;
create policy "authors update plans" on public.planning_sessions for update to authenticated
using (created_by = (select auth.uid())) with check (public.is_group_member(group_id));

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications" on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications" on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.milestones, public.task_dependencies, public.progress_logs to authenticated;
grant select, insert, update, delete on public.availability_windows, public.unavailable_periods to authenticated;
grant select, insert, update on public.planning_sessions to authenticated;
grant select, update on public.notifications to authenticated;

-- Public avatar bucket used by the profile screen. Ignored if storage is unavailable.
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;
exception when undefined_table or insufficient_privilege then
  null;
end $$;
