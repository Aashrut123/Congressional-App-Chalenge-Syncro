-- Saving a project updates public.groups. The shared protect trigger was reading
-- new.group_id on that table, which has no group_id column. Run this once in the SQL Editor.

create or replace function public.prevent_group_owner_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by then raise exception 'The record creator cannot be changed'; end if;
  if tg_table_name <> 'groups' then
    if new.group_id is distinct from old.group_id then raise exception 'Shared records cannot be moved between groups'; end if;
  end if;
  return new;
end;
$$;
