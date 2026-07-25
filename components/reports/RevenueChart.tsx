"use client";

import { useMemo } from "react";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import Card from "@/components/ui/Card";

interface RevenueChartProps {
  data: {
    month: string;
    revenue: number;
    tax?: number;
  }[];
}

export default function RevenueChart({
  data,
}: RevenueChartProps) {
  const hasRevenue = useMemo(
    () => data.some((point) => point.revenue > 0),
    [data]
  );

  const hasTax = useMemo(
    () => data.some((point) => (point.tax ?? 0) > 0),
    [data]
  );

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">
          Monthly Revenue
        </h2>

        <p className="text-sm text-gray-500">
          Revenue trend over time.
        </p>
      </div>

      <div className="h-80">
        {hasRevenue ? (
          <ResponsiveContainer
            width="100%"
            height="100%"
          >
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />

              <XAxis dataKey="month" />

              <YAxis />

              <Tooltip />

              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#2563eb"
                strokeWidth={3}
              />

              {hasTax && (
                <Line
                  type="monotone"
                  dataKey="tax"
                  name="Tax"
                  stroke="#f59e0b"
                  strokeWidth={2}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-200 text-center">
            <p className="font-medium text-slate-500">
              No revenue yet for this period
            </p>

            <p className="text-sm text-slate-400">
              Paid invoices will appear here as soon as they come in.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}