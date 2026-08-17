"use client";

import { useMemo } from "react";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
} from "recharts";

import Card from "@/components/ui/Card";

import { roundMoney } from "@/lib/currency";

import { RevenueChartPoint } from "@/services/analytics/charts";

interface RevenueWidgetProps {
  revenue: number;
  taxCollected: number | null;
  // Break-even revenue for the selected period - the revenue level at
  // which Total Revenue - Total Costs Incurred = 0, which is simply the
  // period's Total Costs Incurred itself (see app/admin/page.tsx, sourced
  // from services/expenses.ts#getExpenseSummary - the same figure the
  // Money Out widget shows, never a separately fabricated number). NULL =
  // Total Costs Incurred could not be determined for this period (e.g.
  // failed to load) - never treated as 0.
  breakEven: number | null;
  // Whether the Total Costs Incurred figure above is still loading - kept
  // distinct from `loading`/`error` (which describe revenue only) so the
  // break-even section doesn't flash "Not available" before its own data
  // source has actually finished loading.
  costsLoading: boolean;
  chartData: RevenueChartPoint[];
  currency: string;
  loading: boolean;
  error: string | null;
}

export default function RevenueWidget({
  revenue,
  taxCollected,
  breakEven,
  costsLoading,
  chartData,
  currency,
  loading,
  error,
}: RevenueWidgetProps) {
  const formattedRevenue = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(revenue),
    [revenue, currency]
  );

  const formattedTax = useMemo(
    () =>
      taxCollected == null
        ? null
        : new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            maximumFractionDigits: 0,
          }).format(taxCollected),
    [taxCollected, currency]
  );

  const hasRevenue = useMemo(
    () => chartData.some((point) => point.revenue > 0),
    [chartData]
  );

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  // Break-even = the revenue level at which Total Revenue - Total Costs
  // Incurred = 0, i.e. `breakEven` itself (already equal to Total Costs
  // Incurred - see the prop doc above). Rounded to whole cents before
  // comparing so accumulated float drift from summing many invoice/expense
  // rows can never flip an exact "at break-even" match into a spurious
  // below/above result.
  const breakEvenStatus = useMemo(() => {
    if (breakEven == null) return null;

    const roundedRevenue = roundMoney(revenue);
    const totalCosts = roundMoney(breakEven);
    const diff = roundMoney(roundedRevenue - totalCosts);

    const progress =
      totalCosts > 0
        ? Math.min(100, (roundedRevenue / totalCosts) * 100)
        : roundedRevenue > 0
        ? 100
        : 0;

    if (diff < 0) {
      return {
        kind: "below" as const,
        label: `Below Break-even by ${formatMoney(Math.abs(diff))}`,
        totalCosts,
        diff,
        progress,
      };
    }

    if (diff === 0) {
      return {
        kind: "even" as const,
        label: "Break-even",
        totalCosts,
        diff,
        progress,
      };
    }

    return {
      kind: "above" as const,
      label: `Above Break-even by ${formatMoney(diff)}`,
      totalCosts,
      diff,
      progress,
    };
    // formatMoney is a plain closure recreated each render off of
    // `currency`, not stable state - included via its own dependency
    // instead to avoid recalculating on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenue, breakEven, currency]);

  const statusColorClasses = {
    below: "text-amber-600",
    even: "text-slate-600",
    above: "text-eucalyptus",
  } as const;

  const progressBarColorClasses = {
    below: "bg-amber-500",
    even: "bg-slate-400",
    above: "bg-eucalyptus",
  } as const;

  return (
    <Card title="Revenue">

      <div className="space-y-6">

        <div>

          <p className="text-sm text-slate-500">
            This Month
          </p>

          <h2 className="mt-2 text-4xl font-bold">
            {loading
              ? "..."
              : error
              ? "—"
              : formattedRevenue}
          </h2>

          {!loading && !error && formattedTax && (
            <p className="mt-1 text-sm text-slate-500">
              Tax Collected: {formattedTax}
            </p>
          )}

          {!loading && !error && costsLoading && (
            <p className="mt-3 text-sm text-slate-500">
              Calculating break-even...
            </p>
          )}

          {!loading && !error && !costsLoading && breakEvenStatus && (
            <div className="mt-3">
              <p
                className={`text-sm font-semibold ${statusColorClasses[breakEvenStatus.kind]}`}
              >
                {breakEvenStatus.label}
              </p>

              <p className="mt-0.5 text-xs text-slate-500">
                Total Costs Incurred: {formatMoney(breakEvenStatus.totalCosts)}
              </p>

              <p className="mt-0.5 text-xs text-slate-500">
                Net Difference: {breakEvenStatus.diff > 0 ? "+" : breakEvenStatus.diff < 0 ? "-" : ""}
                {formatMoney(Math.abs(breakEvenStatus.diff))}
              </p>

              <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${progressBarColorClasses[breakEvenStatus.kind]}`}
                  style={{ width: `${breakEvenStatus.progress}%` }}
                />
              </div>
            </div>
          )}

          {!loading && !error && !costsLoading && !breakEvenStatus && (
            <p className="mt-3 text-sm text-slate-500">
              Break-even: Not available
            </p>
          )}

        </div>

        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed">

          {loading ? (
            <p className="text-slate-500">
              Loading revenue...
            </p>
          ) : error ? (
            <p className="text-red-500">
              Unable to load revenue.
            </p>
          ) : !hasRevenue ? (
            <p className="text-slate-500">
              No revenue yet in the last 30 days.
            </p>
          ) : (
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient
                    id="dashboardRevenue"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="#216C68"
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="95%"
                      stopColor="#216C68"
                      stopOpacity={0.05}
                    />
                  </linearGradient>
                </defs>

                <Tooltip />

                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#216C68"
                  fill="url(#dashboardRevenue)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}

        </div>

      </div>

    </Card>
  );
}
