-- Recurring tasks. Each occurrence is a tasks row that shares series_id.
-- Completing the open occurrence creates the next one. Past occurrences stay completed.
-- Run this once in the Supabase SQL editor. Existing task policies are unchanged.

alter table public.tasks
  add column if not exists series_id uuid,
  add column if not exists recurrence jsonb,
  add column if not exists occurrence_index integer not null default 0,
  add column if not exists skipped boolean not null default false;

alter table public.tasks drop constraint if exists tasks_series_occurrence_key;
alter table public.tasks
  add constraint tasks_series_occurrence_key unique (series_id, occurrence_index);

create unique index if not exists tasks_one_open_occurrence_idx
  on public.tasks (series_id)
  where series_id is not null and status <> 'completed' and skipped = false;

create index if not exists tasks_series_idx on public.tasks (series_id);

create or replace function public.can_use_task(target public.tasks)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select auth.uid()) is not null
    and (
      (target.group_id is null and target.created_by = (select auth.uid()))
      or (target.group_id is not null and public.is_group_member(target.group_id))
    );
$$;

create or replace function public.advance_recurring_task(
  p_task_id uuid,
  p_next_due timestamptz,
  p_skipped boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_task public.tasks%rowtype;
  next_id uuid;
  next_index integer;
begin
  if auth.uid() is null then raise exception 'Sign in to update a task'; end if;
  select * into current_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.can_use_task(current_task) then raise exception 'You cannot update this task'; end if;

  next_index := coalesce(current_task.occurrence_index, 0) + 1;

  if current_task.status <> 'completed' then
    update public.tasks
    set status = 'completed', skipped = coalesce(p_skipped, false), updated_at = now()
    where id = p_task_id;
  elsif p_skipped and current_task.skipped = false then
    update public.tasks set skipped = true, updated_at = now() where id = p_task_id;
  end if;

  if current_task.series_id is null or current_task.recurrence is null then
    return null;
  end if;

  select t.id into next_id
  from public.tasks t
  where t.series_id = current_task.series_id and t.occurrence_index = next_index;
  if next_id is not null then
    return next_id;
  end if;

  if p_next_due is null then
    return null;
  end if;

  begin
    insert into public.tasks (
      group_id, created_by, title, description, due_at, priority, status,
      estimated_minutes, milestone_id, series_id, recurrence, occurrence_index, skipped
    )
    values (
      current_task.group_id,
      current_task.created_by,
      current_task.title,
      current_task.description,
      p_next_due,
      current_task.priority,
      'todo',
      current_task.estimated_minutes,
      current_task.milestone_id,
      current_task.series_id,
      current_task.recurrence,
      next_index,
      false
    )
    returning id into next_id;
  exception
    when unique_violation then
      select t.id into next_id
      from public.tasks t
      where t.series_id = current_task.series_id and t.occurrence_index = next_index;
      return next_id;
  end;

  insert into public.task_assignments (task_id, user_id, assigned_by)
  select next_id, user_id, assigned_by
  from public.task_assignments
  where task_id = p_task_id
  on conflict do nothing;

  insert into public.requirements (task_id, title, description)
  select next_id, title, description
  from public.requirements
  where task_id = p_task_id;

  return next_id;
end;
$$;

create or replace function public.stop_recurring_task(p_task_id uuid, p_scope text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_task public.tasks%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to update a task'; end if;
  if p_scope not in ('this', 'future', 'series') then raise exception 'Choose this, future, or series'; end if;
  select * into current_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.can_use_task(current_task) then raise exception 'You cannot update this task'; end if;

  if current_task.series_id is null then
    if current_task.created_by = auth.uid() or (current_task.group_id is not null and public.can_manage_group(current_task.group_id)) then
      delete from public.tasks where id = p_task_id;
    else
      raise exception 'You cannot delete this task';
    end if;
    return;
  end if;

  if p_scope = 'this' then
    if current_task.status <> 'completed' then
      update public.tasks
      set status = 'completed', skipped = true, updated_at = now()
      where id = p_task_id;
    else
      if current_task.created_by = auth.uid() or (current_task.group_id is not null and public.can_manage_group(current_task.group_id)) then
        delete from public.tasks where id = p_task_id;
      else
        raise exception 'You cannot delete this task';
      end if;
    end if;
    return;
  end if;

  if p_scope = 'future' then
    delete from public.tasks
    where series_id = current_task.series_id
      and status <> 'completed'
      and occurrence_index >= current_task.occurrence_index;
    if current_task.status = 'completed' then
      update public.tasks
      set recurrence = null, updated_at = now()
      where id = p_task_id;
    end if;
    return;
  end if;

  delete from public.tasks
  where series_id = current_task.series_id
    and status <> 'completed';
end;
$$;

revoke all on function public.advance_recurring_task(uuid, timestamptz, boolean) from public;
revoke all on function public.stop_recurring_task(uuid, text) from public;
grant execute on function public.advance_recurring_task(uuid, timestamptz, boolean) to authenticated;
grant execute on function public.stop_recurring_task(uuid, text) to authenticated;
grant execute on function public.can_use_task(public.tasks) to authenticated;
