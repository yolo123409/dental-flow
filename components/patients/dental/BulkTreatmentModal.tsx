"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  TreatmentItemPriority,
  TreatmentItemStatus,
  TreatmentPlanWithItems,
} from "@/types/treatmentPlan";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import TreatmentSelect from "@/components/treatments/TreatmentSelect";

import {
  getTreatmentPlans,
  createTreatment,
} from "@/services/treatmentPlans";
import { getSafeErrorMessage } from "@/lib/logError";

const priorities: TreatmentItemPriority[] = ["Low", "Medium", "High"];

const statuses: TreatmentItemStatus[] = [
  "Planned",
  "In Progress",
  "Completed",
  "Cancelled",
];

interface Props {
  open: boolean;
  patientId: string;
  currency: string;
  teeth: number[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

/**
 * Which treatment plan a grouped treatment gets added to - resolved with
 * the exact same "exactly one open plan" rule TreatmentPlansTab already
 * uses for its own tooth cross-navigation, so this doesn't invent a
 * second plan-selection policy. Plan *creation* is intentionally not
 * offered here: if none exist yet, the dentist uses the existing "+ New
 * Plan" action on the Treatment Plans tab and returns to finish this
 * selection - reusing that flow rather than building a second one.
 */
type PlanResolution =
  | { status: "loading" }
  | { status: "error" }
  | { status: "none" }
  | { status: "choose"; plans: TreatmentPlanWithItems[] }
  | { status: "ready"; plan: TreatmentPlanWithItems };

/**
 * Creates ONE treatment for every currently-selected tooth at once
 * (Phase C) - replacing the previous per-tooth saveTooth() loop. A
 * single tooth is handled by the exact same form as several, so the
 * dentist never has to think about the odontogram selection differently
 * depending on count (see toothSelection.ts for the Set-based selection
 * this reads from).
 */
export default function BulkTreatmentModal({
  open,
  patientId,
  currency,
  teeth,
  onClose,
  onSaved,
}: Props) {
  const [resolution, setResolution] = useState<PlanResolution>({
    status: "loading",
  });

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    null
  );

  const [procedure, setProcedure] = useState("");
  const [customTreatment, setCustomTreatment] = useState(false);
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<TreatmentItemPriority>("Medium");
  const [status, setStatus] = useState<TreatmentItemStatus>("Planned");
  const [saving, setSaving] = useState(false);

  const sortedTeeth = useMemo(
    () => [...teeth].sort((a, b) => a - b),
    [teeth]
  );

  useEffect(() => {
    if (!open) return;

    setProcedure("");
    setCustomTreatment(false);
    setPrice("");
    setNotes("");
    setPriority("Medium");
    setStatus("Planned");
    setSelectedPlanId(null);
    setResolution({ status: "loading" });

    let cancelled = false;

    (async () => {
      try {
        const plans = await getTreatmentPlans(patientId);

        if (cancelled) return;

        const openPlans = plans.filter(
          (plan) =>
            plan.status !== "Completed" && plan.status !== "Cancelled"
        );

        if (openPlans.length === 0) {
          setResolution({ status: "none" });
        } else if (openPlans.length === 1) {
          setResolution({ status: "ready", plan: openPlans[0] });
        } else {
          setResolution({ status: "choose", plans: openPlans });
        }
      } catch (error) {
        if (cancelled) return;

        toast.error(
          getSafeErrorMessage(error, "Failed to load treatment plans.")
        );

        setResolution({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, patientId]);

  const activePlan =
    resolution.status === "ready"
      ? resolution.plan
      : resolution.status === "choose" && selectedPlanId
        ? (resolution.plans.find((plan) => plan.id === selectedPlanId) ??
          null)
        : null;

  const priceNumber = price === "" ? 0 : Number(price);
  const total = priceNumber * sortedTeeth.length;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  function resetAndClose() {
    onClose();
  }

  async function handleSave() {
    if (!activePlan) return;

    if (!procedure.trim()) {
      toast.error("Please choose a treatment.");
      return;
    }

    setSaving(true);

    try {
      await createTreatment({
        treatment_plan_id: activePlan.id,
        procedure,
        tooth_numbers: sortedTeeth,
        estimated_price: priceNumber,
        quantity: sortedTeeth.length,
        notes: notes.trim() === "" ? null : notes,
        priority,
        status,
      });

      toast.success(
        `${procedure} added for ${sortedTeeth.length} ${
          sortedTeeth.length === 1 ? "tooth" : "teeth"
        }.`
      );

      await onSaved();

      resetAndClose();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to add treatment.")
      );
    } finally {
      setSaving(false);
    }
  }

  const title =
    sortedTeeth.length === 1
      ? `Add Treatment — Tooth ${sortedTeeth[0]}`
      : `Add Treatment — ${sortedTeeth.length} Teeth`;

  return (
    <Modal
      open={open}
      title={title}
      onClose={saving ? () => {} : resetAndClose}
      footer={
        activePlan ? (
          <>
            <Button
              variant="secondary"
              onClick={resetAndClose}
              disabled={saving}
            >
              Cancel
            </Button>

            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !procedure.trim()}
            >
              {saving ? "Saving..." : "Add Treatment"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={resetAndClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-1.5 rounded-lg bg-porcelain p-3">
          {sortedTeeth.map((tooth) => (
            <span
              key={tooth}
              className="data-metric rounded-full bg-sea-glass px-2.5 py-1 text-xs font-semibold text-deep-eucalyptus"
            >
              {tooth}
            </span>
          ))}
        </div>

        {resolution.status === "loading" && (
          <p className="text-sm text-mineral">
            Loading treatment plans...
          </p>
        )}

        {resolution.status === "error" && (
          <p className="text-sm text-clay-ink">
            Couldn&apos;t load this patient&apos;s treatment plans. Close
            this and try again.
          </p>
        )}

        {resolution.status === "none" && (
          <p className="text-sm text-mineral">
            This patient has no open treatment plan yet. Create one from
            the Treatment Plans tab, then come back here to add{" "}
            {sortedTeeth.length === 1
              ? `Tooth ${sortedTeeth[0]}`
              : `these ${sortedTeeth.length} teeth`}{" "}
            as a treatment.
          </p>
        )}

        {resolution.status === "choose" && (
          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Which treatment plan?
            </label>

            <div className="space-y-2">
              {resolution.plans.map((plan) => (
                <label
                  key={plan.id}
                  className="flex items-center gap-3 rounded-lg border border-sea-glass p-3 has-checked:border-eucalyptus has-checked:bg-sea-glass/40"
                >
                  <input
                    type="radio"
                    name="bulk-treatment-plan"
                    checked={selectedPlanId === plan.id}
                    onChange={() => setSelectedPlanId(plan.id)}
                  />
                  <span className="text-sm font-medium text-graphite">
                    {plan.title}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {activePlan && (
          <>
            {!customTreatment && (
              <TreatmentSelect
                value={procedure}
                onChange={(name, catalogPrice) => {
                  setProcedure(name);
                  setPrice(String(catalogPrice));
                }}
              />
            )}

            <div className="flex items-center gap-3">
              <input
                id="bulk-custom-treatment"
                type="checkbox"
                checked={customTreatment}
                onChange={(e) => setCustomTreatment(e.target.checked)}
              />

              <label
                htmlFor="bulk-custom-treatment"
                className="text-sm text-graphite"
              >
                Custom Treatment
              </label>
            </div>

            <FormInput
              label="Treatment"
              value={procedure}
              placeholder="e.g. Composite Restoration"
              onChange={setProcedure}
            />

            <FormInput
              label="Price per Tooth"
              type="number"
              value={price}
              placeholder="0.00"
              onChange={setPrice}
            />

            <div className="rounded-lg bg-porcelain p-3 text-sm text-graphite">
              <div>
                {sortedTeeth.length}{" "}
                {sortedTeeth.length === 1 ? "tooth" : "teeth"} &times;{" "}
                {formatCurrency(priceNumber)}
              </div>

              <div className="mt-1 text-lg font-bold text-deep-eucalyptus">
                Total: {formatCurrency(total)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-graphite">
                  Priority
                </label>

                <select
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as TreatmentItemPriority)
                  }
                  className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
                >
                  {priorities.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-graphite">
                  Status
                </label>

                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as TreatmentItemStatus)
                  }
                  className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
                >
                  {statuses.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <FormTextarea
              label="Notes"
              value={notes}
              rows={3}
              onChange={setNotes}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
