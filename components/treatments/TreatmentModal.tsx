"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";

import {
  ClinicTreatment,
  createTreatment,
  updateTreatment,
} from "@/services/treatments";

interface Props {
  open: boolean;

  treatment?: ClinicTreatment | null;

  onClose: () => void;

  onSaved: () => Promise<void>;
}

const categories = [
  "Consultation",
  "Preventive",
  "Restorative",
  "Endodontics",
  "Prosthodontics",
  "Oral Surgery",
  "Orthodontics",
  "Cosmetic",
  "Periodontics",
  "Radiology",
  "Other",
];

export default function TreatmentModal({
  open,
  treatment,
  onClose,
  onSaved,
}: Props) {
  const editing =
    treatment != null;

  const [name, setName] =
    useState("");

  const [category, setCategory] =
    useState("Consultation");

  const [price, setPrice] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  useEffect(() => {
    if (!open) return;

    setName(
      treatment?.name ?? ""
    );

    setCategory(
      treatment?.category ??
        "Consultation"
    );

    setPrice(
      treatment
        ? String(
            treatment.default_price
          )
        : ""
    );
  }, [open, treatment]);

  if (!open) {
    return null;
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error(
        "Treatment name is required."
      );
      return;
    }

    try {
      setSaving(true);

      if (editing) {
        await updateTreatment(
          treatment!.id,
          name,
          category,
          Number(price || 0)
        );
      } else {
        await createTreatment(
          name,
          category,
          Number(price || 0)
        );
      }

      await onSaved();

      onClose();
    } catch (error) {
      console.error("Failed to save treatment:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save treatment."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">

      <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl">

        <div className="border-b border-slate-200 px-8 py-6">

          <h2 className="text-2xl font-bold">

            {editing
              ? "Edit Treatment"
              : "Add Treatment"}

          </h2>

          <p className="mt-2 text-slate-500">
            Create a treatment
            with a default price.
          </p>

        </div>

        <div className="space-y-6 p-8">

          <FormInput
            label="Treatment Name"
            value={name}
            onChange={setName}
          />

          <div>

            <label className="mb-2 block font-medium">
              Category
            </label>

            <select
              value={category}
              onChange={(e) =>
                setCategory(
                  e.target.value
                )
              }
              className="w-full rounded-xl border border-slate-300 p-3 transition focus:border-blue-500 focus:outline-none"
            >
              {categories.map(
                (item) => (
                  <option
                    key={item}
                  >
                    {item}
                  </option>
                )
              )}
            </select>

          </div>

          <FormInput
            label="Default Price (KES)"
            type="number"
            value={price}
            onChange={setPrice}
          />

        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-8 py-6">

          <Button
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>

          <Button
            onClick={
              handleSave
            }
            disabled={saving}
          >
            {saving
              ? "Saving..."
              : editing
              ? "Save Changes"
              : "Create Treatment"}
          </Button>

        </div>

      </div>

    </div>
  );
}