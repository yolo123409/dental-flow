import { supabase } from "@/lib/supabase";
import { Appointment } from "@/types/appointment";

import { getCurrentClinicId } from "@/services/clinic";
import { localDateString } from "@/lib/dateUtils";

import {
  notifyAppointmentBooked,
  notifyAppointmentCancelled,
  notifyAppointmentCompleted,
  notifyAppointmentRescheduled,
} from "@/services/notifications";

import { completeAndBillTreatmentItem } from "@/services/treatmentPlans";

export async function getAppointments(
  page = 1,
  pageSize = 50
): Promise<Appointment[]> {
  const clinicId = await getCurrentClinicId();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error } = await supabase
    .from("appointments")
    .select(
      `
      *,
      patients (
        first_name,
        last_name
      ),
      dentists (
        full_name
      )
    `
    )
    .eq("clinic_id", clinicId)
    .order("appointment_date", {
      ascending: true,
    })
    .order("appointment_time", {
      ascending: true,
    })
    .range(from, to);

  if (error) {
    console.error(
      "Failed to fetch appointments:",
      error
    );
    return [];
  }

  return (data as Appointment[]) ?? [];
}

export async function getAppointmentById(
  id: string
): Promise<Appointment | null> {
  const clinicId =
    await getCurrentClinicId();

  const { data, error } =
    await supabase
      .from("appointments")
      .select(
        `
        *,
        patients (
          first_name,
          last_name
        ),
        dentists (
          full_name
        ),
        treatment_plan_items (
          id,
          procedure,
          status,
          charge_id
        )
      `
      )
      .eq("id", id)
      .eq("clinic_id", clinicId)
      .single();

  if (error) {
    console.error(
      "Failed to fetch appointment:",
      error
    );
    return null;
  }

  return data as Appointment;
}

/**
 * Upcoming, reminder-eligible appointments for a single patient - status
 * Scheduled/Ongoing only, today or later. Used to decide whether a
 * WhatsApp reminder button should be enabled and, when there's more than
 * one, to let the receptionist pick which appointment to remind about
 * instead of silently guessing.
 */
export async function getUpcomingAppointmentsForPatient(
  patientId: string
): Promise<Appointment[]> {
  const clinicId = await getCurrentClinicId();

  const today = localDateString(new Date());

  const { data, error } =
    await supabase
      .from("appointments")
      .select(
        `
        *,
        patients (
          first_name,
          last_name
        ),
        dentists (
          full_name
        )
      `
      )
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .in("status", ["Scheduled", "Ongoing"])
      .gte("appointment_date", today)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });

  if (error) {
    console.error(
      "Failed to fetch upcoming appointments for patient:",
      error
    );
    return [];
  }

  return (data as Appointment[]) ?? [];
}

export async function getAppointmentCount(): Promise<number> {
  const clinicId =
    await getCurrentClinicId();

  const { count, error } =
    await supabase
      .from("appointments")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId);

  if (error) {
    console.error(
      "Failed to count appointments:",
      error
    );
    return 0;
  }

  return count ?? 0;
}

export async function getTodaysAppointmentCount(): Promise<number> {
  const clinicId =
    await getCurrentClinicId();

  const today = localDateString(new Date());

  const { count, error } =
    await supabase
      .from("appointments")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .eq("appointment_date", today);

  if (error) {
    console.error(
      "Failed to count today's appointments:",
      error
    );
    return 0;
  }

  return count ?? 0;
}

export async function getTodaysAppointments(): Promise<Appointment[]> {
  const clinicId =
    await getCurrentClinicId();

  const today = localDateString(new Date());

  const { data, error } =
    await supabase
      .from("appointments")
      .select(
        `
        *,
        patients (
          first_name,
          last_name
        ),
        dentists (
          full_name
        )
      `
      )
      .eq("clinic_id", clinicId)
      .eq("appointment_date", today)
      .order("appointment_time", {
        ascending: true,
      });

  if (error) {
    console.error(
      "Failed to fetch today's appointments:",
      error
    );
    return [];
  }

  return (data as Appointment[]) ?? [];
}

interface CreateAppointmentData {
  patient_id: string;
  dentist_id: string;
  appointment_date: string;
  appointment_time: string;
  treatment: string;
  notes?: string;
  status?: string;
  duration?: number;
  /** Phase B/C: the single planned treatment this appointment is for, if
   * any - optional and unrelated to most appointments (checkups,
   * consults). See services/appointments.ts#completeAppointment(). */
  treatment_plan_item_id?: string | null;
}

