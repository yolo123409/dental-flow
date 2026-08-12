"use client";

import { useMemo } from "react";

import Card from "@/components/ui/Card";

import { OrganizationBranchPerformance } from "@/services/organizationAnalytics";

interface Props {
  branches: OrganizationBranchPerformance[];
  loading: boolean;
}

export default function OrganizationPatientAnalytics({
  branches,
  loading,
}: Props) {
  const totals = useMemo(
    () =>
      branches.reduce(
        (acc, branch) => ({
          total: acc.total + branch.patient_count,
          new: acc.new + branch.new_patient_count,
        }),
        { total: 0, new: 0 }
      ),
    [branches]
  );

  const returning = Math.max(0, totals.total - totals.new);

  const fastestGrowing = branches.reduce<OrganizationBranchPerformance | null>(
    (fastest, branch) => {
      if (branch.new_patient_count <= 0) return fastest;
      if (!fastest || branch.new_patient_count > fastest.new_patient_count) {
        return branch;
      }
      return fastest;
    },
    null
  );

  const byBranch = [...branches].sort(
    (a, b) => b.patient_count - a.patient_count
  );

  if (loading) {
    return (
      <Card title="Patient Analytics">
        <p className="text-sm text-mineral">Loading...</p>
      </Card>
    );
  }

  return (
    <Card title="Patient Analytics">
      <div className="grid gap-6 sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Total Patients
          </p>
          <p className="mt-1 text-2xl font-bold text-graphite">
            {totals.total}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            New
          </p>
          <p className="mt-1 text-2xl font-bold text-graphite">
            {totals.new}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Returning
          </p>
          <p className="mt-1 text-2xl font-bold text-graphite">
            {returning}
          </p>
        </div>
      </div>

      {fastestGrowing && (
        <p className="mt-4 text-sm text-mineral">
          Fastest growing branch:{" "}
          <span className="font-semibold text-graphite">
            {fastestGrowing.clinic_name}
          </span>{" "}
          (+{fastestGrowing.new_patient_count} new)
        </p>
      )}

      {byBranch.length > 0 && (
        <div className="mt-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
            Patients by Branch
          </p>

          {byBranch.map((branch) => (
            <div
              key={branch.clinic_id}
              className="flex items-center justify-between rounded-lg border border-sea-glass px-3 py-2 text-sm"
            >
              <span className="text-graphite">{branch.clinic_name}</span>
              <span className="font-semibold text-graphite">
                {branch.patient_count}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
