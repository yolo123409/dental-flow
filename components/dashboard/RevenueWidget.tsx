"use client";

import { useMemo } from "react";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
} from "recharts";

import Card from "@/components/ui/Card";

import { RevenueChartPoint } from "@/services/analytics/charts";

interface RevenueWidgetProps {
  revenue: number;
  taxCollected: number | null;
  chartData: RevenueChartPoint[];
  currency: string;
  loading: boolean;
  error: string | null;
}

export default function RevenueWidget({
  revenue,
  taxCollected,
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
