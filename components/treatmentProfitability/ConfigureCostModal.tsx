"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";

import { updateTreatmentDirectCost } from "@/services/treatmentProfitability";

import { TreatmentProfitabilityRow } from "@/types/treatmentProfitability";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  open: boolean;

  treatment: TreatmentProfitabilityRow | null;

  currency: string;

  onClose: () => void;

  onSaved: () => Promise<void>;
}

export default function ConfigureCostModal({
  open,
  treatment,
  currency,
  onClose,
  onSaved,
}: Props) {
  const [directCost, setDirectCost] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setDirectCost(
      treatment?.directCost != null ? String(treatment.directCost) : ""
    );
  }, [open, treatment]);

  if (!open || !treatment) {
    return null;
  }

  const parsedCost = directCost.trim() === "" ? null : Number(directCost);
  const invalid =
    parsedCost != null && (Number.isNaN(parsedCost) || parsedCost < 0);

  async function handleSave() {
    if (invalid) {
      toast.error("Enter a valid, non-negative direct cost.");
      return;
    }

    try {
      setSaving(true);

      await updateTreatmentDirectCost(treatment!.id, parsedCost);

      await onSaved();

      onClose();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Unable to save direct cost.",
          "Failed to save treatment direct cost:"
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-8 py-6">
          <h2 className="text-2xl font-bold">Configure Direct Cost</h2>

          <p className="mt-2 text-slate-500">{treatment.name}</p>
        </div>

        <div className="space-y-6 p-8">
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            Selling price: <span className="font-semibold text-graphite">
              {new Intl.NumberFormat(undefined, {
                style: "currency",
                currency,
                maximumFractionDigits: 0,
              }).format(treatment.sellingPrice)}
            </span>
          </div>

          <FormInput
            label={`Estimated Direct Cost (${currency})`}
            type="number"
            placeholder="Not configured"
            value={directCost}
            onChange={setDirectCost}
            error={invalid ? "Enter a valid, non-negative amount." : null}
          />

          <p className="text-sm text-slate-500">
            The direct cost of delivering this treatment - materials, lab
            fees, and similar costs you can reliably attribute to it. Leave
            blank if this isn&apos;t known yet; DentalFlow will show
            profitability as unavailable rather than assume a cost.
          </p>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-8 py-6">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>

          <Button onClick={handleSave} disabled={saving || invalid}>
            {saving ? "Saving..." : "Save Cost"}
          </Button>
        </div>
      </div>
    </div>
  );
}
