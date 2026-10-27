-- Default profile timezone is Central. UTC was only the original column default.
-- Safe to run after the earlier Syncro migrations. It does not delete rows.

alter table public.profiles alter column timezone set default 'America/Chicago';

update public.profiles
set timezone = 'America/Chicago'
where timezone is null or btrim(timezone) = '' or timezone = 'UTC';
