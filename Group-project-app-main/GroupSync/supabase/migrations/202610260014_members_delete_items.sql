-- Project members can delete shared tasks and meetings, not only the creator.
-- Deleting a whole project stays limited to the owner. Existing rows are kept.

drop policy if exists "creators or admins delete events" on public.events;
create policy "members delete events" on public.events
for delete to authenticated
using (public.is_group_member(group_id));

drop policy if exists "creators or admins delete meetings" on public.meetings;
create policy "members delete meetings" on public.meetings
for delete to authenticated
using (public.is_group_member(group_id));

drop policy if exists "creators or admins delete tasks" on public.tasks;
create policy "members delete tasks" on public.tasks
for delete to authenticated
using (
  (group_id is null and created_by = (select auth.uid()))
  or (group_id is not null and public.is_group_member(group_id))
);
