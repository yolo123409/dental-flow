"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import TreatmentSelect from "@/components/treatments/TreatmentSelect";

import {
  TreatmentItemPriority,
  TreatmentItemStatus,
  TreatmentPlanItem,
  SaveTreatmentItemInput,
} from "@/types/treatmentPlan";

interface Props {
  open: boolean;

  item?: TreatmentPlanItem | null;

  /** Prefilled when opened from a selected tooth on the odontogram. */
  defaultToothNumber?: number | null;

  saving?: boolean;

  onClose: () => void;

  onSave: (
    values: SaveTreatmentItemInput
  ) => Promise<void>;
}

const EMPTY_FORM: SaveTreatmentItemInput = {
  procedure: "",
  tooth_number: null,
  estimated_price: 0,
  quantity: 1,
  notes: null,
  priority: "Medium",
  status: "Planned",
};

export default function TreatmentItemModal({
  open,
  item,
  defaultToothNumber,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const editing = item != null;

  const [form, setForm] =
    useState<SaveTreatmentItemInput>(EMPTY_FORM);

  useEffect(() => {
    if (!open) return;

    if (item) {
      setForm({
        procedure: item.procedure,
        tooth_number: item.tooth_number,
        estimated_price: item.estimated_price,
        quantity: item.quantity,
        notes: item.notes,
        priority: item.priority,
        status: item.status,
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        tooth_number: defaultToothNumber ?? null,
      });
    }
  }, [open, item, defaultToothNumber]);

  function update<K extends keyof SaveTreatmentItemInput>(
    field: K,
    value: SaveTreatmentItemInput[K]
  ) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    if (!form.procedure.trim()) {
      toast.error("Please choose a procedure.");
      return;
    }

    if (
      form.tooth_number != null &&
      (form.tooth_number < 1 || form.tooth_number > 32)
    ) {
      toast.error("Tooth number must be between 1 and 32.");
      return;
    }

    await onSave(form);
  }

  return (
    <FormModal
      open={open}
      title={
        editing ? "Edit Procedure" : "Add Procedure"
      }
      loading={saving}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText={editing ? "Save Changes" : "Add"}
    >
      <TreatmentSelect
        value={form.procedure}
        onChange={(name, price) => {
          update("procedure", name);
          update("estimated_price", price);
        }}
      />

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Tooth Number (optional)"
          type="number"
          value={form.tooth_number ?? ""}
          placeholder="1-32"
          onChange={(value) =>
            update(
              "tooth_number",
              value === "" ? null : Number(value)
            )
          }
        />

        <FormInput
          label="Quantity"
          type="number"
          value={form.quantity}
          onChange={(value) =>
            update(
              "quantity",
              Math.max(1, Number(value) || 1)
            )
          }
        />
      </div>

      <FormInput
        label="Estimated Price"
        type="number"
        value={form.estimated_price}
        onChange={(value) =>
          update(
            "estimated_price",
            Math.max(0, Number(value) || 0)
          )
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-2 block font-medium">
            Priority
          </label>

          <select
            value={form.priority}
            onChange={(e) =>
              update(
                "priority",
                e.target.value as TreatmentItemPriority
              )
            }
            className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block font-medium">
            Status
          </label>

          <select
            value={form.status}
            onChange={(e) =>
              update(
                "status",
                e.target.value as TreatmentItemStatus
              )
            }
            className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
          >
            <option value="Planned">Planned</option>
            <option value="In Progress">
              In Progress
            </option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <FormTextarea
        label="Notes"
        value={form.notes ?? ""}
        onChange={(value) =>
          update("notes", value || null)
        }
      />
    </FormModal>
  );
}
