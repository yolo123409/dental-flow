"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import {
  TreatmentPlan,
  TreatmentPlanStatus,
} from "@/types/treatmentPlan";

interface FormState {
  title: string;
  notes: string;
  status: TreatmentPlanStatus;
}

interface Props {
  open: boolean;

  plan?: TreatmentPlan | null;

  saving?: boolean;

  onClose: () => void;

  onSave: (values: FormState) => Promise<void>;
}

const EMPTY_FORM: FormState = {
  title: "",
  notes: "",
  status: "Draft",
};

export default function TreatmentPlanModal({
  open,
  plan,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const editing = plan != null;

  const [form, setForm] =
    useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    if (!open) return;

    if (plan) {
      setForm({
        title: plan.title,
        notes: plan.notes ?? "",
        status: plan.status,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, plan]);

  async function handleSubmit() {
    if (!form.title.trim()) {
      toast.error("Please enter a title for this plan.");
      return;
    }

    await onSave(form);
  }

  return (
    <FormModal
      open={open}
      title={
        editing ? "Edit Treatment Plan" : "New Treatment Plan"
      }
      loading={saving}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText={editing ? "Save Changes" : "Create Plan"}
    >
      <FormInput
        label="Title"
        value={form.title}
        placeholder="e.g. Full Mouth Rehabilitation"
        onChange={(value) =>
          setForm((prev) => ({ ...prev, title: value }))
        }
      />

      <div>
        <label className="mb-2 block font-medium">
          Status
        </label>

        <select
          value={form.status}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              status: e.target.value as TreatmentPlanStatus,
            }))
          }
          className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
        >
          <option value="Draft">Draft</option>
          <option value="Planned">Planned</option>
          <option value="In Progress">In Progress</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
        </select>
      </div>

      <FormTextarea
        label="Notes"
        value={form.notes}
        onChange={(value) =>
          setForm((prev) => ({ ...prev, notes: value }))
        }
      />
    </FormModal>
  );
}
