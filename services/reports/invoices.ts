import { supabase } from "@/lib/supabase";
import { logError, toError } from "@/lib/logError";

import { ReportFilters, ReportPeriod, ReportResult } from "@/types/reports";
import { getClinicMeta, periodLabel } from "./shared";

interface InvoiceRow {
  invoice_number: string;
  created_at: string;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
  payment_method: string | null;
  patients: { first_name: string; last_name: string } | null;
}

/**
 * Reads clinic_invoices directly with report-specific filters
 * (status/payment method/patient) rather than reusing services/billing.ts
 * getInvoices() (which has no filter params and would need modifying to
 * gain them) - same "several report-shaped queries against the same
 * table" pattern this codebase already uses (getInvoices vs
 * getRevenueAnalytics vs getPatientInvoices each query clinic_invoices
 * independently). Existing invoice behavior is untouched.
 */
export async function generateInvoiceReport(
  period: ReportPeriod,
  filters: ReportFilters
): Promise<ReportResult> {
  const clinicMeta = await getClinicMeta();

  let query = supabase
    .from("clinic_invoices")
    .select(
      "invoice_number, created_at, total, amount_paid, balance, status, payment_method, patients(first_name, last_name)"
    )
    .eq("clinic_id", clinicMeta.clinicId)
    .order("created_at", { ascending: false });

  if (period.start && period.end) {
    query = query
      .gte("created_at", period.start.toISOString())
      .lte("created_at", period.end.toISOString());
  }

  if (filters.invoiceStatus) {
    query = query.eq("status", filters.invoiceStatus);
  }

  if (filters.paymentMethod) {
    query = query.eq("payment_method", filters.paymentMethod);
  }

  if (filters.patientId) {
    query = query.eq("patient_id", filters.patientId);
  }

  const { data, error } = await query;

  if (error) {
    logError("[reports] generateInvoiceReport failed:", error);
    throw toError(error);
  }

  const rows = (data ?? []) as unknown as InvoiceRow[];

  const totalInvoiced = rows.reduce((sum, row) => sum + Number(row.total), 0);
  const totalPaid = rows.reduce((sum, row) => sum + Number(row.amount_paid), 0);
  const totalOutstanding = rows.reduce((sum, row) => sum + Number(row.balance), 0);

  return {
    id: "invoices",
    title: "Invoice Report",
    category: "Operations",
    clinicName: clinicMeta.clinicName,
    currency: clinicMeta.currency,
    dateRangeLabel: periodLabel(period),
    generatedAt: new Date().toISOString(),

    summaryCards: [
      { label: "Total Invoiced", value: currencyValue(totalInvoiced, clinicMeta.currency) },
      { label: "Total Paid", value: currencyValue(totalPaid, clinicMeta.currency) },
      {
        label: "Total Outstanding",
        value: currencyValue(totalOutstanding, clinicMeta.currency),
      },
    ],

    columns: [
      { key: "invoiceNumber", label: "Invoice #", format: "text" },
      { key: "patient", label: "Patient", format: "text" },
      { key: "date", label: "Date", format: "date" },
      { key: "total", label: "Total", format: "currency" },
      { key: "paid", label: "Amount Paid", format: "currency" },
      { key: "balance", label: "Balance", format: "currency" },
      { key: "status", label: "Status", format: "text" },
      { key: "method", label: "Payment Method", format: "text" },
    ],
    rows: rows.map((row) => ({
      invoiceNumber: row.invoice_number,
      patient: row.patients
        ? `${row.patients.first_name} ${row.patients.last_name}`
        : "—",
      date: row.created_at,
      total: Number(row.total),
      paid: Number(row.amount_paid),
      balance: Number(row.balance),
      status: row.status,
      method: row.payment_method ?? "—",
    })),
    totalsRow: {
      invoiceNumber: "Total",
      total: totalInvoiced,
      paid: totalPaid,
      balance: totalOutstanding,
    },
  };
}

function currencyValue(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
