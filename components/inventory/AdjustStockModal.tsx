"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import {
  ClinicInventoryItem,
  MovementReason,
  adjustStock,
} from "@/services/inventory";

interface Props {
  open: boolean;

  material: ClinicInventoryItem | null;

  onClose: () => void;

  onSaved: () => Promise<void>;
}

type Mode = "add" | "remove";

const ADD_REASONS: MovementReason[] = [
  "Restock",
  "Correction",
  "Other",
];

const REMOVE_REASONS: MovementReason[] = [
  "Used",
  "Damaged",
  "Expired",
  "Correction",
  "Other",
];

export default function AdjustStockModal({
  open,
  material,
  onClose,
  onSaved,
}: Props) {
  const [mode, setMode] = useState<Mode>("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] =
    useState<MovementReason>("Restock");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setMode("add");
    setAmount("");
    setReason("Restock");
    setNotes("");
  }, [open, material]);

  if (!open || !material) {
    return null;
  }

  const currentQuantity = Number(material.quantity);

  const parsedAmount = Number(amount || 0);

  const newQuantity =
    mode === "add"
      ? currentQuantity + parsedAmount
      : currentQuantity - parsedAmount;

  function handleModeChange(nextMode: Mode) {
    setMode(nextMode);

    setReason(
      nextMode === "add" ? "Restock" : "Used"
    );
  }

  async function handleSave() {
    if (saving || !material) return;

    if (!amount.trim() || parsedAmount <= 0) {
      toast.error(
        "Enter a quantity greater than 0."
      );
      return;
    }

    if (
      mode === "remove" &&
      parsedAmount > currentQuantity
    ) {
      toast.error(
        `Cannot remove more than the current stock (${currentQuantity} available).`
      );
      return;
    }

    try {
      setSaving(true);

      await adjustStock(
        material.id,
        mode === "add"
          ? parsedAmount
          : -parsedAmount,
        reason,
        notes
      );

      toast.success("Stock updated.");

      await onSaved();

      onClose();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to adjust stock."
      );
    } finally {
      setSaving(false);
    }
  }

  const reasonOptions =
    mode === "add" ? ADD_REASONS : REMOVE_REASONS;

  return (
    <Modal
      open={open}
      title={`Adjust Stock - ${material.name}`}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>

          <Button
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">

        <div className="flex gap-3">

          <Button
            variant={
              mode === "add"
                ? "primary"
                : "secondary"
            }
            className="flex-1"
            onClick={() =>
              handleModeChange("add")
            }
          >
            Add Stock
          </Button>

          <Button
            variant={
              mode === "remove"
                ? "primary"
                : "secondary"
            }
            className="flex-1"
            onClick={() =>
              handleModeChange("remove")
            }
          >
            Remove Stock
          </Button>

        </div>

        <div className="grid gap-5 sm:grid-cols-2">

          <FormInput
            label={
              mode === "add"
                ? "Quantity to Add"
                : "Quantity to Remove"
            }
            required
            type="number"
            value={amount}
            onChange={setAmount}
          />

          <div>

            <label className="mb-2 block text-sm font-semibold text-graphite">
              Reason
              <span className="ml-1 text-clay">*</span>
            </label>

            <select
              value={reason}
              onChange={(e) =>
                setReason(
                  e.target.value as MovementReason
                )
              }
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              {reasonOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

          </div>

        </div>

        <FormTextarea
          label="Notes (optional)"
          value={notes}
          onChange={setNotes}
        />

        <div className="rounded-lg border border-sea-glass bg-porcelain px-4 py-3 text-sm text-graphite">

          <div className="flex items-center justify-center gap-2 text-base font-semibold">
            <span>{currentQuantity}</span>
            <span className="text-mineral">
              →
            </span>
            <span
              className={
                mode === "add"
                  ? "text-eucalyptus"
                  : "text-clay"
              }
            >
              {Math.max(newQuantity, 0)}
            </span>
            <span className="text-mineral">
              {material.unit}
            </span>
          </div>

        </div>

      </div>
    </Modal>
  );
}
