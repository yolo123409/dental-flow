"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";
import LedgerReportTotalRow from "@/components/ledger/LedgerReportTotalRow";

import { getClinicSettings } from "@/services/settings";
import { getAccountsReceivableReport } from "@/services/accountsReceivable";
import { ArInvoiceRow, ArReport } from "@/types/accountsReceivable";

import { REPORT_RANGE_OPTIONS, ResolvedPeriod, resolveCurrentPeriod } from "@/lib/reports/period";
import { getSafeErrorMessage } from "@/lib/logError";

const BUCKET_FILTERS = ["All", "Current", "Overdue", "1–30", "31–60", "61–90", "90+"];

function matchesBucketFilter(invoice: ArInvoiceRow, filter: string): boolean {
  const d = invoice.daysOutstanding;

  switch (filter) {
    case "All":
      return true;
    case "Current":
      return invoice.status === "Current";
    case "Overdue":
      return invoice.status === "Overdue";
    case "1–30":
      return d >= 1 && d <= 30;
    case "31–60":
      return d >= 31 && d <= 60;
    case "61–90":
      return d >= 61 && d <= 90;
    case "90+":
      return d > 90;
    default:
      return true;
  }
}

function AccountsReceivablePageContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [rangeLabel, setRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [report, setReport] = useState<ArReport | null>(null);

  const [bucketFilter, setBucketFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [invoiceDateFrom, setInvoiceDateFrom] = useState("");
  const [invoiceDateTo, setInvoiceDateTo] = useState("");

  const resolvedPeriod = useMemo<ResolvedPeriod | null>(
    () => resolveCurrentPeriod(rangeLabel, customStart, customEnd),
    [rangeLabel, customStart, customEnd]
  );

  const load = useCallback(async () => {
    if (!resolvedPeriod) return;

    try {
      setLoading(true);

      const [clinicSettings, data] = await Promise.all([
        getClinicSettings(),
        getAccountsReceivableReport(resolvedPeriod.start, resolvedPeriod.end, resolvedPeriod.label),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setReport(data);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load Accounts Receivable."));
    } finally {
      setLoading(false);
    }
  }, [resolvedPeriod]);

  useEffect(() => {
    load();
  }, [load]);

  const formatMoney = useMemo(
    () => (amount: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount),
    [currency]
  );

  const filteredInvoices = useMemo(() => {
    if (!report) return [];

    const searchLower = search.trim().toLowerCase();
    const from = invoiceDateFrom ? new Date(`${invoiceDateFrom}T00:00:00`) : null;
    const to = invoiceDateTo ? new Date(`${invoiceDateTo}T23:59:59.999`) : null;

    return report.invoices.filter((invoice) => {
      if (!matchesBucketFilter(invoice, bucketFilter)) return false;

      if (searchLower) {
        const haystack = `${invoice.patientName} ${invoice.invoiceNumber}`.toLowerCase();
        if (!haystack.includes(searchLower)) return false;
      }

      const invoiceDate = new Date(invoice.invoiceDate);
      if (from && invoiceDate < from) return false;
      if (to && invoiceDate > to) return false;

      return true;
    });
  }, [report, bucketFilter, search, invoiceDateFrom, invoiceDateTo]);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/ledger"
          className="text-sm font-medium text-eucalyptus hover:underline"
        >
          ← Back to Ledger
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Accounts Receivable</h1>
        <p className="mt-2 text-slate-500">
          Outstanding patient balances as of now, built from the accounting ledger&apos;s
          Accounts Receivable account and each invoice&apos;s own recorded balance.
        </p>
      </div>

      {loading || !report ? (
        <LoadingSpinner text="Loading Accounts Receivable..." />
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Total Receivables" value={formatMoney(report.totalOutstanding)} />
            <StatCard title="Overdue (30+ days)" value={formatMoney(report.totalOverdue)} />
            <StatCard title="Current (0–30 days)" value={formatMoney(report.totalCurrent)} />
            <StatCard
              title={`Collected — ${report.periodLabel}`}
              value={formatMoney(report.totalCollected)}
            />
          </div>

          <Card title="This Period">
            <div className="mb-4 flex flex-wrap gap-2">
              {REPORT_RANGE_OPTIONS.map((range) => (
                <button
                  key={range}
                  onClick={() => setRangeLabel(range)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    rangeLabel === range
                      ? "bg-eucalyptus text-white"
                      : "border border-sea-glass bg-enamel hover:bg-porcelain"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>

            {rangeLabel === "Custom Range" && (
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                />
                <span className="text-sm text-mineral">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                />
              </div>
            )}

            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Total Invoiced
                </p>
                <p className="mt-1 text-xl font-bold">{formatMoney(report.totalInvoiced)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Total Collected
                </p>
                <p className="mt-1 text-xl font-bold">{formatMoney(report.totalCollected)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Total Outstanding (now)
                </p>
                <p className="mt-1 text-xl font-bold">{formatMoney(report.totalOutstanding)}</p>
              </div>
            </div>
          </Card>

          <Card title="Aging">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              {Object.values(report.aging).map((bucket) => (
                <div
                  key={bucket.label}
                  className="flex items-center justify-between border-t border-slate-200 px-6 py-3 first:border-t-0"
                >
                  <span className="text-sm text-slate-600">
                    {bucket.label}{" "}
                    <span className="text-xs text-mineral">
                      ({bucket.count} invoice{bucket.count === 1 ? "" : "s"})
                    </span>
                  </span>
                  <span className="font-semibold">{formatMoney(bucket.amount)}</span>
                </div>
              ))}
              <LedgerReportTotalRow
                label="Total Outstanding (invoices)"
                amount={report.reconciliation.invoiceOutstandingBalance}
                formatMoney={formatMoney}
                emphasis
              />
            </div>
          </Card>

          <Card title="Outstanding Invoices">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                {BUCKET_FILTERS.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setBucketFilter(filter)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      bucketFilter === filter
                        ? "bg-eucalyptus text-white"
                        : "border border-sea-glass bg-enamel hover:bg-porcelain"
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  placeholder="Search patient or invoice #..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                />
                <input
                  type="date"
                  value={invoiceDateFrom}
                  onChange={(e) => setInvoiceDateFrom(e.target.value)}
                  className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                />
                <span className="self-center text-sm text-mineral">to</span>
                <input
                  type="date"
                  value={invoiceDateTo}
                  onChange={(e) => setInvoiceDateTo(e.target.value)}
                  className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                />
              </div>
            </div>

            {filteredInvoices.length === 0 ? (
              <EmptyState
                title="No outstanding receivables"
                description={
                  report.invoices.length === 0
                    ? "Every invoice is fully paid - there is nothing outstanding right now."
                    : "No outstanding invoices match the current filters."
                }
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Patient</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Invoice #</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Invoice Date</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Due Date</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Invoice Amount</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Amount Paid</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Outstanding</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">Days Outstanding</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoices.map((invoice) => (
                      <tr key={invoice.invoiceId} className="border-t border-slate-200">
                        <td className="px-6 py-4">
                          <Link
                            href={`/admin/patients/${invoice.patientId}`}
                            className="font-medium text-eucalyptus hover:underline"
                          >
                            {invoice.patientName}
                          </Link>
                        </td>
                        <td className="px-6 py-4">
                          <Link
                            href={`/admin/billing/${invoice.invoiceId}`}
                            className="font-medium text-eucalyptus hover:underline"
                          >
                            {invoice.invoiceNumber}
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-slate-600">
                          {new Date(invoice.invoiceDate).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-slate-600">
                          {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-6 py-4 text-right">{formatMoney(invoice.invoiceAmount)}</td>
                        <td className="px-6 py-4 text-right">{formatMoney(invoice.amountPaid)}</td>
                        <td className="px-6 py-4 text-right font-semibold">
                          {formatMoney(invoice.outstanding)}
                        </td>
                        <td className="px-6 py-4 text-right text-slate-600">
                          {invoice.daysOutstanding}
                        </td>
                        <td className="px-6 py-4">
                          <Badge color={invoice.status === "Overdue" ? "red" : "green"}>
                            {invoice.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-4 text-xs text-mineral">
              &quot;Days Outstanding&quot; is measured from each invoice&apos;s due date, not the
              invoice date - an invoice isn&apos;t Overdue until its due date has actually passed.
              Historical invoices were backfilled to due on receipt (due date = invoice date).
            </p>
          </Card>

          <Card title="Accounting Reconciliation">
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  AR Ledger Balance
                </p>
                <p className="mt-1 text-lg font-bold">
                  {formatMoney(report.reconciliation.ledgerBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Invoice Outstanding Balance
                </p>
                <p className="mt-1 text-lg font-bold">
                  {formatMoney(report.reconciliation.invoiceOutstandingBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-mineral">
                  Difference
                </p>
                <div
                  className={`mt-1 flex items-center gap-2 text-lg font-bold ${
                    report.reconciliation.matches ? "text-eucalyptus" : "text-red-600"
                  }`}
                >
                  {report.reconciliation.matches ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <AlertTriangle size={18} />
                  )}
                  {formatMoney(report.reconciliation.difference)}
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs text-mineral">
              The Accounts Receivable ledger account is the accounting source of truth for every
              total above. When it disagrees with the sum of invoice balances, it usually means
              one or more invoices/payments failed to post to the ledger (check the Ledger page
              for reconciliation issues) - the figures are shown as-is rather than silently forced
              to match.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

export default function AccountsReceivablePage() {
  return (
    <PermissionGuard permission="ledger">
      <AccountsReceivablePageContent />
    </PermissionGuard>
  );
}
