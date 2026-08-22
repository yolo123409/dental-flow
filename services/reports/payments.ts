import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, periodLabel } from "./shared";

interface PaymentRow {
  id: string;
  received_at: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  patients: { first_name: string; last_name: string } | null;
  clinic_invoices: { invoice_number: string } | null;
}

/**
 * Reads clinic_payments directly - real recorded payment transactions,
 * never inferred from invoice totals (an invoice's amount_paid/balance is
 * a denormalized aggregate OF these rows, not the other way around).
 * clinic_payments has no "recorded by" column, so that column from the
 * spec is intentionally not included here - see the notice below.
 */
export async function generatePaymentsReport(
  period: ReportPeriod,
  filters: ReportFilters
): Promise<ReportResult> {
  const clinicMeta = await getClinicMeta();

  // Paged rather than a single unbounded fetch - this report exports
  // every matching payment row, and a clinic with more than 1,000
  // payments in the selected period would otherwise silently lose rows
  // from both the totals and the exported table with no error.
  let rows: PaymentRow[];

  try {
    rows = (await fetchAllRows((from, to) => {
      let query = supabase
        .from("clinic_payments")
        .select(
          "id, received_at, amount, payment_method, reference, patients(first_name, last_name), clinic_invoices(invoice_number)"
        )
        .eq("clinic_id", clinicMeta.clinicId)
        .order("received_at", { ascending: false });

      if (period.start && period.end) {
        query = query
          .gte("received_at", period.start.toISOString())
          .lte("received_at", period.end.toISOString());
      }

      if (filters.paymentMethod) {
        query = query.eq("payment_method", filters.paymentMethod);
      }

      if (filters.patientId) {
        query = query.eq("patient_id", filters.patientId);
      }

      return query.range(from, to);
    })) as unknown as PaymentRow[];
  } catch (error) {
    logError("[reports] generatePaymentsReport failed:", error);
    throw error;
  }

  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);

  const byMethod = new Map<string, number>();
  for (const row of rows) {
    byMethod.set(
      row.payment_method,
      (byMethod.get(row.payment_method) ?? 0) + Number(row.amount)
    );
  }

  return {
    id: "payments",
    title: "Payments Report",
    category: "Financial",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: periodLabel(period),
    generatedAt: new Date().toISOString(),

    summaryCards: [
      {
        label: "Total Payments",
        value: currencyValue(total, clinicMeta.currency),
      },
      { label: "Transactions", value: String(rows.length) },
    ],

    columns: [
      { key: "date", label: "Date", format: "date" },
      { key: "patient", label: "Patient", format: "text" },
      { key: "invoice", label: "Invoice", format: "text" },
      { key: "method", label: "Method", format: "text" },
      { key: "amount", label: "Amount", format: "currency" },
      { key: "reference", label: "Reference", format: "text" },
    ],
    rows: rows.map((row) => ({
      date: row.received_at,
      patient: row.patients
        ? `${row.patients.first_name} ${row.patients.last_name}`
        : "—",
      invoice: row.clinic_invoices?.invoice_number ?? "—",
      method: row.payment_method,
      amount: row.amount,
      reference: row.reference ?? "—",
    })),
    totalsRow: { date: "Total", amount: total },

    sections: [
      {
        title: "Payments by Method",
        columns: [
          { key: "method", label: "Payment Method", format: "text" },
          { key: "amount", label: "Amount", format: "currency" },
        ],
        rows: Array.from(byMethod.entries())
          .sort(([, a], [, b]) => b - a)
          .map(([method, amount]) => ({ method, amount })),
      },
    ],

    notices: [
      {
        tone: "info",
        message:
          "DentalFlow does not currently record which staff member received each payment, so a \"Recorded By\" column is not included.",
      },
    ],
  };
}

function currencyValue(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
