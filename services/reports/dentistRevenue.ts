import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, periodLabel } from "./shared";

interface AppointmentRow {
  dentist_id: string | null;
  patient_id: string;
  dentists: { full_name: string } | null;
}

/**
 * IMPORTANT LIMITATION (determined before implementing, per spec): there
 * is no reliable link from clinic_invoices/clinic_invoice_items/
 * clinic_payments back to a treating dentist anywhere in this schema -
 * clinic_invoices links only to patient_id, and clinic_invoice_items only
 * carries a free-text treatment_name (see services/billing.ts). The only
 * dentist-linked entity that actually exists is appointments.dentist_id
 * (-> the separate `dentists` table, not clinic_users). So this report
 * shows Patients and Appointments per dentist - a real, reliable
 * signal - and Revenue is intentionally left unavailable rather than
 * invented (e.g. by matching appointment.treatment text against invoices,
 * which would be a guess, not a real link). A prominent notice says so.
 */
export async function generateDentistRevenueReport(
  period: ReportPeriod,
  filters: ReportFilters
): Promise<ReportResult> {
  const clinicMeta = await getClinicMeta();

  // Paged rather than a single unbounded fetch - a busy clinic can
  // plausibly have more than 1,000 completed appointments in a wide
  // period (a full year, "All Time"), which would otherwise silently
  // undercount both patients and appointments per dentist with no error.
  let rows: AppointmentRow[];

  try {
    rows = (await fetchAllRows((from, to) => {
      let query = supabase
        .from("appointments")
        .select("dentist_id, patient_id, dentists(full_name)")
        .eq("clinic_id", clinicMeta.clinicId)
        .eq("status", "Completed")
        .not("dentist_id", "is", null);

      if (period.start && period.end) {
        query = query
          .gte("appointment_date", period.start.toISOString().slice(0, 10))
          .lte("appointment_date", period.end.toISOString().slice(0, 10));
      }

      if (filters.dentistId) {
        query = query.eq("dentist_id", filters.dentistId);
      }

      return query.range(from, to);
    })) as unknown as AppointmentRow[];
  } catch (error) {
    logError("[reports] generateDentistRevenueReport failed:", error);
    throw error;
  }

  const byDentist = new Map<
    string,
    { name: string; patients: Set<string>; appointments: number }
  >();

  for (const row of rows) {
    if (!row.dentist_id) continue;

    const existing = byDentist.get(row.dentist_id) ?? {
      name: row.dentists?.full_name ?? "Unknown Dentist",
      patients: new Set<string>(),
      appointments: 0,
    };

    existing.patients.add(row.patient_id);
    existing.appointments += 1;

    byDentist.set(row.dentist_id, existing);
  }

  const resultRows = Array.from(byDentist.values())
    .sort((a, b) => b.appointments - a.appointments)
    .map((entry) => ({
      dentist: entry.name,
      patients: entry.patients.size,
      appointments: entry.appointments,
      revenue: null,
    }));

  return {
    id: "dentist-revenue",
    title: "Dentist Revenue Report",
    category: "Performance",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: periodLabel(period),
    generatedAt: new Date().toISOString(),

    summaryCards: [
      { label: "Dentists", value: String(resultRows.length) },
      {
        label: "Completed Appointments",
        value: String(rows.length),
      },
    ],

    columns: [
      { key: "dentist", label: "Dentist", format: "text" },
      { key: "patients", label: "Patients", format: "number" },
      { key: "appointments", label: "Appointments", format: "number" },
      { key: "revenue", label: "Revenue", format: "currency" },
    ],
    rows: resultRows,

    notices: [
      {
        tone: "warning",
        message:
          "Revenue is not shown per dentist: DentalFlow's invoices are linked to a patient, not a treating dentist, so revenue cannot be reliably attributed to a dentist with the current data model. Patients and Appointments above come from completed appointments, which do reliably link to a dentist.",
      },
    ],
  };
}
