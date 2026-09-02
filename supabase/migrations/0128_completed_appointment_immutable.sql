-- Critical Safety Closure (Audit II, Critical #1): a Completed
-- appointment could be silently reverted (and its date/time/dentist/
-- treatment rewritten) through the ordinary Edit form - services/
-- appointments.ts#updateAppointment() only rejected the write when the
-- INCOMING status value was 'Completed', never when the row's EXISTING
-- status already was. services/calendar.ts#moveAppointment/
-- resizeAppointment do a raw update with no status check at all -
-- unreachable through the calendar UI today (which excludes Completed
-- appointments from view), but open to any direct call. There was no
-- database-level backstop at all on appointments.status.
--
-- THE FIX: a BEFORE UPDATE trigger that blocks rewriting the facts of a
-- Completed appointment - status, date, time, dentist, treatment,
-- duration - regardless of caller (the app's service layer, a future
-- caller, or a direct RPC/PostgREST call). This is the real enforcement
-- layer; services/appointments.ts gets a matching application-level
-- guard as a friendlier second line of defense (same pattern as the C5
-- fix's own comment there).
--
-- Deliberately does NOT block every column: `notes` stays editable (adding
-- a post-visit note doesn't rewrite history), and critically
-- `treatment_plan_item_id` stays editable, because
-- appointments.treatment_plan_item_id references treatment_plan_items(id)
-- on delete set null (migration 0107) - deleting a linked treatment plan
-- item must still be able to null this column on a Completed appointment
-- via Postgres's own FK cascade, exactly as migration 0107's header
-- requires ("deleting a treatment_plan_item must never delete or orphan
-- an appointment record").
--
-- No "un-complete" path is provided here, deliberately - Completed is a
-- true terminal state for this generic edit surface, matching
-- deleteAppointment()'s own existing precedent that a Completed
-- appointment is a historical record. A safe, audited "Reopen Visit"
-- action (which would also need to decide what happens to any invoice
-- already raised) is a separate, deliberate future feature, not
-- implicitly provided by this fix.
--
-- Safe to re-run: create or replace function, drop trigger if exists +
-- create.

create or replace function public._trigger_guard_completed_appointment_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.status = 'Completed' and (
    NEW.status is distinct from OLD.status
    or NEW.appointment_date is distinct from OLD.appointment_date
    or NEW.appointment_time is distinct from OLD.appointment_time
    or NEW.dentist_id is distinct from OLD.dentist_id
    or NEW.treatment is distinct from OLD.treatment
    or NEW.duration is distinct from OLD.duration
  ) then
    raise exception 'Completed appointments are historical records and cannot be edited.';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_guard_completed_appointment_immutable on public.appointments;
create trigger trg_guard_completed_appointment_immutable
  before update on public.appointments
  for each row execute function public._trigger_guard_completed_appointment_immutable();
