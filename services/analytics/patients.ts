import { supabase } from "@/lib/supabase";
import { getCurrentClinicId } from "@/services/clinic";

import { getDateRange } from "./dateRange";

import { PatientAnalytics } from "./types";

export async function getPatientAnalytics(
  range: string
): Promise<PatientAnalytics> {
  const clinicId = await getCurrentClinicId();

  const { start, end } = getDateRange(range);

  let totalQuery = supabase
    .from("patients")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId);

  if (start && end) {
    totalQuery = totalQuery
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString());
  }

  const [
    total,
    returning,
    inactive,
  ] = await Promise.all([
    totalQuery,

    supabase
      .from("patients")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .not("last_visit", "is", null),

    supabase
      .from("patients")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("clinic_id", clinicId)
      .or(
        `last_visit.is.null,last_visit.lt.${new Date(
          new Date().setMonth(
            new Date().getMonth() - 6
          )
        ).toISOString()}`
      ),
  ]);

  return {
    totalPatients: total.count ?? 0,
    newPatientsThisMonth: total.count ?? 0,
    returningPatients:
      returning.count ?? 0,
    inactivePatients:
      inactive.count ?? 0,
  };
}