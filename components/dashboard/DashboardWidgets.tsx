"use client";

import RevenueWidget from "./RevenueWidget";
import QuickActions from "./QuickActions";
import RecentPatientsWidget from "./RecentPatientsWidget";
import TodaysAppointmentsWidget from "./TodaysAppointmentsWidget";

import { RevenueChartPoint } from "@/services/analytics/charts";

interface DashboardWidgetsProps {
  revenue: number;
  taxCollected: number | null;
  revenueChart: RevenueChartPoint[];
  currency: string;
  revenueLoading: boolean;
  revenueError: string | null;
}

export default function DashboardWidgets({
  revenue,
  taxCollected,
  revenueChart,
  currency,
  revenueLoading,
  revenueError,
}: DashboardWidgetsProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">

      <div className="space-y-6 xl:col-span-2">

        <RevenueWidget
          revenue={revenue}
          taxCollected={taxCollected}
          chartData={revenueChart}
          currency={currency}
          loading={revenueLoading}
          error={revenueError}
        />

        <TodaysAppointmentsWidget />

      </div>

      <div className="space-y-6">

        <RecentPatientsWidget />

        <QuickActions />

      </div>

    </div>
  );
}