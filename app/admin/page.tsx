"use client";

import { useCallback, useEffect, useState } from "react";

import { getDashboardStats } from "@/services/dashboard";
import { getRevenueAnalytics } from "@/services/analytics/revenue";
import {
  getRevenueChartData,
  RevenueChartPoint,
} from "@/services/analytics/charts";
import { getClinicSettings } from "@/services/settings";
import { getExpenseSummary } from "@/services/expenses";
import useRealtimeDashboard from "@/hooks/useRealtimeDashboard";
import usePermissions from "@/hooks/usePermissions";
import { getSafeErrorMessage, logError } from "@/lib/logError";

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
  const { hasPermission } = usePermissions();
  const canViewFinancials = hasPermission("analytics");

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

  // Break-even revenue for the period = Total Costs Incurred for that same
  // period (services/expenses.ts#getExpenseSummary, the same figure the
  // Money Out widget shows) - the revenue level at which Total Revenue -
  // Total Costs Incurred = 0. Set alongside `moneyOut` below, never from a
  // manually entered setting. NULL = Total Costs Incurred could not be
  // determined for this period.
  const [breakEven, setBreakEven] = useState<number | null>(null);

  const [moneyOut, setMoneyOut] = useState(0);
  const [moneyOutLoading, setMoneyOutLoading] = useState(true);
  const [moneyOutError, setMoneyOutError] = useState<string | null>(null);

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

    // clinicName/currency are needed for the welcome banner regardless
    // of role, so this is always fetched - only the financial figures
    // below are permission-gated. taxEnabled is read from this local
    // variable (not the taxEnabled state) below in the same function
    // call, since the setTaxEnabled state update wouldn't be visible
    // yet within this same invocation.
    let taxEnabledForThisLoad = false;

    try {
      const clinicSettings = await getClinicSettings();

      taxEnabledForThisLoad = Boolean(clinicSettings.tax_enabled);

      setCurrency(clinicSettings.currency || "KES");
      setClinicName(clinicSettings.clinic_name);
    } catch (error) {
      logError(
        "[dashboard page] Failed to load clinic settings:",
        error
      );
    }

    // Revenue/expense figures are analytics-tier data - a role without
    // the `analytics` permission (Dentist, Receptionist) sees none of
    // this on the dashboard either, matching that they don't see the
    // Analytics/Reports/Visit Analytics sidebar links.
    if (!canViewFinancials) {
      setRevenueLoading(false);
      setMoneyOutLoading(false);
      return;
    }

    // Same shared revenue source the Analytics page uses
    // (services/analytics/revenue.ts + services/analytics/charts.ts) -
    // isolated in its own try/catch so a revenue-source failure doesn't
    // take down the rest of the dashboard.
    try {
      setRevenueLoading(true);
      setRevenueError(null);

      const [monthRevenue, chartData] = await Promise.all([
        getRevenueAnalytics("This Month"),
        getRevenueChartData("30 Days"),
      ]);

      setRevenue(monthRevenue.totalRevenue);
      setRevenueChart(chartData);

      setTaxCollected(
        taxEnabledForThisLoad ? monthRevenue.totalTaxCollected : null
      );
    } catch (error) {
      logError(
        "[dashboard page] Failed to load revenue widget:",
        error
      );

      setRevenueError(
        getSafeErrorMessage(error, "Failed to load revenue.")
      );
    } finally {
      setRevenueLoading(false);
    }

    // Isolated in its own try/catch, matching the revenue block above -
    // a Money Out failure shouldn't take down the rest of the dashboard.
    try {
      setMoneyOutLoading(true);
      setMoneyOutError(null);

      const summary = await getExpenseSummary("This Month");

      setMoneyOut(summary.total);
      // Break-even revenue for the period = Total Costs Incurred for the
      // period - see the `breakEven` state doc above.
      setBreakEven(summary.total);
    } catch (error) {
      logError(
        "[dashboard page] Failed to load Money Out widget:",
        error
      );

      setBreakEven(null);

      setMoneyOutError(
        getSafeErrorMessage(error, "Failed to load Money Out.")
      );
    } finally {
      setMoneyOutLoading(false);
    }
  }, [canViewFinancials]);

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

      {canViewFinancials && (
        <DashboardWidgets
          revenue={revenue}
          taxCollected={taxCollected}
          breakEven={breakEven}
          moneyOut={moneyOut}
          moneyOutLoading={moneyOutLoading}
          moneyOutError={moneyOutError}
          revenueChart={revenueChart}
          currency={currency}
          revenueLoading={revenueLoading}
          revenueError={revenueError}
        />
      )}
    </PageContainer>
  );
}