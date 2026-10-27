-- A task can stay personal. Run this once in the Supabase SQL editor.

alter table public.tasks alter column group_id drop not null;

create or replace function public.log_group_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare gid uuid; ent uuid; act text; summary_text text; typ text;
begin
  if tg_op = 'DELETE' then gid := old.group_id; ent := old.id;
  else gid := new.group_id; ent := new.id; end if;
  if gid is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  typ := case when tg_table_name = 'events' then 'event' when tg_table_name = 'tasks' then 'task' else 'meeting' end;
  act := lower(tg_op);
  if tg_op = 'DELETE' then summary_text := initcap(typ) || ' removed'; else summary_text := initcap(typ) || ': ' || coalesce(new.title, 'updated'); end if;
  insert into public.activity(group_id, actor_id, entity_type, entity_id, action, summary)
    values (gid, auth.uid(), typ, ent, act, summary_text);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop policy if exists "members read tasks" on public.tasks;
create policy "members read tasks" on public.tasks for select to authenticated
using (
  (group_id is null and created_by = (select auth.uid()))
  or (group_id is not null and public.is_group_member(group_id))
);

drop policy if exists "members create tasks" on public.tasks;
create policy "members create tasks" on public.tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (group_id is null or public.is_group_member(group_id))
);

drop policy if exists "members update tasks" on public.tasks;
create policy "members update tasks" on public.tasks for update to authenticated
using (
  (group_id is null and created_by = (select auth.uid()))
  or (group_id is not null and public.is_group_member(group_id))
)
with check (
  (group_id is null and created_by = (select auth.uid()))
  or (group_id is not null and public.is_group_member(group_id))
);

drop policy if exists "creators or admins delete tasks" on public.tasks;
create policy "creators or admins delete tasks" on public.tasks for delete to authenticated
using (
  created_by = (select auth.uid())
  or (group_id is not null and public.can_manage_group(group_id))
);

drop policy if exists "creator manages personal requirements" on public.requirements;
create policy "creator manages personal requirements" on public.requirements for all to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = requirements.task_id and t.group_id is null and t.created_by = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.tasks t
    where t.id = requirements.task_id and t.group_id is null and t.created_by = (select auth.uid())
  )
);

drop policy if exists "creator reads personal comments" on public.task_comments;
create policy "creator reads personal comments" on public.task_comments for select to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = task_comments.task_id and t.group_id is null and t.created_by = (select auth.uid())
  )
);

drop policy if exists "creator writes personal comments" on public.task_comments;
create policy "creator writes personal comments" on public.task_comments for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.tasks t
    where t.id = task_comments.task_id and t.group_id is null and t.created_by = (select auth.uid())
  )
);

drop policy if exists "creator manages personal assignments" on public.task_assignments;
create policy "creator manages personal assignments" on public.task_assignments for all to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = task_assignments.task_id and t.group_id is null and t.created_by = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.tasks t
    where t.id = task_assignments.task_id and t.group_id is null and t.created_by = (select auth.uid())
  )
);
