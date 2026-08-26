"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  Boxes,
  Receipt,
  Percent,
} from "lucide-react";

import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import { getClinicSettings } from "@/services/settings";
import {
  ArRiskLevel,
  FinancialOverview,
  getFinancialOverview,
} from "@/services/financialOverview";
import { RatioValue } from "@/types/financialRatios";

import { REPORT_RANGE_OPTIONS, ResolvedPeriod, resolveCurrentPeriod } from "@/lib/reports/period";
import { getSafeErrorMessage } from "@/lib/logError";

function formatPercent(r: RatioValue): string {
  return r.value == null ? "—" : `${r.value.toFixed(1)}%`;
}

function ChangeBadge({ percent }: { percent: number | null }) {
  if (percent == null) return null;

  const up = percent >= 0;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${up ? "text-sage-ink" : "text-clay-ink"}`}
    >
      {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {up ? "+" : ""}
      {percent.toFixed(1)}%
    </span>
  );
}

function riskBadgeColor(level: ArRiskLevel): "green" | "yellow" | "red" | "gray" {
  if (level === "Healthy AR" || level === "No Outstanding AR") return "green";
  if (level === "Attention Required") return "yellow";
  return "red";
}

function AgingBar({
  label,
  amount,
  count,
  maxAmount,
  formatMoney,
}: {
  label: string;
  amount: number;
  count: number;
  maxAmount: number;
  formatMoney: (n: number) => string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-graphite">
          {label} <span className="text-xs text-mineral">({count})</span>
        </span>
        <span className="font-bold text-graphite">{formatMoney(amount)}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-porcelain">
        <div
          className="h-full rounded-full bg-eucalyptus motion-safe:transition-[width] motion-safe:duration-500"
          style={{ width: `${Math.max(amount > 0 ? 2 : 0, (amount / maxAmount) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function FinancialOverviewPageContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");
  const [rangeLabel, setRangeLabel] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [overview, setOverview] = useState<FinancialOverview | null>(null);

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
        getFinancialOverview(resolvedPeriod, rangeLabel),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setOverview(data);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load the Financial Overview."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedPeriod, rangeLabel]);

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Financial Overview</h1>
        <p className="mt-2 text-mineral">
          The financial health of your practice, composed from your existing Ledger, Billing, and
          Analytics reports - this page calculates nothing new, it only brings those authoritative
          figures together.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2">
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
          <div className="mt-4 flex flex-wrap items-center gap-3">
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

        {overview && (
          <p className="mt-4 text-sm text-mineral">
            Showing <span className="font-semibold text-graphite">{overview.periodLabel}</span>
          </p>
        )}
      </Card>

      {loading || !overview ? (
        <LoadingSpinner text="Loading Financial Overview..." />
      ) : (
        <>
          {/* Hero row - L2/L28 */}
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="overflow-hidden">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">Revenue</p>
              <h2 className="data-metric mt-3 text-[28px] font-bold text-graphite">
                {formatMoney(overview.current.revenue)}
              </h2>
              <div className="mt-2 flex items-center gap-2">
                <ChangeBadge percent={overview.comparison?.revenueChangePercent ?? null} />
                <span className="text-xs text-mineral">vs {overview.comparison?.previousLabel}</span>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">Collected</p>
              <h2 className="data-metric mt-3 text-[28px] font-bold text-graphite">
                {formatMoney(overview.current.totalCollected)}
              </h2>
              <p className="mt-2 text-sm text-mineral">
                {formatPercent(overview.current.collectionRatePercent)} collection rate
              </p>
            </Card>

            <Card className="overflow-hidden">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">Outstanding</p>
              <h2 className="data-metric mt-3 text-[28px] font-bold text-graphite">
                {formatMoney(overview.ar.totalOutstanding)}
              </h2>
              <div className="mt-2">
                <Badge color={riskBadgeColor(overview.arRiskLevel)}>{overview.arRiskLevel}</Badge>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">Net Profit</p>
              <h2 className="data-metric mt-3 text-[28px] font-bold text-graphite">
                {formatMoney(overview.current.netProfit)}
              </h2>
              <p className="mt-2 text-sm text-mineral">
                {formatPercent(overview.current.netProfitMarginPercent)} net margin
              </p>
            </Card>
          </div>

          {/* Revenue vs Collection - L5 */}
          <Card title="Revenue vs. Collection">
            <p className="-mt-2 mb-5 text-xs text-mineral">
              Revenue is what was invoiced this period. Collected is what has actually been received
              in cash. These are never the same number - the gap between them is what remains
              outstanding.
            </p>

            <div className="space-y-4">
              <AgingBar
                label="Invoiced"
                amount={overview.current.totalInvoiced}
                count={0}
                maxAmount={Math.max(overview.current.totalInvoiced, 1)}
                formatMoney={formatMoney}
              />
              <AgingBar
                label="Collected"
                amount={overview.current.totalCollected}
                count={0}
                maxAmount={Math.max(overview.current.totalInvoiced, 1)}
                formatMoney={formatMoney}
              />
              <AgingBar
                label="Outstanding (this period's invoices)"
                amount={Math.max(0, overview.current.totalInvoiced - overview.current.totalCollected)}
                count={0}
                maxAmount={Math.max(overview.current.totalInvoiced, 1)}
                formatMoney={formatMoney}
              />
            </div>

            <p className="mt-4 text-xs text-mineral">
              Note: this bar's "Outstanding" is specific to invoices raised in{" "}
              {overview.periodLabel} - it differs from the AR Health total below, which is every
              outstanding invoice right now regardless of when it was invoiced.
            </p>
          </Card>

          {/* Revenue trend - L6 */}
          <Card title="Revenue Trend">
            {overview.chart == null ? (
              <p className="py-6 text-center text-sm text-mineral">
                A trend chart isn&apos;t available for a Custom Range - pick a named period above to
                see it.
              </p>
            ) : overview.chart.length === 0 ? (
              <EmptyState
                title="No revenue in this period"
                description="Paid invoices will appear here as soon as there are any in this range."
              />
            ) : (
              <div className="flex h-40 items-end gap-1.5">
                {overview.chart.map((point, i) => {
                  const max = Math.max(...overview.chart!.map((p) => p.revenue), 1);

                  return (
                    <div
                      key={`${point.month}-${i}`}
                      className="group relative flex-1"
                      title={`${point.month}: ${formatMoney(point.revenue)} revenue, ${formatMoney(point.tax)} tax`}
                    >
                      <div
                        className="w-full rounded-t bg-eucalyptus motion-safe:transition-[height] motion-safe:duration-500 group-hover:bg-deep-eucalyptus"
                        style={{ height: `${Math.max(2, (point.revenue / max) * 100)}%`, minHeight: 2 }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-xs text-mineral">
              Collected (Paid) revenue by invoice date - hover a bar for the exact figure.
            </p>
          </Card>

          {/* AR Health - L8/L9 */}
          <Card title="AR Health">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-mineral">
                  {overview.ar.invoiceCount} outstanding invoice
                  {overview.ar.invoiceCount === 1 ? "" : "s"} · {overview.ar.patientCount} patient
                  {overview.ar.patientCount === 1 ? "" : "s"}
                </p>
                {overview.arAgingOver60Percent != null && (
                  <p className="mt-1 text-xs text-mineral">
                    {overview.arAgingOver60Percent.toFixed(0)}% of outstanding AR is older than 60
                    days (threshold: &gt;30% = High Aging Exposure, &gt;10% = Attention Required).
                  </p>
                )}
              </div>
              <Link
                href="/admin/billing"
                className="text-sm font-semibold text-eucalyptus hover:underline"
              >
                View AR in Billing →
              </Link>
            </div>

            {overview.ar.invoiceCount === 0 ? (
              <EmptyState
                title="Nothing outstanding right now"
                description="Every invoice is fully paid."
              />
            ) : (
              <div className="space-y-3">
                {overview.ar.buckets.map((bucket) => (
                  <AgingBar
                    key={bucket.key}
                    label={bucket.label}
                    amount={bucket.amount}
                    count={bucket.count}
                    maxAmount={Math.max(overview.ar.totalOutstanding, 1)}
                    formatMoney={formatMoney}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Secondary financial stats - L12/L13/L14 */}
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard title="Cash & Bank" value={formatMoney(overview.cashAndBank)} icon={<Wallet size={20} />} />
            <StatCard
              title="Accounts Payable"
              value={formatMoney(overview.accountsPayable)}
              icon={<CreditCard size={20} />}
            />
            <StatCard title="Inventory" value={formatMoney(overview.inventory)} icon={<Boxes size={20} />} />
            <StatCard
              title="VAT Collected"
              value={formatMoney(overview.current.vatCollected)}
              icon={<Receipt size={20} />}
            />
            <StatCard
              title="Discounts Granted"
              value={formatMoney(overview.current.discountTotal)}
              icon={<Percent size={20} />}
            />
          </div>

          {/* Top Treatments - L15/L16 */}
          <Card title="Top Treatments">
            {overview.topTreatments.length === 0 ? (
              <EmptyState
                title="No treatments performed in this period"
                description="Revenue by treatment will appear here once invoices are paid."
              />
            ) : (
              <div className="space-y-3">
                {overview.topTreatments.map((t) => (
                  <AgingBar
                    key={t.name}
                    label={t.name}
                    amount={t.revenue}
                    count={t.performedCount}
                    maxAmount={Math.max(overview.topTreatments[0]?.revenue ?? 1, 1)}
                    formatMoney={formatMoney}
                  />
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-mineral">
                Actual paid-invoice revenue matched by treatment name - not catalog prices.
              </p>
              <Link
                href="/admin/treatment-profitability"
                className="text-sm font-semibold text-eucalyptus hover:underline"
              >
                View Treatment Profitability →
              </Link>
            </div>
          </Card>

          {/* Branch performance - L17/L18 (CEO, multi-branch only) */}
          {overview.branchPerformance && overview.branchPerformance.branches.length > 0 && (
            <Card title="Branch Performance">
              {!overview.branchPerformance.currencyConsistent ? (
                <p className="text-sm text-mineral">
                  Branches use different currencies - a combined ranking isn&apos;t meaningful. Visit
                  Organization Financials for each branch&apos;s own figures.
                </p>
              ) : (
                <div className="space-y-3">
                  {[...overview.branchPerformance.branches]
                    .sort((a, b) => b.revenue - a.revenue)
                    .map((branch) => (
                      <div
                        key={branch.clinic_id}
                        className="flex items-center justify-between rounded-lg border border-sea-glass p-3"
                      >
                        <span className="font-medium text-graphite">{branch.clinic_name}</span>
                        <div className="flex gap-6 text-right">
                          <div>
                            <p className="text-xs text-mineral">Revenue</p>
                            <p className="font-bold text-graphite">
                              {formatMoney(branch.revenue)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-mineral">Net Profit</p>
                            <p className="font-bold text-graphite">
                              {formatMoney(branch.netProfit)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <Link
                  href="/admin/organization/financials"
                  className="text-sm font-semibold text-eucalyptus hover:underline"
                >
                  View Organization Financials →
                </Link>
              </div>
            </Card>
          )}

          {/* Needs Attention - L21 */}
          {(overview.openReconciliationIssues > 0 ||
            overview.arRiskLevel === "High Aging Exposure" ||
            overview.arRiskLevel === "Attention Required" ||
            overview.ar.largestInvoice) && (
            <Card title="Needs Attention">
              <ul className="space-y-3 text-sm">
                {overview.openReconciliationIssues > 0 && (
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-clay-ink" />
                    <span>
                      {overview.openReconciliationIssues} ledger posting issue
                      {overview.openReconciliationIssues === 1 ? "" : "s"} need attention.{" "}
                      <Link href="/admin/ledger" className="font-semibold text-eucalyptus hover:underline">
                        View Ledger →
                      </Link>
                    </span>
                  </li>
                )}

                {(overview.arRiskLevel === "High Aging Exposure" ||
                  overview.arRiskLevel === "Attention Required") && (
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-ochre-ink" />
                    <span>
                      {overview.arRiskLevel}: {overview.arAgingOver60Percent?.toFixed(0)}% of
                      outstanding AR ({formatMoney(overview.ar.totalOutstanding)}) is older than 60
                      days.
                    </span>
                  </li>
                )}

                {overview.ar.largestInvoice && (
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-mineral" />
                    <span>
                      Largest outstanding balance: {overview.ar.largestInvoice.patientName} -{" "}
                      {overview.ar.largestInvoice.invoiceNumber} (
                      {formatMoney(overview.ar.largestInvoice.balance)}).{" "}
                      <Link
                        href={`/admin/billing/${overview.ar.largestInvoice.invoiceId}`}
                        className="font-semibold text-eucalyptus hover:underline"
                      >
                        View Invoice →
                      </Link>
                    </span>
                  </li>
                )}
              </ul>
            </Card>
          )}

          {/* Financial Reconciliation - L22/L23/L24 */}
          <Card title="Financial Reconciliation">
            <div
              className={`mb-5 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold ${
                overview.reconciled ? "bg-pale-sage text-sage-ink" : "status-scheduled"
              }`}
            >
              {overview.reconciled ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              {overview.reconciled
                ? "Financial systems reconciled"
                : "Reconciliation requires attention"}
            </div>

            <div className="overflow-x-auto rounded-lg border border-sea-glass">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-porcelain">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Check
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Expected
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Actual
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Difference
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.reconciliation.map((check) => (
                    <tr key={check.key} className="border-t border-sea-glass align-top">
                      <td className="px-4 py-4">
                        <p className="font-medium text-graphite">{check.label}</p>
                        <p className="mt-1 text-xs text-mineral">{check.note}</p>
                      </td>
                      <td className="px-4 py-4 text-right text-graphite">
                        {formatMoney(check.expected)}
                      </td>
                      <td className="px-4 py-4 text-right text-graphite">{formatMoney(check.actual)}</td>
                      <td className="px-4 py-4 text-right text-graphite">
                        {formatMoney(check.difference)}
                      </td>
                      <td className="px-4 py-4">
                        <Badge color={check.matches ? "green" : "red"}>
                          {check.matches ? "Matches" : "Mismatch"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs text-mineral">
              Note: this page&apos;s Revenue and Net Profit use the accrual Profit &amp; Loss figures
              (Treatment Revenue account movement), not the Paid-invoices-only figure the main
              Dashboard and Analytics page show. Both are legitimate, already-existing definitions in
              DentalFlow measuring different things (invoiced vs. collected) - this is not a
              reconciliation defect.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

export default function FinancialOverviewPage() {
  return (
    <PermissionGuard permission="ledger">
      <FinancialOverviewPageContent />
    </PermissionGuard>
  );
}
