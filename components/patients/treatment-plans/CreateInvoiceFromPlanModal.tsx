"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import {
  billTreatmentPlanItems,
  InvoiceScope,
} from "@/services/treatmentPlans";

import { TreatmentPlanWithItems } from "@/types/treatmentPlan";

interface Props {
  open: boolean;
  plan: TreatmentPlanWithItems | null;
  currency: string;
  onClose: () => void;
  onInvoiced: () => Promise<void>;
}

export default function CreateInvoiceFromPlanModal({
  open,
  plan,
  currency,
  onClose,
  onInvoiced,
}: Props) {
  const router = useRouter();

  const [scope, setScope] =
    useState<InvoiceScope>("all");

  const [selectedIds, setSelectedIds] = useState<
    string[]
  >([]);

  const [creating, setCreating] = useState(false);

  const billableItems = useMemo(
    () =>
      (plan?.treatment_plan_items ?? []).filter(
        (item) =>
          item.status !== "Cancelled" &&
          !item.charge_id
      ),
    [plan]
  );

  const completedItems = useMemo(
    () =>
      billableItems.filter(
        (item) => item.status === "Completed"
      ),
    [billableItems]
  );

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  function toggleSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((existing) => existing !== id)
        : [...prev, id]
    );
  }

  async function handleCreate() {
    if (!plan) return;

    if (scope === "selected" && selectedIds.length === 0) {
      toast.error("Select at least one procedure.");
      return;
    }

    try {
      setCreating(true);

      const invoice = await billTreatmentPlanItems(
        plan,
        scope,
        selectedIds
      );

      await onInvoiced();

      toast.success(
        `Invoice ${invoice.invoice_number} created.`
      );

      onClose();

      router.push(`/admin/billing/${invoice.id}`);
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create invoice."
      );
    } finally {
      setCreating(false);
    }
  }

  if (!plan) return null;

  return (
    <Modal
      open={open}
      title="Create Invoice from Plan"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </Button>

          <Button
            onClick={handleCreate}
            disabled={
              creating || billableItems.length === 0
            }
          >
            {creating
              ? "Creating..."
              : "Create Invoice"}
          </Button>
        </>
      }
    >
      {billableItems.length === 0 ? (
        <p className="text-slate-500">
          Every procedure in this plan has already been
          invoiced.
        </p>
      ) : (
        <div className="space-y-5">
          <div className="space-y-3">
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
              <input
                type="radio"
                name="invoice-scope"
                checked={scope === "all"}
                onChange={() => setScope("all")}
              />
              <span>
                Entire plan
                <span className="ml-2 text-sm text-slate-500">
                  ({billableItems.length} procedure
                  {billableItems.length === 1 ? "" : "s"})
                </span>
              </span>
            </label>

            <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
              <input
                type="radio"
                name="invoice-scope"
                checked={scope === "completed"}
                disabled={completedItems.length === 0}
                onChange={() => setScope("completed")}
              />
              <span>
                Only completed items
                <span className="ml-2 text-sm text-slate-500">
                  ({completedItems.length} procedure
                  {completedItems.length === 1 ? "" : "s"})
                </span>
              </span>
            </label>

            <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
              <input
                type="radio"
                name="invoice-scope"
                checked={scope === "selected"}
                onChange={() => setScope("selected")}
              />
              <span>Selected procedures</span>
            </label>
          </div>

          {scope === "selected" && (
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
              {billableItems.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(
                        item.id
                      )}
                      onChange={() =>
                        toggleSelected(item.id)
                      }
                    />
                    {item.procedure}
                    {item.tooth_number != null && (
                      <span className="text-xs text-slate-400">
                        (Tooth {item.tooth_number})
                      </span>
                    )}
                  </span>

                  <span className="text-sm font-medium text-slate-600">
                    {formatCurrency(
                      Number(item.estimated_price) *
                        item.quantity
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
