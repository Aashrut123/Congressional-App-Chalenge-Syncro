-- Point meeting notices at the calendar item, and notify someone when they are invited.
-- Safe to run after 202610190002_project_platform.sql. It does not change existing rows.

create or replace function public.notify_meeting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(user_id, group_id, kind, title, body, href)
  select gm.user_id, new.group_id, 'meeting', 'Meeting scheduled', new.title,
    case
      when new.event_id is null then '/group/' || new.group_id::text
      else '/event/' || new.event_id::text
    end
  from public.group_memberships gm
  where gm.group_id = new.group_id and gm.user_id is distinct from new.created_by;
  return new;
end;
$$;

create or replace function public.notify_meeting_invite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare meeting_title text; gid uuid; linked_event uuid;
begin
  if new.user_id is not distinct from auth.uid() then return new; end if;
  select m.title, m.group_id, m.event_id into meeting_title, gid, linked_event
  from public.meetings m where m.id = new.meeting_id;
  insert into public.notifications(user_id, group_id, kind, title, body, href)
  values (
    new.user_id,
    gid,
    'meeting',
    'Meeting invitation',
    coalesce(meeting_title, 'You were added to a meeting'),
    case when linked_event is null then '/group/' || gid::text else '/event/' || linked_event::text end
  );
  return new;
end;
$$;

drop trigger if exists meeting_attendee_notification on public.meeting_attendees;
create trigger meeting_attendee_notification after insert on public.meeting_attendees
for each row execute function public.notify_meeting_invite();
