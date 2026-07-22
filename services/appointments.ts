import { supabase } from "@/lib/supabase";
import { Appointment } from "@/types/appointment";

import { getCurrentClinicId } from "@/services/clinic";

import {
  notifyAppointmentBooked,
  notifyAppointmentCancelled,
  notifyAppointmentCompleted,
  notifyAppointmentRescheduled,
} from "@/services/notifications";

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

  const today = new Date()
    .toISOString()
    .split("T")[0];

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

  const today = new Date()
    .toISOString()
    .split("T")[0];

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
      .update(appointment)
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

export async function deleteAppointment(
  id: string
) {
  const clinicId =
    await getCurrentClinicId();

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
