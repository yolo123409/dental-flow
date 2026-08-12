"use client";

import { useMemo } from "react";

import Card from "@/components/ui/Card";

import { OrganizationAppointmentBreakdown } from "@/services/organizationAnalytics";

interface Props {
  breakdown: OrganizationAppointmentBreakdown[];
  loading: boolean;
  error: string | null;
}

export default function OrganizationAppointmentAnalytics({
  breakdown,
  loading,
  error,
}: Props) {
  const totals = useMemo(
    () =>
      breakdown.reduce(
        (acc, branch) => ({
          today: acc.today + branch.today_count,
          upcoming: acc.upcoming + branch.upcoming_count,
          completed: acc.completed + branch.completed_count,
          cancelled: acc.cancelled + branch.cancelled_count,
        }),
        { today: 0, upcoming: 0, completed: 0, cancelled: 0 }
      ),
    [breakdown]
  );

  if (loading) {
    return (
      <Card title="Appointment Analytics">
        <p className="text-sm text-mineral">Loading...</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Appointment Analytics">
        <p className="text-sm text-red-500">
          Unable to load appointment analytics.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Appointment Analytics">
      <div className="grid gap-6 sm:grid-cols-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Today
          </p>
          <p className="mt-1 text-2xl font-bold text-graphite">
            {totals.today}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Upcoming
          </p>
          <p className="mt-1 text-2xl font-bold text-graphite">
            {totals.upcoming}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Completed
          </p>
          <p className="mt-1 text-2xl font-bold text-graphite">
            {totals.completed}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Cancelled
          </p>
          <p className="mt-1 text-2xl font-bold text-graphite">
            {totals.cancelled}
          </p>
        </div>
      </div>

      {breakdown.length > 0 && (
        <div className="mt-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            By Branch
          </p>

          {breakdown.map((branch) => (
            <div
              key={branch.clinic_id}
              className="flex items-center justify-between rounded-lg border border-sea-glass px-3 py-2 text-sm"
            >
              <span className="text-graphite">{branch.clinic_name}</span>
              <span className="text-mineral">
                {branch.today_count} today · {branch.upcoming_count} upcoming ·{" "}
                {branch.completed_count} completed ·{" "}
                {branch.cancelled_count} cancelled
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
