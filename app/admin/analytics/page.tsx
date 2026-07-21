"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getDashboardAnalytics,
} from "@/services/analytics";

import {
  getDashboardStats,
} from "@/services/dashboard";

import { getClinicSettings } from "@/services/settings";

import useRealtimeTables from "@/hooks/useRealtimeTables";

import PageContainer from "@/components/ui/PageContainer";

import ReportsHeader from "@/components/reports/ReportsHeader";
import ReportStatCard from "@/components/reports/ReportStatCard";
import RevenueChart from "@/components/reports/RevenueChart";
import AppointmentStatusChart from "@/components/reports/AppointmentStatusChart";

import {
  DashboardAnalytics,
} from "@/services/analytics/types";

interface DashboardTotals {
  patients: number;
  appointments: number;
  dentists: number;
}

export default function AnalyticsPage() {
  const [range, setRange] =
    useState("All Time");

  const [analytics, setAnalytics] =
    useState<DashboardAnalytics | null>(
      null
    );

  const [stats, setStats] =
    useState<DashboardTotals | null>(
      null
    );

  const [currency, setCurrency] =
    useState("KES");

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const realtimeTables = useMemo(
    () => [
      "patients",
      "appointments",
      "treatments",
      "clinic_invoices",
      "clinic_payments",
    ],
    []
  );

  const loadAnalytics =
    useCallback(async () => {
      try {
        setLoading(true);
        setError(null);

        const [
          analyticsData,
          dashboardStats,
          clinicSettings,
        ] = await Promise.all([
          getDashboardAnalytics(range),
          getDashboardStats(),
          getClinicSettings(),
        ]);

        setAnalytics(
          analyticsData
        );

        setStats(dashboardStats);

        setCurrency(
          clinicSettings.currency || "KES"
        );
      } catch (err) {
        console.error(
          "Analytics Error:",
          err
        );

        setError(
          err instanceof Error
            ? err.message
            : "Failed to load analytics."
        );
      } finally {
        setLoading(false);
      }
    }, [range]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  useRealtimeTables({
    tables: realtimeTables,
    reload: loadAnalytics,
  });

  if (error && !analytics) {
    return (
      <PageContainer>
        <div className="flex h-[70vh] flex-col items-center justify-center gap-2">
          <p className="text-lg font-semibold text-red-600">
            Couldn&apos;t load analytics
          </p>

          <p className="text-sm text-slate-500">
            {error}
          </p>
        </div>
      </PageContainer>
    );
  }

  if (
    loading ||
    !analytics ||
    !stats
  ) {
    return (
      <PageContainer>
        <div className="flex h-[70vh] items-center justify-center">
          <p className="text-lg text-slate-500">
            Loading analytics...
          </p>
        </div>
      </PageContainer>
    );
  }

  const formattedRevenue = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(analytics.revenue.totalRevenue);

  return (
    <PageContainer>
      <ReportsHeader
        selectedRange={range}
        onRangeChange={setRange}
      />

      <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">

        <ReportStatCard
          title="Revenue"
          value={formattedRevenue}
          subtitle={`${analytics.revenue.paidInvoices} paid invoices`}
        />

        <ReportStatCard
          title="Patients"
          value={stats.patients}
          subtitle={`${analytics.patients.newPatientsThisMonth} new patients`}
        />

        <ReportStatCard
          title="Appointments"
          value={stats.appointments}
          subtitle={`${analytics.appointments.completed} completed`}
        />

        <ReportStatCard
          title="Treatments"
          value={
            analytics.treatments
              .totalTreatments
          }
          subtitle={`${analytics.treatments.completedTreatments} completed`}
        />

      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">

        <RevenueChart
          data={
            analytics.revenueChart
          }
        />

        <AppointmentStatusChart
          data={
            analytics.appointmentChart
          }
        />

      </div>
    </PageContainer>
  );
}