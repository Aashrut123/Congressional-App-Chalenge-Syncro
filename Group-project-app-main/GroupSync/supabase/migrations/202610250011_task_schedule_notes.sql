-- Remember the first deadline and why an overdue task was moved.
-- Apply after the earlier Syncro migrations. Existing rows are kept.
-- This does not change who can read or edit a task.

alter table public.tasks
  add column if not exists original_due_at timestamptz,
  add column if not exists schedule_note text not null default '';

alter table public.tasks drop constraint if exists tasks_schedule_note_len;
alter table public.tasks add constraint tasks_schedule_note_len
  check (char_length(schedule_note) <= 500);
