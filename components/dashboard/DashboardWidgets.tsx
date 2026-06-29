"use client";

import RevenueWidget from "./RevenueWidget";
import AIStatusCard from "./AIStatusCard";
import QuickActions from "./QuickActions";
import RecentPatientsWidget from "./RecentPatientsWidget";
import TodaysAppointmentsWidget from "./TodaysAppointmentsWidget";

export default function DashboardWidgets() {
  return (
    <div className="grid gap-6 xl:grid-cols-3">

      <div className="space-y-6 xl:col-span-2">

        <RevenueWidget />

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