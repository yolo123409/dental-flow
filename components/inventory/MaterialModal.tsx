"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import {
  ClinicInventoryItem,
  createInventoryItem,
  updateInventoryItem,
} from "@/services/inventory";

interface Props {
  open: boolean;

  material?: ClinicInventoryItem | null;

  existingCategories?: string[];

  onClose: () => void;

  onSaved: () => Promise<void>;
}

const UNITS = [
  "Pieces",
  "Boxes",
  "Packs",
  "Bottles",
  "Syringes",
  "Cartridges",
  "Tubes",
  "Rolls",
  "Sets",
  "Other",
];

const SUGGESTED_CATEGORIES = [
  "Restorative",
  "Endodontic",
  "Prosthodontic",
  "Orthodontic",
  "Surgical",
  "Anesthetic",
  "Impression Materials",
  "Infection Control",
  "PPE",
  "Disposable",
  "Laboratory",
  "Equipment",
  "General",
  "Other",
];

export default function MaterialModal({
  open,
  material,
  existingCategories = [],
  onClose,
  onSaved,
}: Props) {
  const editing = material != null;

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("Pieces");
  const [customUnit, setCustomUnit] = useState("");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [minimumStock, setMinimumStock] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);

  const categoryOptions = Array.from(
    new Set([
      ...SUGGESTED_CATEGORIES,
      ...existingCategories,
    ])
  ).sort();

  useEffect(() => {
    if (!open) return;

    setName(material?.name ?? "");
    setCategory(material?.category ?? "");
    setQuantity(
      material ? String(material.quantity) : ""
    );

    const isKnownUnit = UNITS.includes(
      material?.unit ?? ""
    );

    setUnit(
      material
        ? isKnownUnit
          ? material.unit
          : "Other"
        : "Pieces"
    );

    setCustomUnit(
      material && !isKnownUnit
        ? material.unit
        : ""
    );

    setCostPerUnit(
      material
        ? String(material.cost_per_unit)
        : ""
    );

    setMinimumStock(
      material
        ? String(material.minimum_stock_level)
        : ""
    );

    setBatchNumber(material?.batch_number ?? "");
    setExpiryDate(material?.expiry_date ?? "");

    setNotes(material?.notes ?? "");
  }, [open, material]);

  if (!open) {
    return null;
  }

  async function handleSave() {
    if (saving) return;

    if (!name.trim()) {
      toast.error("Material name is required.");
      return;
    }

    const resolvedUnit =
      unit === "Other" ? customUnit.trim() : unit;

    if (!resolvedUnit) {
      toast.error("Unit is required.");
      return;
    }

    if (!costPerUnit.trim()) {
      toast.error("Cost per unit is required.");
      return;
    }

    if (
      !editing &&
      !quantity.trim()
    ) {
      toast.error("Quantity is required.");
      return;
    }

    try {
      setSaving(true);

      const metadata = {
        name,
        category: category || null,
        unit: resolvedUnit,
        cost_per_unit: Number(costPerUnit),
        minimum_stock_level: Number(
          minimumStock || 0
        ),
        batch_number: batchNumber || null,
        expiry_date: expiryDate || null,
        notes: notes || null,
      };

      if (editing) {
        await updateInventoryItem(
          material!.id,
          metadata
        );

        toast.success("Material updated.");
      } else {
        await createInventoryItem({
          ...metadata,
          quantity: Number(quantity || 0),
        });

        toast.success("Material added.");
      }

      await onSaved();

      onClose();
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save material."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={
        editing ? "Edit Material" : "Add Material"
      }
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
            {saving
              ? "Saving..."
              : editing
              ? "Save Changes"
              : "Add Material"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">

        <FormInput
          label="Material Name"
          required
          value={name}
          onChange={setName}
        />

        <div>

          <label className="mb-2 block text-sm font-semibold text-graphite">
            Category
            <span className="ml-1 text-xs font-normal text-mineral">
              (optional)
            </span>
          </label>

          <input
            list="inventory-category-options"
            value={category}
            placeholder="e.g. Restorative"
            onChange={(e) =>
              setCategory(e.target.value)
            }
            className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite placeholder:text-mineral transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
          />

          <datalist id="inventory-category-options">
            {categoryOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>

        </div>

        {!editing && (
          <FormInput
            label="Quantity"
            required
            type="number"
            value={quantity}
            onChange={setQuantity}
          />
        )}

        <div className="grid gap-5 sm:grid-cols-2">

          <div>

            <label className="mb-2 block text-sm font-semibold text-graphite">
              Unit
              <span className="ml-1 text-clay">*</span>
            </label>

            <select
              value={unit}
              onChange={(e) =>
                setUnit(e.target.value)
              }
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              {UNITS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

          </div>

          <FormInput
            label="Cost Per Unit"
            required
            type="number"
            value={costPerUnit}
            onChange={setCostPerUnit}
          />

        </div>

        {unit === "Other" && (
          <FormInput
            label="Custom Unit"
            required
            value={customUnit}
            onChange={setCustomUnit}
          />
        )}

        <FormInput
          label="Minimum Stock Level (optional)"
          type="number"
          value={minimumStock}
          onChange={setMinimumStock}
        />

        <div className="grid gap-5 sm:grid-cols-2">

          <FormInput
            label="Batch / Lot Number (optional)"
            value={batchNumber}
            onChange={setBatchNumber}
          />

          <FormInput
            label="Expiry Date (optional)"
            type="date"
            value={expiryDate}
            onChange={setExpiryDate}
          />

        </div>

        <FormTextarea
          label="Notes (optional)"
          value={notes}
          onChange={setNotes}
        />

      </div>
    </Modal>
  );
}
