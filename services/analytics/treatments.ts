import { supabase } from "@/lib/supabase";
import { getCurrentClinicId } from "@/services/clinic";

import { getDateRange } from "./dateRange";

import { TreatmentAnalytics } from "./types";

export async function getTreatmentAnalytics(
  range: string
): Promise<TreatmentAnalytics> {
  const clinicId =
    await getCurrentClinicId();

  const { start, end } =
    getDateRange(range);

  let treatmentsQuery = supabase
    .from("treatments")
    .select(
      "treatment_name,status,cost"
    )
    .eq("clinic_id", clinicId);

  let totalQuery = supabase
    .from("treatments")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId);

  let completedQuery = supabase
    .from("treatments")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId)
    .eq("status", "Completed");

  let pendingQuery = supabase
    .from("treatments")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("clinic_id", clinicId)
    .eq("status", "Pending");

  if (start && end) {
    const from = start.toISOString();
    const to = end.toISOString();

    treatmentsQuery = treatmentsQuery
      .gte("created_at", from)
      .lte("created_at", to);

    totalQuery = totalQuery
      .gte("created_at", from)
      .lte("created_at", to);

    completedQuery = completedQuery
      .gte("created_at", from)
      .lte("created_at", to);

    pendingQuery = pendingQuery
      .gte("created_at", from)
      .lte("created_at", to);
  }

  const [
    treatments,
    total,
    completed,
    pending,
  ] = await Promise.all([
    treatmentsQuery,
    totalQuery,
    completedQuery,
    pendingQuery,
  ]);

  if (treatments.error) {
    throw treatments.error;
  }

  const rows =
    treatments.data ?? [];

  const totalRevenue =
    rows.reduce(
      (sum, treatment) =>
        sum +
        Number(
          treatment.cost ?? 0
        ),
      0
    );

  const averageTreatmentValue =
    (total.count ?? 0) === 0
      ? 0
      : totalRevenue /
        (total.count ?? 1);

  const groupedTreatments =
    rows.reduce(
      (acc, treatment) => {
        const name =
          treatment.treatment_name ??
          "Unnamed Treatment";

        if (!acc[name]) {
          acc[name] = {
            treatment: name,
            count: 0,
            revenue: 0,
          };
        }

        acc[name].count++;

        acc[name].revenue += Number(
          treatment.cost ?? 0
        );

        return acc;
      },
      {} as Record<
        string,
        {
          treatment: string;
          count: number;
          revenue: number;
        }
      >
    );

  return {
    totalTreatments:
      total.count ?? 0,

    totalRevenue,

    averageTreatmentValue,

    completedTreatments:
      completed.count ?? 0,

    pendingTreatments:
      pending.count ?? 0,

    treatments: Object.values(
      groupedTreatments
    ).sort(
      (a, b) =>
        b.count - a.count
    ),
  };
}