-- Syncro initial schema. Safe to apply once to a new Supabase project.
create extension if not exists pgcrypto with schema extensions;

create type public.group_role as enum ('owner', 'admin', 'member');
create type public.event_kind as enum ('event', 'meeting', 'deadline');
create type public.task_status as enum ('todo', 'in_progress', 'completed');
create type public.task_priority as enum ('low', 'medium', 'high');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 70),
  description text not null default '' check (char_length(description) <= 400),
  color text not null default '#2B7168' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_memberships (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  code_hash bytea not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default '' check (char_length(location) <= 500),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  kind public.event_kind not null default 'event',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_time_order check (ends_at > starts_at)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 8000),
  due_at timestamptz,
  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'todo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_assignments (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 2000),
  due_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '',
  agenda text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default '',
  notes text not null default '',
  action_items text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_time_order check (ends_at > starts_at)
);

create table public.meeting_attendees (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  response text not null default 'invited' check (response in ('invited', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

create table public.activity (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null check (entity_type in ('event', 'task', 'membership', 'meeting')),
  entity_id uuid,
  action text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

create index group_memberships_user_idx on public.group_memberships(user_id, group_id);
create index invitations_group_idx on public.group_invitations(group_id, expires_at);
create index events_group_starts_idx on public.events(group_id, starts_at);
create index events_starts_idx on public.events(starts_at);
create index tasks_group_status_idx on public.tasks(group_id, status, due_at);
create index task_assignments_user_idx on public.task_assignments(user_id, task_id);
create index requirements_task_idx on public.requirements(task_id, completed);
create index task_comments_task_idx on public.task_comments(task_id, created_at);
create index meetings_group_starts_idx on public.meetings(group_id, starts_at);
create index meeting_attendees_user_idx on public.meeting_attendees(user_id, meeting_id);
create index activity_group_created_idx on public.activity(group_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace function public.prevent_group_owner_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by then raise exception 'The record creator cannot be changed'; end if;
  -- Projects are stored in groups, which has id rather than group_id. The field check has to stay
  -- in its own branch so saving a project does not read a column that is not there.
  if tg_table_name <> 'groups' then
    if new.group_id is distinct from old.group_id then raise exception 'Shared records cannot be moved between groups'; end if;
  end if;
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger groups_updated_at before update on public.groups for each row execute function public.set_updated_at();
create trigger events_updated_at before update on public.events for each row execute function public.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger requirements_updated_at before update on public.requirements for each row execute function public.set_updated_at();
create trigger task_comments_updated_at before update on public.task_comments for each row execute function public.set_updated_at();
create trigger meetings_updated_at before update on public.meetings for each row execute function public.set_updated_at();
create trigger groups_protect_owner before update on public.groups for each row execute function public.prevent_group_owner_change();
create trigger events_protect_owner before update on public.events for each row execute function public.prevent_group_owner_change();
create trigger tasks_protect_owner before update on public.tasks for each row execute function public.prevent_group_owner_change();
create trigger meetings_protect_owner before update on public.meetings for each row execute function public.prevent_group_owner_change();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_group_member(target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_memberships gm where gm.group_id = target_group and gm.user_id = (select auth.uid()));
$$;

create or replace function public.can_manage_group(target_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_memberships gm where gm.group_id = target_group and gm.user_id = (select auth.uid()) and gm.role in ('owner', 'admin'));
$$;

create or replace function public.add_group_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_memberships (group_id, user_id, role) values (new.id, new.created_by, 'owner');
  return new;
end;
$$;
create trigger group_creator_becomes_owner after insert on public.groups for each row execute function public.add_group_owner();

create or replace function public.create_group_invitation(target_group_id uuid, valid_days integer default 14)
returns text language plpgsql security definer set search_path = '' as $$
declare raw_code text;
begin
  if not public.can_manage_group(target_group_id) then raise exception 'Only group owners and admins can create invitations'; end if;
  if valid_days < 1 or valid_days > 30 then raise exception 'Invitation validity must be between 1 and 30 days'; end if;
  raw_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  insert into public.group_invitations(group_id, code_hash, created_by, expires_at)
  values (target_group_id, extensions.digest(lower(raw_code), 'sha256'), auth.uid(), now() + make_interval(days => valid_days));
  return raw_code;
end;
$$;

create or replace function public.join_group_with_code(invitation_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invitation public.group_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to join a group'; end if;
  select * into invitation from public.group_invitations gi
  where gi.code_hash = extensions.digest(lower(trim(invitation_code)), 'sha256')
    and gi.used_at is null and gi.expires_at > now()
  for update;
  if not found then raise exception 'Invitation code is invalid, expired, or already used'; end if;
  insert into public.group_memberships(group_id, user_id, role) values (invitation.group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;
  update public.group_invitations set used_at = now(), used_by = auth.uid() where id = invitation.id;
  return invitation.group_id;
end;
$$;

create or replace function public.manage_group_member(target_group_id uuid, target_user_id uuid, action text)
returns void language plpgsql security definer set search_path = '' as $$
declare caller_role public.group_role; target_role public.group_role;
begin
  select role into caller_role from public.group_memberships where group_id = target_group_id and user_id = auth.uid();
  select role into target_role from public.group_memberships where group_id = target_group_id and user_id = target_user_id;
  if target_role is null then raise exception 'Member not found'; end if;
  if action = 'remove' then
    if target_user_id = auth.uid() then
      if target_role = 'owner' then raise exception 'Transfer ownership before leaving this group'; end if;
    elsif caller_role not in ('owner', 'admin') or (target_role = 'owner') or (caller_role = 'admin' and target_role = 'admin') then
      raise exception 'You do not have permission to remove this member';
    end if;
    delete from public.group_memberships where group_id = target_group_id and user_id = target_user_id;
  elsif action = 'admin' then
    if caller_role <> 'owner' or target_role <> 'member' then raise exception 'Only the owner can promote a member'; end if;
    update public.group_memberships set role = 'admin' where group_id = target_group_id and user_id = target_user_id;
  else raise exception 'Unsupported membership action'; end if;
end;
$$;

create or replace function public.log_group_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare gid uuid; ent uuid; act text; summary_text text; typ text;
begin
  if tg_op = 'DELETE' then gid := old.group_id; ent := old.id;
  else gid := new.group_id; ent := new.id; end if;
  typ := case when tg_table_name = 'events' then 'event' when tg_table_name = 'tasks' then 'task' else 'meeting' end;
  act := lower(tg_op);
  if tg_op = 'DELETE' then summary_text := initcap(typ) || ' removed'; else summary_text := initcap(typ) || ': ' || coalesce(new.title, 'updated'); end if;
  insert into public.activity(group_id, actor_id, entity_type, entity_id, action, summary)
    values (gid, auth.uid(), typ, ent, act, summary_text);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger event_activity after insert or update or delete on public.events for each row execute function public.log_group_activity();
create trigger task_activity after insert or update or delete on public.tasks for each row execute function public.log_group_activity();
create trigger meeting_activity after insert or update or delete on public.meetings for each row execute function public.log_group_activity();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.group_invitations enable row level security;
alter table public.events enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;
alter table public.requirements enable row level security;
alter table public.task_comments enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_attendees enable row level security;
alter table public.activity enable row level security;

create policy "profiles visible to self and teammates" on public.profiles for select to authenticated
using (id = (select auth.uid()) or exists (
  select 1 from public.group_memberships mine join public.group_memberships theirs on theirs.group_id = mine.group_id
  where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
));
create policy "users update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members read groups" on public.groups for select to authenticated using (public.is_group_member(id));
create policy "authenticated users create groups" on public.groups for insert to authenticated with check (created_by = (select auth.uid()));
create policy "admins update groups" on public.groups for update to authenticated using (public.can_manage_group(id)) with check (public.can_manage_group(id));
create policy "owners delete groups" on public.groups for delete to authenticated using (exists (select 1 from public.group_memberships gm where gm.group_id = id and gm.user_id = (select auth.uid()) and gm.role = 'owner'));

create policy "members read membership list" on public.group_memberships for select to authenticated using (public.is_group_member(group_id));
create policy "members leave their own group" on public.group_memberships for delete to authenticated using (user_id = (select auth.uid()) and role <> 'owner');
create policy "no direct invitation access" on public.group_invitations for select to authenticated using (false);

create policy "members read events" on public.events for select to authenticated using (public.is_group_member(group_id));
create policy "members create events" on public.events for insert to authenticated with check (public.is_group_member(group_id) and created_by = (select auth.uid()));
create policy "creators or admins update events" on public.events for update to authenticated using (created_by = (select auth.uid()) or public.can_manage_group(group_id)) with check (public.is_group_member(group_id));
create policy "creators or admins delete events" on public.events for delete to authenticated using (created_by = (select auth.uid()) or public.can_manage_group(group_id));

create policy "members read tasks" on public.tasks for select to authenticated using (public.is_group_member(group_id));
create policy "members create tasks" on public.tasks for insert to authenticated with check (public.is_group_member(group_id) and created_by = (select auth.uid()));
create policy "members update tasks" on public.tasks for update to authenticated using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy "creators or admins delete tasks" on public.tasks for delete to authenticated using (created_by = (select auth.uid()) or public.can_manage_group(group_id));

create policy "members read task assignments" on public.task_assignments for select to authenticated using (exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id)));
create policy "members manage task assignments" on public.task_assignments for all to authenticated using (exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id))) with check (exists (select 1 from public.tasks t join public.group_memberships gm on gm.group_id = t.group_id where t.id = task_id and gm.user_id = task_assignments.user_id));

create policy "members read requirements" on public.requirements for select to authenticated using (exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id)));
create policy "members create requirements" on public.requirements for insert to authenticated with check (exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id) and (assigned_to is null or exists (select 1 from public.group_memberships gm where gm.group_id = t.group_id and gm.user_id = assigned_to))));
create policy "members update requirements" on public.requirements for update to authenticated using (exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id))) with check (exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id) and (assigned_to is null or exists (select 1 from public.group_memberships gm where gm.group_id = t.group_id and gm.user_id = assigned_to))));
create policy "members delete requirements" on public.requirements for delete to authenticated using (exists (select 1 from public.tasks t where t.id = task_id and public.can_manage_group(t.group_id)));

