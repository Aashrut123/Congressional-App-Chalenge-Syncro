-- Tell the other people on a project when a meeting time changes.
-- New meetings already notify on insert. Moving the date is an update, so it did not.
-- Safe to run after 202610190003_meeting_notice_links.sql. Existing rows are kept.

create or replace function public.notify_meeting_reschedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  when_label text;
  actor uuid;
begin
  if new.starts_at is not distinct from old.starts_at
     and new.ends_at is not distinct from old.ends_at then
    return new;
  end if;

  actor := auth.uid();
  when_label := to_char(new.starts_at at time zone 'UTC', 'FMMonth FMDD, FMHH12:MI AM');

  insert into public.notifications(user_id, group_id, kind, title, body, href)
  select
    gm.user_id,
    new.group_id,
    'meeting',
    'Meeting moved',
    left(new.title || ' moved to ' || when_label, 500),
    case
      when new.event_id is null then '/group/' || new.group_id::text
      else '/event/' || new.event_id::text
    end
  from public.group_memberships gm
  where gm.group_id = new.group_id
    and gm.user_id is distinct from actor
    and (actor is not null or gm.user_id is distinct from new.created_by);

  return new;
end;
$$;

drop trigger if exists meeting_reschedule_notification on public.meetings;
create trigger meeting_reschedule_notification
after update of starts_at, ends_at on public.meetings
for each row execute function public.notify_meeting_reschedule();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