const MINIMUM_APPOINTMENT_DURATION_MINUTES = 60;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export class AppointmentConflictError extends Error {
  constructor(
    message = "This dentist already has an appointment within one hour of that time."
  ) {
    super(message);
    this.name = "AppointmentConflictError";
  }
}

/**
 * Returns true if the dentist has another active (non-cancelled) appointment
 * on the same date whose time range overlaps [startTime, startTime+duration).
 * excludeId lets updateAppointment ignore the appointment being edited.
 */
async function hasDentistConflict(params: {
  clinicId: string;
  dentistId: string;
  date: string;
  time: string;
  duration: number;
  excludeId?: string;
}): Promise<boolean> {
  const {
    clinicId,
    dentistId,
    date,
    time,
    duration,
    excludeId,
  } = params;

  let query = supabase
    .from("appointments")
    .select("id, appointment_time, duration, status")
    .eq("clinic_id", clinicId)
    .eq("dentist_id", dentistId)
    .eq("appointment_date", date)
    .neq("status", "Cancelled");

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query;

  if (error) {
    console.error(
      "Failed to check appointment conflicts:",
      error
    );
    // Never create an appointment when availability could not be verified.
    throw error;
  }

  const newStart = timeToMinutes(time);
  const newEnd = newStart + duration;

  return (data ?? []).some((existing) => {
    const existingStart = timeToMinutes(
      existing.appointment_time
    );
    const existingEnd =
      existingStart +
      Math.max(
        existing.duration ?? MINIMUM_APPOINTMENT_DURATION_MINUTES,
        MINIMUM_APPOINTMENT_DURATION_MINUTES
      );

    return newStart < existingEnd && existingStart < newEnd;
  });
}

export async function createAppointment(
  appointment: CreateAppointmentData
) {
  const clinicId =
    await getCurrentClinicId();

  const duration = Math.max(
    appointment.duration ?? MINIMUM_APPOINTMENT_DURATION_MINUTES,
    MINIMUM_APPOINTMENT_DURATION_MINUTES
  );

  const conflict = await hasDentistConflict({
    clinicId,
    dentistId: appointment.dentist_id,
    date: appointment.appointment_date,
    time: appointment.appointment_time,
    duration,
  });

  if (conflict) {
    throw new AppointmentConflictError();
  }

  const payload = {
    clinic_id: clinicId,
    patient_id:
      appointment.patient_id,
    dentist_id:
      appointment.dentist_id,
    appointment_date:
      appointment.appointment_date,
    appointment_time:
      appointment.appointment_time,
    duration,
    treatment:
      appointment.treatment,
    notes:
      appointment.notes ?? "",
    status:
      appointment.status ??
      "Scheduled",
    treatment_plan_item_id:
      appointment.treatment_plan_item_id || null,
  };

  const { data, error } =
    await supabase
      .from("appointments")
      .insert(payload)
      .select()
      .single();

  if (error) {
    console.error(
      "Supabase insert error:",
      error
    );
    throw error;
  }

  await notifyAppointmentBooked(data);

  return data;
}

