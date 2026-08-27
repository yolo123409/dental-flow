"use client";

import { useCallback, useEffect, useState } from "react";

import { getDashboardStats } from "@/services/dashboard";
import { getRevenueAnalytics } from "@/services/analytics/revenue";
import { getDateRange } from "@/services/analytics/dateRange";
import {
  getRevenueChartData,
  RevenueChartPoint,
} from "@/services/analytics/charts";
import { getClinicSettings } from "@/services/settings";
import { getProfitAndLoss } from "@/services/ledger";
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
  // period (services/ledger.ts#getProfitAndLoss's totalOperatingExpenses,
  // the same figure the Money Out widget shows) - the revenue level at
  // which Total Revenue - Total Costs Incurred = 0. Set alongside
  // `moneyOut` below, never from a manually entered setting. NULL = Total
  // Costs Incurred could not be determined for this period.
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

    // FIN-3.2: "This Month" bounds for the canonical ledger P&L
    // (services/ledger.ts#getProfitAndLoss) - the same accrual figures the
    // Ledger Dashboard, Financial Overview, Reports Center P&L, Monthly
    // Comparison, Financial Ratios, and CEO Consolidated Financials all
    // already read (see those files' own FIN-1/FIN-1.5 comments). The
    // Dashboard was the one remaining page still computing its own
    // Paid-invoices/clinic_expenses total instead of reading the ledger -
    // fixed here so "Revenue" and "Money Out" can never disagree with what
    // the Ledger P&L page reports for the same period.
    const { start: rangeStart, end: rangeEnd } = getDateRange("This Month");

    // getDateRange("This Month") always returns concrete Dates (only an
    // unrecognized range string falls through to null/null) - these
    // fallbacks exist only to satisfy getProfitAndLoss's non-nullable
    // signature, matching the same defensive pattern
    // services/reports/shared.ts#getPeriodFinancials already uses.
    const monthStart = rangeStart ?? new Date(0);
    const monthEnd = rangeEnd ?? new Date();

    // Isolated in its own try/catch so a revenue-source failure doesn't
    // take down the rest of the dashboard. Tax Collected intentionally
    // stays on getRevenueAnalytics's existing Paid-invoices basis (the same
    // basis Financial Overview's own vatCollected figure uses) - this fix
    // is scoped to the competing Revenue/Expense calculation, not to
    // introducing a new VAT accrual figure on the Dashboard.
    try {
      setRevenueLoading(true);
      setRevenueError(null);

      const [profitAndLoss, monthRevenue, chartData] = await Promise.all([
        getProfitAndLoss(monthStart, monthEnd),
        getRevenueAnalytics("This Month"),
        getRevenueChartData("30 Days"),
      ]);

      setRevenue(profitAndLoss.revenue.total);
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

    // Isolated in its own try/catch, matching the revenue block above - a
    // Money Out failure shouldn't take down the rest of the dashboard. This
    // duplicates the getProfitAndLoss() call made above rather than sharing
    // it across both blocks, trading one extra RPC round trip for keeping
    // the two widgets' failure domains genuinely independent, exactly as
    // they were before this fix.
    try {
      setMoneyOutLoading(true);
      setMoneyOutError(null);

      const profitAndLoss = await getProfitAndLoss(monthStart, monthEnd);

      setMoneyOut(profitAndLoss.totalOperatingExpenses);
      // Break-even revenue for the period = Total Costs Incurred for the
      // period - see the `breakEven` state doc above.
      setBreakEven(profitAndLoss.totalOperatingExpenses);
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