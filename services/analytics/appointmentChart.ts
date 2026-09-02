import { supabase } from "@/lib/supabase";
import { getCurrentClinicId } from "@/services/clinic";
import { getDateRange } from "./dateRange";
import { localDateString } from "@/lib/dateUtils";

export interface AppointmentChartPoint {
  name: string;
  value: number;
}

interface AppointmentStatusRow {
  status: string;
  total: number;
}

export async function getAppointmentChartData(
  range: string
): Promise<AppointmentChartPoint[]> {
  const clinicId = await getCurrentClinicId();

  const { start, end } = getDateRange(range);

  const { data, error } = await supabase.rpc(
    "get_appointment_status_counts",
    {
      p_clinic_id: clinicId,
      p_start: start
        ? localDateString(start)
        : null,
      p_end: end
        ? localDateString(end)
        : null,
    }
  );

  if (error) {
    throw error;
  }

  const counts = {
    Scheduled: 0,
    Completed: 0,
    Cancelled: 0,
    "No Show": 0,
  };

  (data as AppointmentStatusRow[]).forEach((row) => {
    switch ((row.status ?? "").toLowerCase()) {
      case "scheduled":
        counts.Scheduled = Number(row.total);
        break;

      case "completed":
        counts.Completed = Number(row.total);
        break;

      case "cancelled":
        counts.Cancelled = Number(row.total);
        break;

      case "no show":
      case "no-show":
        counts["No Show"] = Number(row.total);
        break;
    }
  });

  return [
    {
      name: "Scheduled",
      value: counts.Scheduled,
    },
    {
      name: "Completed",
      value: counts.Completed,
    },
    {
      name: "Cancelled",
      value: counts.Cancelled,
    },
    {
      name: "No Show",
      value: counts["No Show"],
    },
  ];
}