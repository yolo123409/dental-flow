"use client";

import RevenueWidget from "./RevenueWidget";
import NetPositionWidget from "./NetPositionWidget";
import QuickActions from "./QuickActions";
import RecentPatientsWidget from "./RecentPatientsWidget";
import TodaysAppointmentsWidget from "./TodaysAppointmentsWidget";

import { RevenueChartPoint } from "@/services/analytics/charts";

interface DashboardWidgetsProps {
  revenue: number;
  taxCollected: number | null;
  breakEven: number | null;
  moneyOut: number;
  moneyOutLoading: boolean;
  moneyOutError: string | null;
  revenueChart: RevenueChartPoint[];
  currency: string;
  revenueLoading: boolean;
  revenueError: string | null;
}

export default function DashboardWidgets({
  revenue,
  taxCollected,
  breakEven,
  moneyOut,
  moneyOutLoading,
  moneyOutError,
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
          breakEven={breakEven}
          chartData={revenueChart}
          currency={currency}
          loading={revenueLoading}
          error={revenueError}
        />

        <NetPositionWidget
          revenue={revenue}
          moneyOut={moneyOut}
          breakEven={breakEven}
          currency={currency}
          loading={revenueLoading || moneyOutLoading}
          error={revenueError || moneyOutError}
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