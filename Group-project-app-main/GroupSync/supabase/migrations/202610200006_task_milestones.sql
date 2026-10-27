-- Link tasks to milestones in the same project. Safe to run after the earlier Syncro migrations.
-- Deleting a milestone keeps its tasks. They simply become unlinked.

alter table public.tasks
  add column if not exists milestone_id uuid references public.milestones(id) on delete set null;

alter table public.milestones
  add column if not exists sort_order integer not null default 0;

create index if not exists tasks_milestone_idx on public.tasks(milestone_id);

create or replace function public.task_milestone_same_group()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  milestone_group uuid;
begin
  if new.milestone_id is null then
    return new;
  end if;
  select group_id into milestone_group from public.milestones where id = new.milestone_id;
  if milestone_group is distinct from new.group_id then
    raise exception 'That milestone belongs to a different project';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_milestone_same_group on public.tasks;
create trigger tasks_milestone_same_group
before insert or update of milestone_id, group_id on public.tasks
for each row execute function public.task_milestone_same_group();