export async function updateAppointment(
  id: string,
  appointment: Partial<Appointment>
) {
  // Full-app audit fix C5 (Critical): this was a plain field update with
  // no special handling for status - setting status: "Completed" through
  // it silently skipped completeAndBillTreatmentItem entirely, so a
  // linked treatment never got billed. Completion must always go through
  // completeAppointment() (which also atomically guards against
  // double-completion and offers to complete/bill the linked treatment).
  // Rejecting it here is a second line of defense behind removing
  // "Completed" from the ordinary edit form's dropdown - it protects
  // every caller, not just that one form.
  if (appointment.status === "Completed") {
    throw new Error(
      "Use completeAppointment() to mark an appointment completed - it also handles billing for any linked treatment correctly."
    );
  }

  const clinicId =
    await getCurrentClinicId();

  const { data: existing } =
    await supabase
      .from("appointments")
      .select(
        "status, appointment_date, appointment_time, treatment, dentist_id, duration"
      )
      .eq("id", id)
      .eq("clinic_id", clinicId)
      .maybeSingle();

  // Full-app audit II fix (Critical #1): the guard above only rejected
  // the INCOMING status "Completed" - it never checked the row's
  // EXISTING status, so a Completed (already-billed) appointment could
  // be silently reverted and rewritten right back through this same
  // function. Completed appointments are historical records (same rule
  // deleteAppointment() already applies) - a database trigger
  // (trg_guard_completed_appointment_immutable, migration 0128) is the
  // real enforcement; this is a friendlier second line of defense.
  if (existing?.status === "Completed") {
    throw new Error(
      "Completed appointments are historical records and cannot be edited."
    );
  }

  if (existing) {
    const nextDentistId =
      appointment.dentist_id ?? existing.dentist_id;
    const nextDate =
      appointment.appointment_date ??
      existing.appointment_date;
    const nextTime =
      appointment.appointment_time ??
      existing.appointment_time;
    const nextDuration =
      Math.max(
        appointment.duration ??
          existing.duration ??
          MINIMUM_APPOINTMENT_DURATION_MINUTES,
        MINIMUM_APPOINTMENT_DURATION_MINUTES
      );
    const nextStatusForConflict =
      appointment.status ?? existing.status;

    const scheduleChanged =
      nextDentistId !== existing.dentist_id ||
      nextDate !== existing.appointment_date ||
      nextTime !== existing.appointment_time ||
      nextDuration !== existing.duration;

    if (
      nextDentistId &&
      nextStatusForConflict !== "Cancelled" &&
      (scheduleChanged || existing.status === "Cancelled")
    ) {
      const conflict = await hasDentistConflict({
        clinicId,
        dentistId: nextDentistId,
        date: nextDate,
        time: nextTime,
        duration: nextDuration,
        excludeId: id,
      });

      if (conflict) {
        throw new AppointmentConflictError();
      }
    }
  }

  const { error } =
    await supabase
      .from("appointments")
      .update({
        ...appointment,
        // The Edit Appointment form's "Link to planned treatment" select
        // uses "" for "not linked" (a plain HTML <select> can't hold
        // null) - "" is never a valid uuid, so it must be normalized to
        // null here rather than sent to the database as-is.
        ...(appointment.treatment_plan_item_id === ""
          ? { treatment_plan_item_id: null }
          : {}),
      })
      .eq("id", id)
      .eq("clinic_id", clinicId);

  if (error) {
    console.error(
      "Failed to update appointment:",
      error
    );
    throw error;
  }

  if (existing) {
    const nextStatus =
      appointment.status ?? existing.status;

    const nextDate =
      appointment.appointment_date ??
      existing.appointment_date;

    const nextTime =
      appointment.appointment_time ??
      existing.appointment_time;

    const treatment =
      appointment.treatment ??
      existing.treatment;

    if (
      nextStatus !== existing.status &&
      nextStatus === "Cancelled"
    ) {
      await notifyAppointmentCancelled({
        id,
        treatment,
        appointment_date: nextDate,
      });
    } else if (
      nextStatus !== existing.status &&
      nextStatus === "Completed"
    ) {
      await notifyAppointmentCompleted({
        id,
        treatment,
      });
    } else if (
      nextStatus === existing.status &&
      (nextDate !== existing.appointment_date ||
        nextTime !== existing.appointment_time)
    ) {
      await notifyAppointmentRescheduled({
        id,
        treatment,
        appointment_date: nextDate,
      });
    }
  }
}

export interface CompleteAppointmentResult {
  appointment: Appointment;
  /** True when this call found the appointment already Completed, or lost
   * a concurrent race to complete it - nothing further happened. */
  alreadyCompleted: boolean;
  /** True only when this call also confirmed the linked treatment itself
   * is now fully complete (never true for an unlinked appointment, and
   * never true unless options.completeTreatment was explicitly passed). */
  treatmentCompleted: boolean;
  invoiced: boolean;
  billingDeferred: boolean;
}

/**
 * Phase B/C: the ONE place an appointment's completion can lead to
 * billing. Appointment completion and treatment completion are
 * deliberately different things (see the Phase A/B audit) - completing an
 * unlinked appointment, or a linked one without options.completeTreatment
 * set, behaves exactly like the old plain "mark as completed" action:
 * zero financial effect.
 *
 * Duplicate protection for the SAME appointment (two clicks, two tabs,
 * two staff) is the conditional `.neq("status", "Completed")` update
 * below - a single UPDATE...WHERE statement is atomic in Postgres, so
 * only one of two truly concurrent calls can ever find zero rows changed
 * versus one. Duplicate protection for the underlying TREATMENT (needed
 * because several different appointments can legitimately point at the
 * same multi-visit treatment) lives one layer down, in
 * completeTreatmentItem()'s `for update` lock (migration 0108) - this
 * function never needs to re-implement that itself.
 */
