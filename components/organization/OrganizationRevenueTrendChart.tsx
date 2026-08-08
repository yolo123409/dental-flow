"use client";

import { useMemo } from "react";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
} from "recharts";

import Card from "@/components/ui/Card";

import { granularityFor } from "@/services/analytics/charts";
import { OrganizationRevenueTrendPoint } from "@/services/organizationAnalytics";

interface Props {
  data: OrganizationRevenueTrendPoint[];
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
  range,
  currency,
  loading,
  error,
}: Props) {
  const chartData = useMemo(
    () =>
      data.map((point) => ({
        label: bucketLabel(point.bucket, range),
        revenue: point.revenue,
      })),
    [data, range]
  );

  const hasRevenue = useMemo(
    () => chartData.some((point) => point.revenue > 0),
    [chartData]
  );

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <Card title="Organization Revenue Trend">
      <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-sea-glass">
        {loading ? (
          <p className="text-mineral">Loading revenue trend...</p>
        ) : error ? (
          <p className="text-red-500">Unable to load revenue trend.</p>
        ) : !hasRevenue ? (
          <p className="text-mineral">
            No revenue yet for this date range.
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

              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#216C68"
                fill="url(#organizationRevenue)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
