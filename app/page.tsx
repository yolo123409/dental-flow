"use client";

import { useEffect, useState } from "react";

import { getDashboardStats } from "@/services/dashboard";

import PageContainer from "@/components/ui/PageContainer";

import WelcomeBanner from "@/components/dashboard/WelcomeBanner";
import DashboardStats from "@/components/dashboard/DashboardStats";
import DashboardWidgets from "@/components/dashboard/DashboardWidgets";

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    patients: 0,
    appointments: 0,
    dentists: 0,
    orders: 0,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      setLoading(true);

      const data = await getDashboardStats();

      setStats(data);
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <div className="flex h-[70vh] items-center justify-center">
          <p className="text-lg text-slate-500">
            Loading dashboard...
          </p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>

      <WelcomeBanner />

      <DashboardStats
        patients={stats.patients}
        appointments={stats.appointments}
        dentists={stats.dentists}
        orders={stats.orders}
      />

      <DashboardWidgets />

    </PageContainer>
  );
}