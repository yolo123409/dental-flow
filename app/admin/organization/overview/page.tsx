"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { DollarSign, AlertCircle, Users, CalendarDays } from "lucide-react";

import PageContainer from "@/components/ui/PageContainer";
import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

import DateRangeTabs from "@/components/organization/DateRangeTabs";
import OrganizationRevenueTrendChart from "@/components/organization/OrganizationRevenueTrendChart";
import BranchPerformanceTable from "@/components/organization/BranchPerformanceTable";
import AddBranchModal from "@/components/organization/AddBranchModal";

import { useAuth } from "@/contexts/AuthContext";

import {
  getMyOrganization,
  switchActiveBranch,
} from "@/services/organizations";

import {
  getOrganizationBranchPerformance,
  getOrganizationRevenueTrend,
  OrganizationBranchPerformance,
  OrganizationRevenueTrendPoint,
} from "@/services/organizationAnalytics";

import { Organization } from "@/types/organization";

// Branches within one organization are expected to share a currency in
// practice - full multi-currency aggregation across branches is out of
// scope for this dashboard, so a fixed default is used rather than
// fetching each branch's own clinic_settings.currency.
const DEFAULT_CURRENCY = "KES";

export default function OrganizationOverviewPage() {
  const { organizationUser } = useAuth();

  const [organization, setOrganization] =
    useState<Organization | null>(null);

  const [branches, setBranches] = useState<
    OrganizationBranchPerformance[]
  >([]);

  const [revenueTrend, setRevenueTrend] = useState<
    OrganizationRevenueTrendPoint[]
  >([]);

  const [range, setRange] = useState("This Month");

  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [addBranchOpen, setAddBranchOpen] = useState(false);

  const load = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setLoading(true);

      const [org, performance] = await Promise.all([
        getMyOrganization(organizationUser.organization_id),
        getOrganizationBranchPerformance(
          organizationUser.organization_id,
          range
        ),
      ]);

      setOrganization(org);
      setBranches(performance);
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load your organization."
      );
    } finally {
      setLoading(false);
    }
  }, [organizationUser, range]);

  const loadTrend = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setTrendLoading(true);
      setTrendError(null);

      const trend = await getOrganizationRevenueTrend(
        organizationUser.organization_id,
        range
      );

      setRevenueTrend(trend);
    } catch (error) {
      console.error(error);

      setTrendError(
        error instanceof Error
          ? error.message
          : "Failed to load revenue trend."
      );
    } finally {
      setTrendLoading(false);
    }
  }, [organizationUser, range]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadTrend();
  }, [loadTrend]);

  async function handleSwitch(clinicId: string) {
    try {
      setSwitchingId(clinicId);

      await switchActiveBranch(clinicId);

      // Every /admin page fetches its own clinic-scoped data once on
      // mount - only a full reload guarantees none of it is stale.
      window.location.href = "/admin";
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to switch into this branch."
      );

      setSwitchingId(null);
    }
  }

  if (!organizationUser) {
    return null;
  }

  if (loading) {
    return (
      <PageContainer>
        <LoadingSpinner text="Loading organization..." />
      </PageContainer>
    );
  }

  const totals = branches.reduce(
    (acc, branch) => ({
      revenue: acc.revenue + branch.revenue,
      outstanding: acc.outstanding + branch.outstanding_balance,
      patients: acc.patients + branch.patient_count,
      appointments: acc.appointments + branch.appointment_count,
    }),
    { revenue: 0, outstanding: 0, patients: 0, appointments: 0 }
  );

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <PageContainer>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">
            {organization?.name ?? "Organization"} Overview
          </h1>

          <p className="mt-2 text-mineral">
            {branches.length}{" "}
            {branches.length === 1 ? "branch" : "branches"}
          </p>
        </div>

        {organizationUser.role === "CEO" && (
          <Button onClick={() => setAddBranchOpen(true)}>
            + Add Branch
          </Button>
        )}
      </div>

      {branches.length === 0 ? (
        <Card title="Branches">
          <div className="space-y-4 py-8 text-center">
            <p className="text-sm text-mineral">
              {organizationUser.role === "CEO"
                ? "You haven't created a branch yet."
                : "Your organization has no branches yet."}
            </p>

            {organizationUser.role === "CEO" && (
              <Button onClick={() => setAddBranchOpen(true)}>
                Create Your First Branch
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <>
          <DateRangeTabs value={range} onChange={setRange} />

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Revenue"
              value={formatCurrency(totals.revenue)}
              icon={<DollarSign size={20} />}
            />

            <StatCard
              title="Outstanding"
              value={formatCurrency(totals.outstanding)}
              icon={<AlertCircle size={20} />}
            />

            <StatCard
              title="Patients"
              value={totals.patients}
              icon={<Users size={20} />}
            />

            <StatCard
              title="Appointments"
              value={totals.appointments}
              icon={<CalendarDays size={20} />}
            />
          </div>

          <OrganizationRevenueTrendChart
            data={revenueTrend}
            range={range}
            currency={DEFAULT_CURRENCY}
            loading={trendLoading}
            error={trendError}
          />

          <BranchPerformanceTable
            branches={branches}
            currency={DEFAULT_CURRENCY}
            canSwitch={organizationUser.role !== "Viewer"}
            switchingId={switchingId}
            onSwitch={handleSwitch}
          />
        </>
      )}

      {organizationUser.role === "CEO" && (
        <p className="text-sm text-mineral">
          Manage invitations and access from{" "}
          <Link
            href="/admin/organization/team"
            className="font-semibold text-eucalyptus hover:underline"
          >
            Team &amp; Access
          </Link>
          , or update your organization's details in{" "}
          <Link
            href="/admin/organization/settings"
            className="font-semibold text-eucalyptus hover:underline"
          >
            Organization Settings
          </Link>
          .
        </p>
      )}

      {organizationUser.role === "CEO" && (
        <AddBranchModal
          open={addBranchOpen}
          organizationUser={organizationUser}
          onClose={() => setAddBranchOpen(false)}
          onSuccess={load}
        />
      )}
    </PageContainer>
  );
}
