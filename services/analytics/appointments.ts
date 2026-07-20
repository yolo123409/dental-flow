import { supabase } from "@/lib/supabase";

import { getCurrentClinicId } from "@/services/clinic";

import { getDateRange } from "./dateRange";

import {
  AppointmentAnalytics,
} from "./types";

interface AppointmentAnalyticsRow {
  total_appointments: number;
  scheduled_today: number;
  completed: number;
  cancelled: number;
  no_shows: number;
}

export async function getAppointmentAnalytics(
  range: string
): Promise<AppointmentAnalytics> {
  const clinicId =
    await getCurrentClinicId();

  const { start, end } =
    getDateRange(range);

  const { data, error } =
    await supabase.rpc(
      "get_appointment_analytics",
      {
        p_clinic_id: clinicId,
        p_start: start
          ? start
              .toISOString()
              .split("T")[0]
          : null,
        p_end: end
          ? end
              .toISOString()
              .split("T")[0]
          : null,
      }
    );

  if (error) {
    throw error;
  }

  const analytics =
    (data?.[0] ??
      {}) as AppointmentAnalyticsRow;

  return {
    totalAppointments:
      Number(
        analytics.total_appointments ?? 0
      ),
    scheduledToday: Number(
      analytics.scheduled_today ?? 0
    ),
    completed: Number(
      analytics.completed ?? 0
    ),
    cancelled: Number(
      analytics.cancelled ?? 0
    ),
    noShows: Number(
      analytics.no_shows ?? 0
    ),
  };
}