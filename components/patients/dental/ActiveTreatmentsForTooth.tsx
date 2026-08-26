"use client";

import { useEffect, useState } from "react";

import { ItemStatusBadge } from "@/components/patients/treatment-plans/TreatmentPlanBadges";

import { getTreatmentsForTooth } from "@/services/treatmentTeeth";
import { getItemTeeth } from "@/services/treatmentPlans";

import { TreatmentPlanItem } from "@/types/treatmentPlan";

interface Props {
  patientId: string;
  tooth: number;
  currency: string;
}

/**
 * Phase E (sections 11-13): "what is happening to this tooth" surfaced
 * directly in Tooth Details, via the reverse lookup Phase A built and
 * Phase D corrected (getTreatmentsForTooth - treatment_teeth-first, with
 * a legacy tooth_number fallback). Critically, a grouped Treatment (e.g.
 * "Composite Restoration" on 16, 17, 18) is the SAME record wherever it's
 * looked up from - opening tooth 16, 17, or 18 here all show the identical
 * item with its full teeth badge, never three separate-looking entries.
 *
 * Read-only by design (section 15: this is not where a Treatment is
 * edited - that's still the Treatment Plan / TreatmentItemModal).
 */
export default function ActiveTreatmentsForTooth({
  patientId,
  tooth,
  currency,
}: Props) {
  const [items, setItems] = useState<TreatmentPlanItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    setItems(null);

    (async () => {
      try {
        const rows = await getTreatmentsForTooth(patientId, tooth);

        if (!cancelled) {
          setItems(rows.filter((item) => item.status !== "Cancelled"));
        }
      } catch (error) {
        console.error("Failed to load active treatments for tooth:", error);

        if (!cancelled) setItems([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId, tooth]);

  // While loading, render nothing rather than flashing the empty state
  // and then replacing it - loads are typically near-instant locally.
  if (!items) return null;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <div className="space-y-2 rounded-2xl border border-sea-glass bg-enamel p-4">
      <h3 className="font-display text-xs font-bold uppercase tracking-wide text-mineral">
        Active Treatment Plan
      </h3>

      {items.length === 0 ? (
        <p className="text-sm text-mineral">
          No Treatments are associated with this tooth.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const teeth = getItemTeeth(item);

            const teethLabel =
              teeth.length === 0
                ? "No tooth association"
                : teeth.length === 1
                  ? `Tooth ${teeth[0]}`
                  : `Teeth ${teeth.join(" · ")}`;

            return (
              <div
                key={item.id}
                className="rounded-xl bg-porcelain p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-graphite">
                    {item.procedure}
                  </p>

                  <ItemStatusBadge status={item.status} />
                </div>

                <p className="mt-1 text-xs text-mineral">{teethLabel}</p>

                <p className="mt-1 text-sm font-semibold text-deep-eucalyptus">
                  {formatCurrency(
                    Number(item.estimated_price) * item.quantity
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
