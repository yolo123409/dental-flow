"use client";

import { useEffect, useState } from "react";
import { getPatientCount } from "@/services/patients";
import { getAppointmentCount } from "@/services/appointments";
import { getDentistCount } from "@/services/dentists";
import { getOrderCount } from "@/services/orders";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import DashboardStats from "@/components/dashboard/DashboardStats";
import Card from "@/components/ui/Card";
import QuickActions from "@/components/dashboard/QuickActions";
import RevenueChart from "@/components/dashboard/RevenueChart";
import TodaysSchedule from "@/components/dashboard/TodaysSchedule";
import RecentActivity from "@/components/dashboard/RecentActivity";
import KPISection from "@/components/dashboard/KPISection";

import PageContainer from "@/components/ui/PageContainer";

import WelcomeBanner from "@/components/dashboard/WelcomeBanner";
import DashboardWidgets from "@/components/dashboard/DashboardWidgets";

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    patients: 0,
    appointments: 0,
    dentists: 0,
    orders: 0,
  });

  async function loadStats() {
  const [
    patients,
    appointments,
    dentists,
    orders,
  ] = await Promise.all([
    getPatientCount(),
    getAppointmentCount(),
    getDentistCount(),
    getOrderCount(),
  ]);

  setStats({
    patients,
    appointments,
    dentists,
    orders,
  });
}

  return (
    <div className="space-y-8">

      <DashboardHeader />

      <KPISection />

      <QuickActions />

      <DashboardStats
        patients={stats.patients}
        appointments={stats.appointments}
        dentists={stats.dentists}
        orders={stats.orders}
      />

      <div className="grid gap-6 lg:grid-cols-2">

        <Card title="Revenue">
            <RevenueChart />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">

  <TodaysSchedule />

  <RecentActivity />

</div>

      </div>

    </div>
  );
}