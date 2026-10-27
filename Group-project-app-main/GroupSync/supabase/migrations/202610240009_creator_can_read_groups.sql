-- A creator can read a project they just made. Inserting and returning the new
-- row also checks the select rule, which previously only allowed members.
-- Safe to run once after the earlier Syncro migrations.

drop policy if exists "creators read their groups" on public.groups;
create policy "creators read their groups" on public.groups
  for select to authenticated
  using (created_by = (select auth.uid()));
