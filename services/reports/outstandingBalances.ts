import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";
import { fetchAllRows } from "@/lib/fetchAllRows";

import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, periodLabel } from "./shared";

interface InvoiceRow {
  id: string;
  invoice_number: string;
  created_at: string;
  total: number;
  amount_paid: number;
  balance: number;
  patients: { first_name: string; last_name: string } | null;
}

/**
 * Only genuinely outstanding invoices (status not in Paid/Voided) - a
 * Paid invoice never appears here even if it was paid off after being
 * partially paid for a while, and a Voided invoice never appears here
 * either: void_invoice() zeroes `balance` but deliberately leaves `total`
 * unchanged for history, so this must read the already-correct `balance`
 * column rather than recompute total - amount_paid (Critical Safety
 * Closure fix #4 - the recompute was showing every voided invoice as
 * fully outstanding forever). clinic_invoices has no due-date column in
 * this schema, so "Days Outstanding" is measured from the invoice's
 * creation date rather than a due date, and the "Due Date" column from
 * the spec is intentionally omitted (see the notice below) rather than
 * shown blank.
 */
export async function generateOutstandingBalancesReport(
  period: ReportPeriod,
  filters: ReportFilters
): Promise<ReportResult> {
  const clinicMeta = await getClinicMeta();

  // Paged rather than a single unbounded fetch - this report exports
  // every matching outstanding invoice, and a clinic with more than
  // 1,000 in the selected period would otherwise silently lose rows
  // from both the totals and the exported table with no error.
  let invoiceRows: InvoiceRow[];

  try {
    invoiceRows = (await fetchAllRows((from, to) => {
      let query = supabase
        .from("clinic_invoices")
        .select(
          "id, invoice_number, created_at, total, amount_paid, balance, patients(first_name, last_name)"
        )
        .eq("clinic_id", clinicMeta.clinicId)
        .neq("status", "Paid")
        .neq("status", "Voided")
        .order("created_at", { ascending: true });

      if (period.start && period.end) {
        query = query
          .gte("created_at", period.start.toISOString())
          .lte("created_at", period.end.toISOString());
      }

      if (filters.patientId) {
        query = query.eq("patient_id", filters.patientId);
      }

      return query.range(from, to);
    })) as unknown as InvoiceRow[];
  } catch (error) {
    logError("[reports] generateOutstandingBalancesReport failed:", error);
    throw error;
  }

  const now = Date.now();

  const rows = invoiceRows.map((row) => {
    const outstanding = Number(row.balance);
    const daysOutstanding = Math.max(
      0,
      Math.floor((now - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24))
    );

    return {
      patient: row.patients
        ? `${row.patients.first_name} ${row.patients.last_name}`
        : "—",
      invoice: row.invoice_number,
      invoiceDate: row.created_at,
      total: Number(row.total),
      paid: Number(row.amount_paid),
      outstanding,
      daysOutstanding,
    };
  });

  const totalOutstanding = rows.reduce((sum, row) => sum + row.outstanding, 0);

  const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const row of rows) {
    if (row.daysOutstanding <= 30) aging["0-30"] += row.outstanding;
    else if (row.daysOutstanding <= 60) aging["31-60"] += row.outstanding;
    else if (row.daysOutstanding <= 90) aging["61-90"] += row.outstanding;
    else aging["90+"] += row.outstanding;
  }

  return {
    id: "outstanding-balances",
    title: "Outstanding Balances Report",
    category: "Financial",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: periodLabel(period),
    generatedAt: new Date().toISOString(),

    summaryCards: [
      {
        label: "Total Outstanding",
        value: currencyValue(totalOutstanding, clinicMeta.currency),
      },
      { label: "Outstanding Invoices", value: String(rows.length) },
    ],

    columns: [
      { key: "patient", label: "Patient", format: "text" },
      { key: "invoice", label: "Invoice", format: "text" },
      { key: "invoiceDate", label: "Invoice Date", format: "date" },
      { key: "total", label: "Total", format: "currency" },
      { key: "paid", label: "Paid", format: "currency" },
      { key: "outstanding", label: "Outstanding", format: "currency" },
      { key: "daysOutstanding", label: "Days Outstanding", format: "number" },
    ],
    rows,
    totalsRow: {
      patient: "Total",
      total: rows.reduce((sum, row) => sum + row.total, 0),
      paid: rows.reduce((sum, row) => sum + row.paid, 0),
      outstanding: totalOutstanding,
    },

    sections: [
      {
        title: "Aging",
        columns: [
          { key: "bucket", label: "Age", format: "text" },
          { key: "amount", label: "Outstanding", format: "currency" },
        ],
        rows: Object.entries(aging).map(([bucket, amount]) => ({
          bucket: `${bucket} days`,
          amount,
        })),
      },
    ],

    notices: [
      {
        tone: "info",
        message:
          "DentalFlow invoices don't currently have a due date, so \"Days Outstanding\" is measured from the invoice date rather than a due date, and a \"Due Date\" column is not included.",
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
