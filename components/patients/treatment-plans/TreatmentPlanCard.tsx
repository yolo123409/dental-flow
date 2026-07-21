"use client";

import { useMemo } from "react";

import { PlanStatusBadge } from "./TreatmentPlanBadges";

import { calculatePlanTotals } from "@/services/treatmentPlans";

import { TreatmentPlanWithItems } from "@/types/treatmentPlan";

interface Props {
  plan: TreatmentPlanWithItems;
  currency: string;
  onClick: () => void;
}

export default function TreatmentPlanCard({
  plan,
  currency,
  onClick,
}: Props) {
  const totals = useMemo(
    () => calculatePlanTotals(plan.treatment_plan_items),
    [plan.treatment_plan_items]
  );

  const formattedCost = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(totals.totalEstimated);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900">
              {plan.title}
            </h3>

            <PlanStatusBadge status={plan.status} />
          </div>

          <p className="mt-1 text-sm text-slate-500">
            {totals.procedureCount} procedure
            {totals.procedureCount === 1 ? "" : "s"} ·{" "}
            {new Date(
              plan.created_at
            ).toLocaleDateString()}
          </p>
        </div>

        <p className="text-lg font-bold text-slate-900">
          {formattedCost}
        </p>
      </div>

      <div className="mt-4">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600"
            style={{ width: `${totals.progress}%` }}
          />
        </div>

        <p className="mt-1.5 text-xs text-slate-400">
          {totals.completedCount} of{" "}
          {totals.procedureCount} completed
        </p>
      </div>
    </button>
  );
}