create policy "members read comments" on public.task_comments for select to authenticated using (exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id)));
create policy "members write comments" on public.task_comments for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id and public.is_group_member(t.group_id)));
create policy "authors edit comments" on public.task_comments for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "authors or admins delete comments" on public.task_comments for delete to authenticated using (user_id = (select auth.uid()) or exists (select 1 from public.tasks t where t.id = task_id and public.can_manage_group(t.group_id)));

create policy "members read meetings" on public.meetings for select to authenticated using (public.is_group_member(group_id));
create policy "members create meetings" on public.meetings for insert to authenticated with check (public.is_group_member(group_id) and created_by = (select auth.uid()));
create policy "creators or admins update meetings" on public.meetings for update to authenticated using (created_by = (select auth.uid()) or public.can_manage_group(group_id)) with check (public.is_group_member(group_id));
create policy "creators or admins delete meetings" on public.meetings for delete to authenticated using (created_by = (select auth.uid()) or public.can_manage_group(group_id));
create policy "members read meeting attendees" on public.meeting_attendees for select to authenticated using (exists (select 1 from public.meetings m where m.id = meeting_id and public.is_group_member(m.group_id)));
create policy "members manage meeting attendees" on public.meeting_attendees for all to authenticated using (exists (select 1 from public.meetings m where m.id = meeting_id and public.is_group_member(m.group_id))) with check (exists (select 1 from public.meetings m join public.group_memberships gm on gm.group_id = m.group_id where m.id = meeting_id and gm.user_id = meeting_attendees.user_id));

create policy "members read activity" on public.activity for select to authenticated using (public.is_group_member(group_id));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.groups to authenticated;
grant select, delete on public.group_memberships to authenticated;
grant select, insert, update, delete on public.events, public.tasks, public.task_assignments, public.requirements, public.task_comments, public.meetings, public.meeting_attendees to authenticated;
grant select on public.activity to authenticated;
grant execute on function public.is_group_member(uuid), public.can_manage_group(uuid) to authenticated;
grant execute on function public.create_group_invitation(uuid, integer), public.join_group_with_code(text), public.manage_group_member(uuid, uuid, text) to authenticated;

-- Enable realtime replication for shared content. Existing publication/table pairs are left intact.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then alter publication supabase_realtime add table public.events; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks') then alter publication supabase_realtime add table public.tasks; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_memberships') then alter publication supabase_realtime add table public.group_memberships; end if;
end $$;
