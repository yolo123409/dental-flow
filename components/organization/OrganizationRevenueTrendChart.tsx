"use client";

import { useMemo } from "react";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  XAxis,
  Tooltip,
  Legend,
} from "recharts";

import Card from "@/components/ui/Card";

import { granularityFor } from "@/services/analytics/charts";
import {
  OrganizationRevenueTrendPoint,
  OrganizationExpenseTrendPoint,
} from "@/services/organizationAnalytics";

interface Props {
  data: OrganizationRevenueTrendPoint[];
  expenseData?: OrganizationExpenseTrendPoint[];
  range: string;
  currency: string;
  loading: boolean;
  error: string | null;
}

function bucketLabel(bucket: string, range: string): string {
  const date = new Date(bucket);
  const granularity = granularityFor(range);

  if (granularity === "hour") {
    return date.toLocaleTimeString(undefined, { hour: "numeric" });
  }

  if (granularity === "day") {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

export default function OrganizationRevenueTrendChart({
  data,
  expenseData = [],
  range,
  currency,
  loading,
  error,
}: Props) {
  // Merged by bucket key (not by array index) since revenue and expense
  // buckets can differ - a period with revenue but no expenses (or vice
  // versa) shouldn't drop a point or misalign the two series.
  const chartData = useMemo(() => {
    const expenseByBucket = new Map(
      expenseData.map((point) => [point.bucket, point.total])
    );

    const buckets = new Set([
      ...data.map((point) => point.bucket),
      ...expenseData.map((point) => point.bucket),
    ]);

    return Array.from(buckets)
      .sort()
      .map((bucket) => {
        const revenue =
          data.find((point) => point.bucket === bucket)?.revenue ?? 0;
        const moneyOut = expenseByBucket.get(bucket) ?? 0;

        return {
          bucket,
          label: bucketLabel(bucket, range),
          revenue,
          moneyOut,
          netPosition: revenue - moneyOut,
        };
      });
  }, [data, expenseData, range]);

  const hasRevenue = useMemo(
    () => chartData.some((point) => point.revenue > 0 || point.moneyOut > 0),
    [chartData]
  );

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <Card title="Organization Financial Trend">
      <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-sea-glass">
        {loading ? (
          <p className="text-mineral">Loading financial trend...</p>
        ) : error ? (
          <p className="text-red-500">Unable to load financial trend.</p>
        ) : !hasRevenue ? (
          <p className="text-mineral">
            No revenue or expenses yet for this date range.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient
                  id="organizationRevenue"
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

              <XAxis dataKey="label" tick={{ fontSize: 12 }} />

              <Tooltip
                formatter={(value) => formatCurrency(Number(value))}
              />

              <Legend />

              <Area
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#216C68"
                fill="url(#organizationRevenue)"
                strokeWidth={2}
              />

              <Line
                type="monotone"
                dataKey="moneyOut"
                name="Money Out"
                stroke="#B45309"
                strokeWidth={2}
                dot={false}
              />

              <Line
                type="monotone"
                dataKey="netPosition"
                name="Net Position"
                stroke="#1D4ED8"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
