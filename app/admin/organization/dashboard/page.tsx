"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, CalendarDays, UserRound, Users } from "lucide-react";

import CeoGuard from "@/components/auth/CeoGuard";
import useOrganization from "@/hooks/useOrganization";

import Card from "@/components/ui/Card";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";

import { getOrganizationOverview } from "@/services/organizations";
import { logError } from "@/lib/logError";

import { OrganizationOverview } from "@/types/organization";

const EMPTY_OVERVIEW: OrganizationOverview = {
  branch_count: 0,
  staff_count: 0,
  patients_total: 0,
  appointments_today_total: 0,
  branches: [],
};

function OrganizationDashboardContent() {
  const { organizationUser } = useOrganization();

  const [overview, setOverview] =
    useState<OrganizationOverview>(EMPTY_OVERVIEW);

  const [loading, setLoading] = useState(true);

  const loadOverview = useCallback(async () => {
    if (!organizationUser) return;

    try {
      setLoading(true);

      const data = await getOrganizationOverview(
        organizationUser.organization_id
      );

      setOverview(data);
    } catch (error) {
      logError(
        "[Organization dashboard] Failed to load overview:",
        error
      );

      toast.error("Unable to load the organization dashboard.");
    } finally {
      setLoading(false);
    }
  }, [organizationUser]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  if (loading) {
    return (
      <LoadingSpinner text="Loading organization dashboard..." />
    );
  }

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-4xl font-bold tracking-tight">
          Organization Dashboard
        </h1>

        <p className="mt-2 text-mineral">
          An operational overview across every branch. For a single
          branch&apos;s day-to-day view, switch into it from the sidebar.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-4">

        <StatCard
          title="Branches"
          value={overview.branch_count}
          subtitle="Across the organization"
          icon={<Building2 size={22} />}
        />

        <StatCard
          title="Staff"
          value={overview.staff_count}
          subtitle="People with branch access"
          icon={<Users size={22} />}
        />

        <StatCard
          title="Patients"
          value={overview.patients_total}
          subtitle="Registered across all branches"
          icon={<UserRound size={22} />}
        />

        <StatCard
          title="Today's Appointments"
          value={overview.appointments_today_total}
          subtitle="Across all branches"
          icon={<CalendarDays size={22} />}
        />

      </div>

      {overview.branches.length === 0 ? (
        <EmptyState
          title="No branches yet"
          description="Create your first branch to see it here."
        />
      ) : (
        <Card title="Branches">
          <div className="space-y-4">
            {overview.branches.map((branch) => (
              <div
                key={branch.clinic_id}
                className="flex flex-col gap-4 rounded-lg border border-sea-glass p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <h3 className="font-semibold text-graphite">
                  {branch.clinic_name}
                </h3>

                <div className="flex flex-wrap gap-6 text-sm text-mineral">
                  <span>
                    <span className="font-semibold text-graphite">
                      {branch.patients}
                    </span>{" "}
                    patients
                  </span>

                  <span>
                    <span className="font-semibold text-graphite">
                      {branch.appointments_today}
                    </span>{" "}
                    appointments today
                  </span>

                  <span>
                    <span className="font-semibold text-graphite">
                      {branch.staff}
                    </span>{" "}
                    staff
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  );
}

export default function OrganizationDashboardPage() {
  return (
    <CeoGuard>
      <OrganizationDashboardContent />
    </CeoGuard>
  );
}
