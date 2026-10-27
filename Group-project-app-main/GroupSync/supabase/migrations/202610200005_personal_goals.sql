-- Personal goals and onboarding. Safe to run after the earlier Syncro migrations.
-- Existing profiles stay unfinished until the person completes onboarding once.

alter table public.profiles
  add column if not exists goals text[] not null default '{}',
  add column if not exists custom_goal text not null default '',
  add column if not exists planning_style text not null default 'steady',
  add column if not exists onboarding_completed boolean not null default false;

alter table public.profiles drop constraint if exists profiles_custom_goal_len;
alter table public.profiles add constraint profiles_custom_goal_len check (char_length(custom_goal) <= 200);

alter table public.profiles drop constraint if exists profiles_planning_style_check;
alter table public.profiles add constraint profiles_planning_style_check
  check (planning_style in ('steady', 'sprint', 'flexible'));

alter table public.profiles drop constraint if exists profiles_goals_count;
alter table public.profiles add constraint profiles_goals_count check (cardinality(goals) <= 8);
