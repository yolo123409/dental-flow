-- A dentist may have only one active appointment at a time. Every
-- appointment reserves at least one hour; longer durations remain longer.
-- This is enforced in Postgres so parallel requests cannot double-book a
-- dentist even if they pass client-side availability checks simultaneously.

create extension if not exists btree_gist;

alter table public.appointments
  drop constraint if exists appointments_dentist_active_time_no_overlap;

alter table public.appointments
  add constraint appointments_dentist_active_time_no_overlap
  exclude using gist (
    dentist_id with =,
    tsrange(
      appointment_date + appointment_time,
      appointment_date + appointment_time
        + make_interval(mins => greatest(coalesce(duration, 60), 60)),
      '[)'
    ) with &&
  )
  where (dentist_id is not null and status <> 'Cancelled');
