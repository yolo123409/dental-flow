"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";

import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import { getClinicSettings } from "@/services/settings";
import { getAccountingHealthReport } from "@/services/accountingHealth";
import { AccountingHealthReport, HealthStatus } from "@/types/accountingHealth";
import { getSafeErrorMessage } from "@/lib/logError";

const STATUS_META: Record<
  HealthStatus,
  { label: string; badge: "green" | "yellow" | "red"; icon: typeof CheckCircle2; bannerClass: string }
> = {
  healthy: { label: "Healthy", badge: "green", icon: CheckCircle2, bannerClass: "status-completed" },
  warning: { label: "Attention Required", badge: "yellow", icon: AlertTriangle, bannerClass: "status-scheduled" },
  critical: { label: "Critical Issue", badge: "red", icon: XCircle, bannerClass: "status-cancelled" },
};

const OVERALL_MESSAGE: Record<HealthStatus, string> = {
  healthy: "Healthy — every check reconciles and no unexpected anomaly was found.",
  warning: "Attention Required — known historical exceptions or non-critical data-quality issues exist.",
  critical: "Critical Issue — a new, unexpected accounting discrepancy needs investigation.",
};

function CheckSummaryCard({ title, status, summary }: { title: string; status: HealthStatus; summary: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">{title}</p>
        <Badge color={meta.badge}>{meta.label}</Badge>
      </div>
      <p className="mt-3 flex items-start gap-2 text-sm text-graphite">
        <Icon size={16} className="mt-0.5 shrink-0" />
        <span>{summary}</span>
      </p>
    </Card>
  );
}

function StatBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-mineral">{label}</p>
      <p className="mt-1 text-xl font-bold text-graphite">{value}</p>
    </div>
  );
}

function AccountingHealthPageContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [report, setReport] = useState<AccountingHealthReport | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const [clinicSettings, data] = await Promise.all([getClinicSettings(), getAccountingHealthReport()]);

      setCurrency(clinicSettings.currency || "KES");
      setReport(data);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load Accounting Health."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Accounting Health</h1>
          <p className="mt-2 text-mineral">
            A single detection-only view over every reconciliation check DentalFlow runs - Accounts
            Receivable, payment and expense ledger postings, invoice consistency, and the ledger
            itself. This page never corrects anything automatically; it only reports what it finds.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>

      {loading || !report ? (
        <LoadingSpinner text="Loading Accounting Health..." />
      ) : (
        <>
          <div
            className={`flex items-center gap-3 rounded-lg px-6 py-4 text-base font-semibold ${STATUS_META[report.overallStatus].bannerClass}`}
          >
            {(() => {
              const OverallIcon = STATUS_META[report.overallStatus].icon;
              return <OverallIcon size={22} className="shrink-0" />;
            })()}
            {OVERALL_MESSAGE[report.overallStatus]}
          </div>

          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            <CheckSummaryCard
              title="AR"
              status={report.checks.arReconciliation.status}
              summary={report.checks.arReconciliation.summary}
            />
            <CheckSummaryCard
              title="Payments"
              status={report.checks.paymentReconciliation.status}
              summary={report.checks.paymentReconciliation.summary}
            />
            <CheckSummaryCard
              title="Expenses"
              status={report.checks.expenseReconciliation.status}
              summary={report.checks.expenseReconciliation.summary}
            />
            <CheckSummaryCard
              title="Invoices"
              status={report.checks.invoiceConsistency.status}
              summary={report.checks.invoiceConsistency.summary}
            />
            <CheckSummaryCard
              title="Ledger"
              status={report.checks.ledgerIntegrity.status}
              summary={report.checks.ledgerIntegrity.summary}
            />
            <CheckSummaryCard
              title="Cash Flow"
              status={report.checks.cashFlowReconciliation.status}
              summary={report.checks.cashFlowReconciliation.summary}
            />
          </div>

          <Card title="Reconciliation">
            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-mineral">
                  Accounts Receivable
                </h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-mineral">Ledger AR</dt>
                    <dd className="font-semibold text-graphite">
                      {formatMoney(report.checks.arReconciliation.ledgerBalance)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mineral">Invoice AR</dt>
                    <dd className="font-semibold text-graphite">
                      {formatMoney(report.checks.arReconciliation.invoiceOutstandingBalance)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mineral">Difference</dt>
                    <dd
                      className={`font-semibold ${report.checks.arReconciliation.matches ? "text-eucalyptus" : "text-red-600"}`}
                    >
                      {formatMoney(report.checks.arReconciliation.difference)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-mineral">{report.checks.arReconciliation.explanation}</p>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-mineral">Payment Ledger</h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-mineral">Total Payments</dt>
                    <dd className="font-semibold text-graphite">
                      {report.checks.paymentReconciliation.totalPayments}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mineral">Posted</dt>
                    <dd className="font-semibold text-graphite">
                      {report.checks.paymentReconciliation.postedPayments}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mineral">Missing</dt>
                    <dd className="font-semibold text-graphite">
                      {report.checks.paymentReconciliation.missingPayments}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mineral">Mismatched</dt>
                    <dd className="font-semibold text-graphite">
                      {report.checks.paymentReconciliation.mismatchedPayments}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mineral">Duplicate</dt>
                    <dd className="font-semibold text-graphite">
                      {report.checks.paymentReconciliation.duplicatePayments}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-mineral">{report.checks.paymentReconciliation.explanation}</p>
              </div>
            </div>
          </Card>

          <Card title="Known Historical Exceptions">
            {report.checks.historicalExceptions.entries.length === 0 ? (
              <EmptyState
                title="Nothing tracked yet"
                description="No historical payment-ledger exception has ever been recorded for this clinic."
              />
            ) : (
              <div className="space-y-4">
                {report.checks.historicalExceptions.entries.map((entry) => (
                  <div key={entry.invoiceNumber} className="rounded-lg border border-sea-glass p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/admin/billing`}
                        className="font-semibold text-eucalyptus hover:underline"
                      >
                        {entry.invoiceNumber}
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-graphite">{formatMoney(entry.knownAmount)}</span>
                        <Badge color={entry.currentlyPresent ? "yellow" : "green"}>
                          {entry.currentlyPresent ? "Still Unposted" : "Resolved"}
                        </Badge>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-mineral">{entry.reason}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-mineral">{report.checks.historicalExceptions.explanation}</p>
          </Card>

          <Card title="Expense Ledger">
            {report.checks.expenseReconciliation.exceptions.length === 0 ? (
              <EmptyState
                title="Nothing to report"
                description="Every paid expense has exactly one correctly-amounted ledger posting."
              />
            ) : (
              <div className="space-y-3">
                {report.checks.expenseReconciliation.exceptions.map((exception) => (
                  <div
                    key={exception.expenseId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-sea-glass p-3"
                  >
                    <div>
                      <p className="font-medium text-graphite">{exception.description}</p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-mineral">
                        {exception.exceptionType}
                      </p>
                    </div>
                    <span className="font-semibold text-graphite">{formatMoney(exception.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-mineral">{report.checks.expenseReconciliation.explanation}</p>
          </Card>

          <Card title="Data Quality">
            <div className="grid gap-8 sm:grid-cols-2">
              <div>
                <StatBlock
                  label="Status/Balance Inconsistencies"
                  value={report.checks.invoiceConsistency.issues.length}
                />
                {report.checks.invoiceConsistency.issues.length > 0 && (
                  <ul className="mt-3 space-y-2 text-xs text-mineral">
                    {report.checks.invoiceConsistency.issues.map((issue) => (
                      <li key={issue.invoiceId}>
                        <Link
                          href={`/admin/billing/${issue.invoiceId}`}
                          className="font-medium text-eucalyptus hover:underline"
                        >
                          {issue.invoiceNumber}
                        </Link>{" "}
                        — {issue.issue}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <StatBlock label="Overpaid Invoices" value={report.checks.overpayments.overpayments.length} />
                {report.checks.overpayments.overpayments.length > 0 && (
                  <ul className="mt-3 space-y-2 text-xs text-mineral">
                    {report.checks.overpayments.overpayments.map((o) => (
                      <li key={o.invoiceId}>
                        <Link
                          href={`/admin/billing/${o.invoiceId}`}
                          className="font-medium text-eucalyptus hover:underline"
                        >
                          {o.invoiceNumber}
                        </Link>{" "}
                        — {o.patientName}, overpaid {formatMoney(o.amountOverpaid)}
                        {o.isKnownException && <span className="text-mineral"> (known exception)</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <p className="mt-4 text-xs text-mineral">
              {report.checks.invoiceConsistency.explanation} {report.checks.overpayments.explanation}
            </p>
          </Card>

          <Card title="Ledger Integrity">
            <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-4">
              <StatBlock label="Transactions Checked" value={report.checks.ledgerIntegrity.totalTransactions} />
              <StatBlock label="Unbalanced" value={report.checks.ledgerIntegrity.unbalancedTransactions} />
              <StatBlock label="Missing Entries" value={report.checks.ledgerIntegrity.transactionsWithoutEntries} />
              <StatBlock
                label="Duplicate References"
                value={report.checks.ledgerIntegrity.duplicateReferenceGroups}
              />
            </div>
            <p className="mt-4 text-xs text-mineral">{report.checks.ledgerIntegrity.explanation}</p>
          </Card>

          <p className="text-right text-xs text-mineral">
            Last checked {new Date(report.checkedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

export default function AccountingHealthPage() {
  return (
    <PermissionGuard permission="ledger">
      <AccountingHealthPageContent />
    </PermissionGuard>
  );
}
