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
  calculateSellingPriceFromMarkup,
  calculateMarkupFromPrices,
  calculateGrossMargin,
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

// Which pricing field the clinic most recently typed into - lets markup
// and selling price recalculate each other (and both react to a cost
// edit) without the two inputs fighting over which one is "correct".
type LastEditedPriceField = "markup" | "price" | null;

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

  const [markup, setMarkup] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [lastEditedPriceField, setLastEditedPriceField] =
    useState<LastEditedPriceField>(null);

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

    // Pre-fill from the LIVE implied markup (cost vs. selling price) when
    // both are known, not the stored target_markup_percent - if cost has
    // drifted since the item was last priced, the form should reflect
    // today's real numbers, not a stale target (spec: never display a
    // stale stored percentage as if it were current).
    const cost = material ? Number(material.cost_per_unit) : 0;

    if (material?.selling_price != null) {
      setSellingPrice(String(material.selling_price));

      const impliedMarkup = calculateMarkupFromPrices(
        cost,
        material.selling_price
      );

      setMarkup(
        impliedMarkup != null
          ? String(impliedMarkup)
          : material.target_markup_percent != null
          ? String(material.target_markup_percent)
          : ""
      );
    } else {
      setSellingPrice("");
      setMarkup(
        material?.target_markup_percent != null
          ? String(material.target_markup_percent)
          : ""
      );
    }

    setLastEditedPriceField(null);
  }, [open, material]);

  if (!open) {
    return null;
  }

  const numericCost = Number(costPerUnit) || 0;

  function handleMarkupChange(value: string) {
    setMarkup(value);
    setLastEditedPriceField("markup");

    const parsed = Number(value);

    if (value.trim() && !Number.isNaN(parsed) && numericCost > 0) {
      setSellingPrice(
        String(calculateSellingPriceFromMarkup(numericCost, parsed))
      );
    }
  }

  function handleSellingPriceChange(value: string) {
    setSellingPrice(value);
    setLastEditedPriceField("price");

    const parsed = Number(value);

    if (value.trim() && !Number.isNaN(parsed) && numericCost > 0) {
      const implied = calculateMarkupFromPrices(numericCost, parsed);

      setMarkup(implied != null ? String(implied) : "");
    }
  }

  function handleCostChange(value: string) {
    setCostPerUnit(value);

    const newCost = Number(value) || 0;

    if (newCost <= 0) return;

    if (lastEditedPriceField === "markup" && markup.trim()) {
      const parsedMarkup = Number(markup);

      if (!Number.isNaN(parsedMarkup)) {
        setSellingPrice(
          String(calculateSellingPriceFromMarkup(newCost, parsedMarkup))
        );
      }
    } else if (sellingPrice.trim()) {
      const parsedPrice = Number(sellingPrice);

      if (!Number.isNaN(parsedPrice)) {
        const implied = calculateMarkupFromPrices(newCost, parsedPrice);

        setMarkup(implied != null ? String(implied) : "");
      }
    }
  }

  const numericSellingPrice = sellingPrice.trim()
    ? Number(sellingPrice)
    : null;

  const grossMargin =
    numericSellingPrice != null
      ? calculateGrossMargin(numericCost, numericSellingPrice)
      : null;

  const belowCost =
    numericSellingPrice != null &&
    numericCost > 0 &&
    numericSellingPrice < numericCost;

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

    if (numericSellingPrice != null && numericSellingPrice < 0) {
      toast.error("Selling price cannot be negative.");
      return;
    }

    try {
      setSaving(true);

      const finalCost = Number(costPerUnit);

      const finalMarkup =
        numericSellingPrice != null
          ? calculateMarkupFromPrices(finalCost, numericSellingPrice)
          : null;

      const metadata = {
        name,
        category: category || null,
        unit: resolvedUnit,
        cost_per_unit: finalCost,
        minimum_stock_level: Number(
          minimumStock || 0
        ),
        batch_number: batchNumber || null,
        expiry_date: expiryDate || null,
        notes: notes || null,

        selling_price: numericSellingPrice,
        target_markup_percent: finalMarkup,
        priced_at_cost:
          numericSellingPrice != null ? finalCost : null,
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

        <div className="rounded-lg border border-sea-glass p-4">

          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-mineral">
            Pricing
          </h3>

          <div className="space-y-4">

            <FormInput
              label="Cost Price"
              required
              type="number"
              value={costPerUnit}
              onChange={handleCostChange}
            />

            <div className="grid gap-4 sm:grid-cols-2">

              <FormInput
                label="Markup %"
                type="number"
                value={markup}
                placeholder={numericCost > 0 ? "e.g. 30" : "Cost required"}
                onChange={handleMarkupChange}
              />

              <FormInput
                label="Selling Price"
                type="number"
                value={sellingPrice}
                placeholder="Enter directly, or via markup"
                onChange={handleSellingPriceChange}
              />

            </div>

            <div className="flex items-center justify-between rounded-lg bg-porcelain px-4 py-3 text-sm">
              <span className="text-mineral">Gross Margin</span>
              <span className="font-semibold text-graphite">
                {grossMargin != null ? `${grossMargin}%` : "—"}
              </span>
            </div>

            {belowCost && numericSellingPrice != null && (
              <p className="text-sm font-medium text-clay">
                Selling price is{" "}
                {(numericCost - numericSellingPrice).toFixed(2)} below cost.
              </p>
            )}

          </div>

        </div>

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
