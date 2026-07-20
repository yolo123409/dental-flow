"use client";

import RevenueWidget from "./RevenueWidget";
import AIStatusCard from "./AIStatusCard";
import QuickActions from "./QuickActions";
import RecentPatientsWidget from "./RecentPatientsWidget";
import TodaysAppointmentsWidget from "./TodaysAppointmentsWidget";

import { RevenueChartPoint } from "@/services/analytics/charts";

interface DashboardWidgetsProps {
  revenue: number;
  revenueChart: RevenueChartPoint[];
  currency: string;
  revenueLoading: boolean;
  revenueError: string | null;
}

export default function DashboardWidgets({
  revenue,
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
          chartData={revenueChart}
          currency={currency}
          loading={revenueLoading}
          error={revenueError}
        />

        <TodaysAppointmentsWidget />

      </div>

      <div className="space-y-6">

        <AIStatusCard />

        <RecentPatientsWidget />

        <QuickActions />

      </div>

    </div>
  );
}