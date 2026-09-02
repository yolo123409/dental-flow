"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Receipt,
} from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import { PlanStatusBadge } from "./TreatmentPlanBadges";
import TreatmentItemRow from "./TreatmentItemRow";
import TreatmentItemModal from "./TreatmentItemModal";

import {
  calculatePlanTotals,
  createTreatment,
  updateTreatmentItem,
  updateTreatmentTeeth,
  deleteTreatmentItem,
  reorderTreatmentItems,
  getItemTeeth,
  getItemInvoicedAmount,
} from "@/services/treatmentPlans";

import {
  TreatmentPlanItem,
  TreatmentPlanWithItems,
  SaveTreatmentItemInput,
} from "@/types/treatmentPlan";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  plan: TreatmentPlanWithItems;
  currency: string;
  defaultToothNumber?: number | null;
  onBack: () => void;
  onReload: () => Promise<void>;
  onEditPlan: () => void;
  onDeletePlan: () => void;
  onCreateInvoice: () => void;
  onViewOnChart?: (teeth: number[]) => void;
}

export default function TreatmentPlanDetail({
  plan,
  currency,
  defaultToothNumber,
  onBack,
  onReload,
  onEditPlan,
  onDeletePlan,
  onCreateInvoice,
  onViewOnChart,
}: Props) {
  const [itemModalOpen, setItemModalOpen] =
    useState(false);

  const [editingItem, setEditingItem] =
    useState<TreatmentPlanItem | null>(null);

  const [deleteTarget, setDeleteTarget] =
    useState<TreatmentPlanItem | null>(null);

  const [savingItem, setSavingItem] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);

  const items = plan.treatment_plan_items;

  const totals = useMemo(
    () => calculatePlanTotals(items),
    [items]
  );

  // Phase E section 9: a compact summary drawn only from data already on
  // these items - teeth involved (via the same getItemTeeth() every other
  // display uses, so it's never out of sync with what the rows show) and
  // invoiced value. Deliberately no "outstanding"/"paid" figure here -
  // that depends on the linked invoice's own payment state, which this
  // plan's items don't carry, and inventing one would be exactly the
  // kind of accounting this phase was told not to invent.
  //
  // Phase H: invoicedValue uses isItemInvoiced() (the charge's actual
  // status), not merely "has a charge_id" - every billable Treatment now
  // gets a charge immediately on creation, while still Pending, so
  // charge_id alone no longer means invoiced.
  //
  // Full-app audit fix H1: sums getItemInvoicedAmount() - the real,
  // frozen charge amount(s) - not estimated_price * quantity, which is
  // the item's own editable form field and could silently drift from
  // what was actually invoiced.
  const teethAndBilling = useMemo(() => {
    const active = items.filter((item) => item.status !== "Cancelled");

    const teeth = new Set<number>();
    let invoicedValue = 0;

    for (const item of active) {
      for (const tooth of getItemTeeth(item)) {
        teeth.add(tooth);
      }

      invoicedValue += getItemInvoicedAmount(item);
    }

    return { teethCount: teeth.size, invoicedValue };
  }, [items]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  const timeline = useMemo(() => {
    const events = [
      {
        date: plan.created_at,
        label: `Plan "${plan.title}" created`,
      },
      ...items.map((item) => {
        const teeth = getItemTeeth(item);

        const teethLabel =
          teeth.length === 0
            ? ""
            : teeth.length === 1
              ? ` (Tooth ${teeth[0]})`
              : ` (Teeth ${teeth.join(", ")})`;

        return {
          date: item.created_at,
          label: `Added ${item.procedure}${teethLabel}`,
        };
      }),
    ];

    return events.sort(
      (a, b) =>
        new Date(b.date).getTime() -
        new Date(a.date).getTime()
    );
  }, [plan, items]);

  async function handleSaveItem(
    values: SaveTreatmentItemInput
  ) {
    try {
      setSavingItem(true);

      if (editingItem) {
        // Scalar fields and teeth are two separate, independently atomic
        // writes (services/treatmentPlans.ts#updateTreatmentTeeth) - teeth
        // are only touched at all when they actually changed, so editing
        // an invoiced item's price/notes/status never risks hitting the
        // "teeth are frozen once invoiced" guard for a field it didn't
        // even ask to change.
        await updateTreatmentItem(editingItem.id, {
          procedure: values.procedure,
          estimated_price: values.estimated_price,
          quantity: values.quantity,
          notes: values.notes,
          priority: values.priority,
          status: values.status,
        });

        const currentTeeth = getItemTeeth(editingItem);
        const teethChanged =
          currentTeeth.length !== values.tooth_numbers.length ||
          currentTeeth.some(
            (tooth, index) => tooth !== values.tooth_numbers[index]
          );

        if (teethChanged) {
          await updateTreatmentTeeth(
            editingItem.id,
            values.tooth_numbers
          );
        }

        toast.success("Treatment updated.");
      } else {
        await createTreatment({
          treatment_plan_id: plan.id,
          procedure: values.procedure,
          tooth_numbers: values.tooth_numbers,
          estimated_price: values.estimated_price,
          quantity: values.quantity,
          notes: values.notes,
          priority: values.priority,
          status: values.status,
        });

        toast.success("Treatment added.");
      }

      setItemModalOpen(false);
      setEditingItem(null);

      await onReload();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to save treatment.")
      );
    } finally {
      setSavingItem(false);
    }
  }

  async function confirmDeleteItem() {
    if (!deleteTarget) return;

    try {
      setDeletingItem(true);

      await deleteTreatmentItem(
        deleteTarget.id,
        plan.id
      );

      toast.success("Treatment removed.");

      setDeleteTarget(null);

      await onReload();
    } catch (error) {
      console.error(error);

      toast.error(
        getSafeErrorMessage(error, "Failed to remove treatment.")
      );
    } finally {
      setDeletingItem(false);
    }
  }

  async function moveItem(
    index: number,
    direction: -1 | 1
  ) {
    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= items.length) {
      return;
    }

    const reordered = [...items];

    [reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ];

    try {
      await reorderTreatmentItems(
        plan.id,
        reordered.map((item) => item.id)
      );

      await onReload();
    } catch (error) {
      console.error(error);

      toast.error("Failed to reorder treatments.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
        >
          <ArrowLeft size={16} />
          Back to Treatment Plans
        </button>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={onEditPlan}
          >
            <Pencil size={15} className="mr-1.5 inline" />
            Edit Plan
          </Button>

          <Button variant="danger" onClick={onDeletePlan}>
            <Trash2 size={15} className="mr-1.5 inline" />
            Delete Plan
          </Button>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-slate-900">
                {plan.title}
              </h2>

              <PlanStatusBadge status={plan.status} />
            </div>

            {plan.notes && (
              <p className="mt-2 max-w-2xl text-slate-500">
                {plan.notes}
              </p>
            )}

            <p className="mt-2 text-sm text-slate-400">
              Created{" "}
              {new Date(
                plan.created_at
              ).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Clinical planning metrics only - no financial obligation is
            created by anything reflected in this grid. Estimated Cost is
            a planning figure, not revenue or an amount owed; it only
            becomes real once explicitly invoiced (see the separate
            Billing card below). */}
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Treatments
            </p>
            <p className="mt-1 text-2xl font-bold">
              {totals.procedureCount}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Teeth Involved
            </p>
            <p className="mt-1 text-2xl font-bold">
              {teethAndBilling.teethCount}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Estimated Cost
            </p>
            <p className="mt-1 text-2xl font-bold">
              {formatCurrency(totals.totalEstimated)}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Planned value, not a bill
            </p>
          </div>

          <div className="rounded-xl bg-green-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Completed
            </p>
            <p className="mt-1 text-2xl font-bold text-green-600">
              {formatCurrency(totals.totalCompleted)}
            </p>
          </div>

          <div className="rounded-xl bg-amber-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Remaining
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {formatCurrency(totals.remaining)}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-600">
              Progress
            </span>
            <span className="text-slate-500">
              {totals.completedCount} of{" "}
              {totals.procedureCount} completed
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-600 transition-all"
              style={{ width: `${totals.progress}%` }}
            />
          </div>
        </div>
      </Card>

      <Card title="Billing">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Invoiced
            </p>
            <p className="mt-1 text-2xl font-bold text-blue-600">
              {formatCurrency(teethAndBilling.invoicedValue)}
            </p>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              The only figure on this plan that reflects a real financial
              obligation. Treatment plans and treatments never bill the
              patient on their own - an invoice is created here only when
              explicitly requested.
            </p>
          </div>

          <Button variant="secondary" onClick={onCreateInvoice}>
            <Receipt size={15} className="mr-1.5 inline" />
            Create Invoice
          </Button>
        </div>
      </Card>

      <Card title="Treatments">
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setEditingItem(null);
                setItemModalOpen(true);
              }}
            >
              + Add Treatment
            </Button>
          </div>

          {items.length === 0 ? (
            <EmptyState
              title="No treatments added yet."
              description="Add the treatments recommended for this patient."
            />
          ) : (
            <div className="space-y-3">
              {items.map((item, index) => (
                <TreatmentItemRow
                  key={item.id}
                  item={item}
                  currency={currency}
                  isFirst={index === 0}
                  isLast={index === items.length - 1}
                  onEdit={() => {
                    setEditingItem(item);
                    setItemModalOpen(true);
                  }}
                  onDelete={() => setDeleteTarget(item)}
                  onMoveUp={() => moveItem(index, -1)}
                  onMoveDown={() => moveItem(index, 1)}
                  onViewOnChart={onViewOnChart}
                />
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card title="Timeline">
        <div className="space-y-3">
          {timeline.map((event, index) => (
            <div
              key={index}
              className="flex items-start gap-3 text-sm"
            >
              <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />

              <div>
                <p className="text-slate-700">
                  {event.label}
                </p>
                <p className="text-xs text-slate-400">
                  {new Date(
                    event.date
                  ).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <TreatmentItemModal
        open={itemModalOpen}
        item={editingItem}
        patientId={plan.patient_id}
        defaultToothNumber={defaultToothNumber}
        currency={currency}
        saving={savingItem}
        onClose={() => {
          setItemModalOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSaveItem}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Remove treatment"
        description={
          deleteTarget
            ? `Remove "${deleteTarget.procedure}" from this plan?`
            : undefined
        }
        confirmText="Remove"
        loading={deletingItem}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteItem}
      />
    </div>
  );
}
