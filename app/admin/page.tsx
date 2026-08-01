"use client";

import { useCallback, useEffect, useState } from "react";

import { getDashboardStats } from "@/services/dashboard";
import { getRevenueAnalytics } from "@/services/analytics/revenue";
import {
  getRevenueChartData,
  RevenueChartPoint,
} from "@/services/analytics/charts";
import { getClinicSettings } from "@/services/settings";
import useRealtimeDashboard from "@/hooks/useRealtimeDashboard";
import { logError } from "@/lib/logError";

import PageContainer from "@/components/ui/PageContainer";

import WelcomeBanner from "@/components/dashboard/WelcomeBanner";
import DashboardStats from "@/components/dashboard/DashboardStats";
import DashboardWidgets from "@/components/dashboard/DashboardWidgets";

interface DashboardState {
  patients: number;
  appointments: number;
  dentists: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardState>({
    patients: 0,
    appointments: 0,
    dentists: 0,
  });

  const [revenue, setRevenue] = useState(0);

  const [taxCollected, setTaxCollected] = useState<
    number | null
  >(null);

  const [revenueChart, setRevenueChart] = useState<
    RevenueChartPoint[]
  >([]);

  const [currency, setCurrency] = useState("KES");

  const [clinicName, setClinicName] = useState<
    string | undefined
  >(undefined);

  const [loading, setLoading] = useState(true);
  const [revenueLoading, setRevenueLoading] = useState(true);

  const [revenueError, setRevenueError] = useState<
    string | null
  >(null);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);

      const dashboardStats = await getDashboardStats();

      setStats(dashboardStats);
    } catch (error) {
      logError("[dashboard page] Failed to load dashboard:", error);
    } finally {
      setLoading(false);
    }

    // Same shared revenue source the Analytics page uses
    // (services/analytics/revenue.ts + services/analytics/charts.ts) -
    // isolated in its own try/catch so a revenue-source failure doesn't
    // take down the rest of the dashboard.
    try {
      setRevenueLoading(true);
      setRevenueError(null);

      const [
        monthRevenue,
        chartData,
        clinicSettings,
      ] = await Promise.all([
        getRevenueAnalytics("This Month"),
        getRevenueChartData("30 Days"),
        getClinicSettings(),
      ]);

      setRevenue(monthRevenue.totalRevenue);
      setRevenueChart(chartData);
      setCurrency(clinicSettings.currency || "KES");
      setClinicName(clinicSettings.clinic_name);

      setTaxCollected(
        clinicSettings.tax_enabled
          ? monthRevenue.totalTaxCollected
          : null
      );
    } catch (error) {
      logError(
        "[dashboard page] Failed to load revenue widget:",
        error
      );

      setRevenueError(
        error instanceof Error
          ? error.message
          : "Failed to load revenue."
      );
    } finally {
      setRevenueLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Automatically refresh when dashboard data changes - already covers
  // clinic_invoices/clinic_payments, so the revenue widget rides this
  // same subscription instead of opening a second one.
  useRealtimeDashboard(loadDashboard);

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
      <WelcomeBanner clinicName={clinicName} />

      <DashboardStats
        patients={stats.patients}
        appointments={stats.appointments}
        dentists={stats.dentists}
      />

      <DashboardWidgets
        revenue={revenue}
        taxCollected={taxCollected}
        revenueChart={revenueChart}
        currency={currency}
        revenueLoading={revenueLoading}
        revenueError={revenueError}
      />
    </PageContainer>
  );
}