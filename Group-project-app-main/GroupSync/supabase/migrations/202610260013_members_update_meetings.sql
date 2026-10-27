-- Any project member can move a shared meeting, including from the assistant.
-- Deletes stay with the creator or an admin. Existing rows are kept.

drop policy if exists "creators or admins update events" on public.events;
create policy "members update events" on public.events
for update to authenticated
using (public.is_group_member(group_id))
with check (public.is_group_member(group_id));

drop policy if exists "creators or admins update meetings" on public.meetings;
create policy "members update meetings" on public.meetings
for update to authenticated
using (public.is_group_member(group_id))
with check (public.is_group_member(group_id));
