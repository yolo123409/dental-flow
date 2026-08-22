"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, TrendingUp } from "lucide-react";

import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import ConfigureCostModal from "@/components/treatmentProfitability/ConfigureCostModal";

import usePermissions from "@/hooks/usePermissions";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import { getTreatmentProfitabilityReport } from "@/services/treatmentProfitability";
import { getClinicSettings } from "@/services/settings";

import {
  TreatmentProfitabilityReport,
  TreatmentProfitabilityRow,
} from "@/types/treatmentProfitability";

const DATE_RANGES = [
  "Today",
  "7 Days",
  "30 Days",
  "This Month",
  "This Year",
  "All Time",
];

type SortKey = "name" | "revenue" | "grossProfit" | "margin";

function TreatmentProfitabilityPageContent() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("treatment_profitability_manage");

  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<TreatmentProfitabilityReport | null>(
    null
  );
  const [currency, setCurrency] = useState("KES");
  const [dateRange, setDateRange] = useState("This Month");

  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [configuring, setConfiguring] =
    useState<TreatmentProfitabilityRow | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const [reportData, clinicSettings] = await Promise.all([
        getTreatmentProfitabilityReport(dateRange),
        getClinicSettings(),
      ]);

      setReport(reportData);
      setCurrency(clinicSettings.currency || "KES");
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to load treatment profitability.",
          "[TreatmentProfitabilityPage] load failed:"
        )
      );
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

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

  const sortedRows = useMemo(() => {
    if (!report) return [];

    const rows = [...report.rows];

    // Rows with unconfigured cost are excluded from gross-profit/margin
    // sorts (there's nothing to rank), but always stay visible in the
    // table itself.
    const valueFor = (row: TreatmentProfitabilityRow): number | null => {
      switch (sortKey) {
        case "name":
          return null;
        case "revenue":
          return row.revenue;
        case "grossProfit":
          return row.actualGrossProfit;
        case "margin":
          return row.actualGrossMargin;
      }
    };

    rows.sort((a, b) => {
      if (sortKey === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === "asc" ? cmp : -cmp;
      }

      const aValue = valueFor(a);
      const bValue = valueFor(b);

      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      const cmp = aValue - bValue;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [report, sortKey, sortDir]);

  const topProfitable = useMemo(() => {
    if (!report) return [];

    return [...report.rows]
      .filter((row) => row.actualGrossProfit != null && row.performedCount > 0)
      .sort((a, b) => (b.actualGrossProfit ?? 0) - (a.actualGrossProfit ?? 0))
      .slice(0, 5);
  }, [report]);

  const topMargin = useMemo(() => {
    if (!report) return [];

    return [...report.rows]
      .filter((row) => row.actualGrossMargin != null && row.performedCount > 0)
      .sort((a, b) => (b.actualGrossMargin ?? 0) - (a.actualGrossMargin ?? 0))
      .slice(0, 5);
  }, [report]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Treatment Profitability</h1>
        <p className="mt-2 text-slate-500">
          See how profitable each treatment is, based on actual revenue and
          the direct costs you configure. This is gross profit per
          treatment, not the clinic&apos;s overall net profit.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {DATE_RANGES.map((range) => (
          <button
            key={range}
            onClick={() => setDateRange(range)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              dateRange === range
                ? "bg-eucalyptus text-white"
                : "border border-sea-glass bg-enamel hover:bg-porcelain"
            }`}
          >
            {range}
          </button>
        ))}
      </div>

      {loading || !report ? (
        <LoadingSpinner text="Loading treatment profitability..." />
      ) : (
        <>
          {report.summary.costCoveragePercent != null &&
            report.summary.costCoveragePercent < 100 && (
              <div className="status-scheduled rounded-lg px-6 py-4 text-sm">
                Direct cost is configured for only{" "}
                {Math.round(report.summary.costCoveragePercent)}% of revenue
                in this period ({report.summary.treatmentsWithCostConfigured}{" "}
                of {report.summary.treatmentsPerformedCount} performed
                treatments). Gross profit and margin below reflect only the
                treatments with a configured cost - configure more to get a
                fuller picture.
              </div>
            )}

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={`Total Treatment Revenue — ${dateRange}`}
              value={formatMoney(report.summary.totalRevenue)}
              icon={<TrendingUp size={20} />}
            />

            <StatCard
              title="Total Direct Costs"
              value={formatMoney(report.summary.totalDirectCosts)}
              subtitle={`From ${report.summary.treatmentsWithCostConfigured} treatment(s) with cost configured`}
            />

            <StatCard
              title="Total Gross Profit"
              value={formatMoney(report.summary.totalGrossProfit)}
            />

            <StatCard
              title="Average Gross Margin"
              value={
                report.summary.averageGrossMargin == null
                  ? "—"
                  : `${report.summary.averageGrossMargin.toFixed(1)}%`
              }
              subtitle={
                report.summary.averageGrossMargin == null
                  ? "No cost data configured yet"
                  : undefined
              }
            />
          </div>

          {(topProfitable.length > 0 || topMargin.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Most Profitable Treatments">
                {topProfitable.length === 0 ? (
                  <p className="text-sm text-mineral">
                    No treatments with cost data performed in this period.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {topProfitable.map((row, index) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="font-medium text-graphite">
                          {index + 1}. {row.name}
                        </span>
                        <span className="font-semibold text-eucalyptus">
                          {formatMoney(row.actualGrossProfit ?? 0)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              <Card title="Highest Margin Treatments">
                {topMargin.length === 0 ? (
                  <p className="text-sm text-mineral">
                    No treatments with cost data performed in this period.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {topMargin.map((row, index) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="font-medium text-graphite">
                          {index + 1}. {row.name}
                        </span>
                        <span className="font-semibold text-eucalyptus">
                          {(row.actualGrossMargin ?? 0).toFixed(1)}%
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          )}

          <Card>
            {report.rows.length === 0 ? (
              <EmptyState
                title="No treatments configured yet"
                description='Add treatments from the Treatments page, then come back here to configure their direct cost.'
              />
            ) : (
              <>
                <div className="mb-6 flex flex-wrap justify-end gap-3">
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
                  >
                    <option value="name">Sort: Treatment Name</option>
                    <option value="revenue">Sort: Revenue</option>
                    <option value="grossProfit">Sort: Gross Profit</option>
                    <option value="margin">Sort: Margin</option>
                  </select>

                  <button
                    onClick={() =>
                      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
                    }
                    aria-label="Toggle sort direction"
                    className="flex min-h-11 items-center justify-center rounded-lg border border-sea-glass bg-enamel px-3 text-graphite transition-colors hover:border-mineral/50"
                  >
                    {sortDir === "asc" ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </button>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-semibold">
                        Treatment
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold">
                        Category
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">
                        Selling Price
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">
                        Direct Cost
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">
                        Gross Profit
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">
                        Margin
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">
                        Performed
                      </th>
                      <th className="px-6 py-4 text-right text-sm font-semibold">
                        Revenue
                      </th>
                      {canManage && <th className="w-32"></th>}
                    </tr>
                  </thead>

                  <tbody>
                    {sortedRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-200">
                        <td className="px-6 py-5 font-medium">
                          <Link
                            href={`/admin/treatment-profitability/${row.id}`}
                            className="text-eucalyptus hover:underline"
                          >
                            {row.name}
                          </Link>
                        </td>
                        <td className="px-6 py-5 text-slate-600">
                          {row.category}
                        </td>
                        <td className="px-6 py-5 text-right font-semibold">
                          {formatMoney(row.sellingPrice)}
                        </td>
                        <td className="px-6 py-5 text-right text-slate-600">
                          {row.directCost == null
                            ? "Not configured"
                            : formatMoney(row.directCost)}
                        </td>
                        <td className="px-6 py-5 text-right font-semibold">
                          {row.grossProfitPerUnit == null
                            ? "—"
                            : formatMoney(row.grossProfitPerUnit)}
                        </td>
                        <td className="px-6 py-5 text-right">
                          {row.grossMarginPerUnit == null
                            ? "—"
                            : `${row.grossMarginPerUnit.toFixed(1)}%`}
                        </td>
                        <td className="px-6 py-5 text-right text-slate-600">
                          {row.performedCount}
                        </td>
                        <td className="px-6 py-5 text-right font-semibold">
                          {formatMoney(row.revenue)}
                        </td>
                        {canManage && (
                          <td className="px-6 py-5 text-right">
                            <button
                              onClick={() => setConfiguring(row)}
                              className="text-sm font-medium text-eucalyptus hover:underline"
                            >
                              {row.directCost == null
                                ? "Configure"
                                : "Edit Cost"}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      <ConfigureCostModal
        open={configuring != null}
        treatment={configuring}
        currency={currency}
        onClose={() => setConfiguring(null)}
        onSaved={load}
      />
    </div>
  );
}

export default function TreatmentProfitabilityPage() {
  return (
    <PermissionGuard permission="treatment_profitability">
      <TreatmentProfitabilityPageContent />
    </PermissionGuard>
  );
}