/**
 * Full-app audit fix H5: flips an appointment's own status to Completed,
 * idempotently (a no-op returning false if it's already Completed,
 * including the concurrent-race case) - the single shared primitive both
 * completeAppointment() (the "Mark as Completed" button) and
 * completeTreatmentDirectly()'s "Treatment Completed" direct-action path
 * (app/admin/appointments/[id]/page.tsx) use, so completing a linked
 * treatment directly always also completes the appointment it was
 * completed from, instead of leaving it looking like unfinished
 * upcoming work on the calendar/list.
 */
export async function markAppointmentCompleted(
  appointmentId: string
): Promise<boolean> {
  const clinicId = await getCurrentClinicId();

  // One conditional update, not a separate pre-fetch - the `.neq()`
  // atomically covers "already Completed" and "another request just
  // completed it" alike, and `.select("id, treatment")` gets back
  // everything the notification needs without a second round trip.
  const { data: updated, error: updateError } = await supabase
    .from("appointments")
    .update({ status: "Completed" })
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .neq("status", "Completed")
    .select("id, treatment")
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  if (!updated) {
    return false;
  }

  await notifyAppointmentCompleted({
    id: appointmentId,
    treatment: updated.treatment,
  });

  return true;
}

export async function completeAppointment(
  appointmentId: string,
  options: {
    completeTreatment?: boolean;
    paymentMethod?: string | null;
    insuranceProviderId?: string | null;
  } = {}
): Promise<CompleteAppointmentResult> {
  const clinicId = await getCurrentClinicId();

  const { data: existing, error: fetchError } = await supabase
    .from("appointments")
    .select("id, status, treatment, treatment_plan_item_id")
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!existing) {
    throw new Error("Appointment not found.");
  }

  const alreadyCompletedResult = async (): Promise<CompleteAppointmentResult> => {
    const full = await getAppointmentById(appointmentId);

    return {
      appointment: full as Appointment,
      alreadyCompleted: true,
      treatmentCompleted: false,
      invoiced: false,
      billingDeferred: false,
    };
  };

  if (existing.status === "Completed") {
    return alreadyCompletedResult();
  }

  const didComplete = await markAppointmentCompleted(appointmentId);

  if (!didComplete) {
    // Lost the race - another request completed it first.
    return alreadyCompletedResult();
  }

  let treatmentCompleted = false;
  let invoiced = false;
  let billingDeferred = false;

  if (options.completeTreatment && existing.treatment_plan_item_id) {
    const result = await completeAndBillTreatmentItem(
      existing.treatment_plan_item_id,
      options.paymentMethod,
      options.insuranceProviderId
    );

    treatmentCompleted = result.treatmentCompleted;
    invoiced = result.invoiced;
    billingDeferred = result.billingDeferred;
  }

  const full = await getAppointmentById(appointmentId);

  return {
    appointment: full as Appointment,
    alreadyCompleted: false,
    treatmentCompleted,
    invoiced,
    billingDeferred,
  };
}

export async function deleteAppointment(
  id: string
) {
  const clinicId =
    await getCurrentClinicId();

  // Full-app audit fix H6: a Completed appointment is a historical
  // clinical/billing record (when a visit actually happened, tied to
  // whatever was invoiced from it) - the delete confirmation used to be
  // identical generic text regardless of status, letting one casually
  // detach billing history from its originating visit. A finished,
  // historical record shouldn't be removable through the UI at all;
  // Cancel remains available for anything not yet completed.
  const { data: existing } =
    await supabase
      .from("appointments")
      .select("status")
      .eq("id", id)
      .eq("clinic_id", clinicId)
      .maybeSingle();

  if (existing?.status === "Completed") {
    throw new Error(
      "Completed appointments are historical records and cannot be deleted."
    );
  }

  const { error } =
    await supabase
      .from("appointments")
      .delete()
      .eq("id", id)
      .eq("clinic_id", clinicId);

  if (error) {
    console.error(
      "Failed to delete appointment:",
      error
    );
    throw error;
  }
}

export interface AppointmentStats {
  scheduled: number;
  completed: number;
  cancelled: number;
}

export async function getAppointmentStats(): Promise<AppointmentStats> {
  const clinicId = await getCurrentClinicId();

  const [
    scheduled,
    completed,
    cancelled,
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .eq("status", "Scheduled"),

    supabase
      .from("appointments")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .eq("status", "Completed"),

    supabase
      .from("appointments")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .eq("status", "Cancelled"),
  ]);

  return {
    scheduled:
      scheduled.count ?? 0,
    completed:
      completed.count ?? 0,
    cancelled:
      cancelled.count ?? 0,
  };
}
