"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import useRealtimeTables from "@/hooks/useRealtimeTables";

import TreatmentPlanCard from "./TreatmentPlanCard";
import TreatmentPlanModal from "./TreatmentPlanModal";
import TreatmentPlanDetail from "./TreatmentPlanDetail";
import CreateInvoiceFromPlanModal from "./CreateInvoiceFromPlanModal";

import {
  getTreatmentPlans,
  createTreatmentPlan,
  updateTreatmentPlan,
  deleteTreatmentPlan,
} from "@/services/treatmentPlans";

import { TreatmentPlanWithItems } from "@/types/treatmentPlan";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  patientId: string;
  currency: string;

  /** Tooth the user just clicked "Add to Treatment Plan" from, if any. */
  pendingTooth?: number | null;
  onPendingToothConsumed?: () => void;

  /** Phase I: a plan to jump straight into, e.g. from Billing's "View
   * Treatment"/"View Plan" links (?plan=<id> on the patient page URL).
   * Only consulted once, the first time `plans` loads - selecting a plan
   * inside this tab afterward must never fight back with a stale param. */
  initialPlanId?: string | null;

  onViewOnChart: (teeth: number[]) => void;
}

export default function TreatmentPlansTab({
  patientId,
  currency,
  pendingTooth,
  onPendingToothConsumed,
  initialPlanId,
  onViewOnChart,
}: Props) {
  const [plans, setPlans] = useState<
    TreatmentPlanWithItems[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedPlanId, setSelectedPlanId] = useState<
    string | null
  >(null);

  const [planModalOpen, setPlanModalOpen] =
    useState(false);

  const [editingPlan, setEditingPlan] =
    useState<TreatmentPlanWithItems | null>(null);

  const [savingPlan, setSavingPlan] = useState(false);

  const [deleteTarget, setDeleteTarget] =
    useState<TreatmentPlanWithItems | null>(null);

  const [deletingPlan, setDeletingPlan] = useState(false);

  const [invoiceModalPlan, setInvoiceModalPlan] =
    useState<TreatmentPlanWithItems | null>(null);

  const realtimeTables = useMemo(
    () => ["treatment_plans", "treatment_plan_items"],
    []
  );

  const loadPlans = useCallback(async () => {
    try {
      setError(null);

      const data = await getTreatmentPlans(patientId);

      setPlans(data);
    } catch (err) {
      setError(
        getSafeErrorMessage(err, "Failed to load treatment plans.")
      );
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useRealtimeTables({
    tables: realtimeTables,
    reload: loadPlans,
  });

  const selectedPlan = useMemo(
    () =>
      plans.find((plan) => plan.id === selectedPlanId) ??
      null,
    [plans, selectedPlanId]
  );

  // Phase I: consume ?plan=<id> exactly once, the first time plans finish
  // loading - a ref (not state) so this never re-fires just because
  // `plans` reloads later (e.g. after editing a treatment).
  const consumedInitialPlanId = useRef(false);

  useEffect(() => {
    if (
      consumedInitialPlanId.current ||
      loading ||
      !initialPlanId
    ) {
      return;
    }

    consumedInitialPlanId.current = true;

    if (plans.some((plan) => plan.id === initialPlanId)) {
      setSelectedPlanId(initialPlanId);
    }
  }, [initialPlanId, plans, loading]);

  // If the user arrived here wanting to add a treatment for a specific
  // tooth and exactly one open plan exists, jump straight into it.
  useEffect(() => {
    if (pendingTooth == null || loading) return;

    if (selectedPlanId) return;

    const openPlans = plans.filter(
      (plan) =>
        plan.status !== "Completed" &&
        plan.status !== "Cancelled"
    );

    if (openPlans.length === 1) {
      setSelectedPlanId(openPlans[0].id);
    } else if (openPlans.length === 0) {
      toast(
        `Create a treatment plan, then add Tooth ${pendingTooth} as a treatment.`
      );
    } else {
      toast(
        `Open a plan and add Tooth ${pendingTooth} as a treatment.`
      );
    }
  }, [pendingTooth, plans, loading, selectedPlanId]);

  async function handleSavePlan(values: {
    title: string;
    notes: string;
    status: TreatmentPlanWithItems["status"];
  }) {
    try {
      setSavingPlan(true);

      if (editingPlan) {
        await updateTreatmentPlan(editingPlan.id, {
          title: values.title,
          notes: values.notes,
          status: values.status,
        });

        toast.success("Plan updated.");
      } else {
        const plan = await createTreatmentPlan({
          patient_id: patientId,
          title: values.title,
          notes: values.notes || null,
          status: values.status,
        });

        toast.success("Treatment plan created.");

        await loadPlans();

        setSelectedPlanId(plan.id);
      }

      setPlanModalOpen(false);
      setEditingPlan(null);

      await loadPlans();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to save treatment plan.")
      );
    } finally {
      setSavingPlan(false);
    }
  }

  async function confirmDeletePlan() {
    if (!deleteTarget) return;

    try {
      setDeletingPlan(true);

      await deleteTreatmentPlan(deleteTarget.id);

      toast.success("Treatment plan deleted.");

      if (selectedPlanId === deleteTarget.id) {
        setSelectedPlanId(null);
      }

      setDeleteTarget(null);

      await loadPlans();
    } catch (error) {
      console.error(error);

      toast.error(
        getSafeErrorMessage(error, "Failed to delete treatment plan.")
      );
    } finally {
      setDeletingPlan(false);
    }
  }

  if (loading) {
    return <LoadingSpinner text="Loading treatment plans..." />;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-dashed border-red-200 bg-red-50 py-12 text-center">
        <p className="font-medium text-red-600">
          Couldn&apos;t load treatment plans
        </p>
        <p className="mt-1 text-sm text-red-500">
          {error}
        </p>
      </div>
    );
  }

  if (selectedPlan) {
    return (
      <>
        <TreatmentPlanDetail
          plan={selectedPlan}
          currency={currency}
          defaultToothNumber={pendingTooth}
          onBack={() => setSelectedPlanId(null)}
          onReload={async () => {
            await loadPlans();
            onPendingToothConsumed?.();
          }}
          onEditPlan={() => {
            setEditingPlan(selectedPlan);
            setPlanModalOpen(true);
          }}
          onDeletePlan={() =>
            setDeleteTarget(selectedPlan)
          }
          onCreateInvoice={() =>
            setInvoiceModalPlan(selectedPlan)
          }
          onViewOnChart={onViewOnChart}
        />

        <TreatmentPlanModal
          open={planModalOpen}
          plan={editingPlan}
          saving={savingPlan}
          onClose={() => {
            setPlanModalOpen(false);
            setEditingPlan(null);
          }}
          onSave={handleSavePlan}
        />

        <CreateInvoiceFromPlanModal
          open={invoiceModalPlan !== null}
          plan={invoiceModalPlan}
          currency={currency}
          onClose={() => setInvoiceModalPlan(null)}
          onInvoiced={loadPlans}
        />

        <ConfirmDialog
          open={deleteTarget !== null}
          title="Delete treatment plan"
          description={
            deleteTarget
              ? `Delete "${deleteTarget.title}"? This removes all of its treatments too.`
              : undefined
          }
          confirmText="Delete"
          loading={deletingPlan}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDeletePlan}
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          Treatment Plans
        </h2>

        <Button
          onClick={() => {
            setEditingPlan(null);
            setPlanModalOpen(true);
          }}
        >
          + New Plan
        </Button>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          title="No treatment plan yet."
          description="Create a plan to recommend and track a patient's upcoming work."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {plans.map((plan) => (
            <TreatmentPlanCard
              key={plan.id}
              plan={plan}
              currency={currency}
              onClick={() => setSelectedPlanId(plan.id)}
            />
          ))}
        </div>
      )}

      <TreatmentPlanModal
        open={planModalOpen}
        plan={editingPlan}
        saving={savingPlan}
        onClose={() => {
          setPlanModalOpen(false);
          setEditingPlan(null);
        }}
        onSave={handleSavePlan}
      />
    </div>
  );
}
