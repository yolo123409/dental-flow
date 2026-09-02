"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import {
  ClinicInventoryItem,
  InventoryBatch,
  returnToSupplier,
} from "@/services/inventory";
import { getSuppliers } from "@/services/suppliers";
import { getReceivedGrnsForItem, ReceivedGrnOption } from "@/services/grns";
import { Supplier } from "@/types/procurement";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  open: boolean;

  material: ClinicInventoryItem | null;

  batches: InventoryBatch[];

  onClose: () => void;

  onSaved: () => Promise<void>;
}

const NONE = "";

export default function ReturnToSupplierModal({
  open,
  material,
  batches,
  onClose,
  onSaved,
}: Props) {
  const [quantity, setQuantity] = useState("");
  const [supplierId, setSupplierId] = useState(NONE);
  const [batchNumber, setBatchNumber] = useState(NONE);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Full-app audit fix H14: which delivery (GRN) this item was actually
  // received through, for the currently-selected supplier - lets the
  // return net out of that GRN's outstanding balance instead of
  // permanently overstating it. Optional: not every returnable item was
  // received via a tracked GRN.
  const [grnOptions, setGrnOptions] = useState<ReceivedGrnOption[]>([]);
  const [grnId, setGrnId] = useState(NONE);

  useEffect(() => {
    if (!open) return;

    setQuantity("");
    setSupplierId(NONE);
    setBatchNumber(NONE);
    setReference("");
    setNotes("");
    setGrnOptions([]);
    setGrnId(NONE);

    getSuppliers()
      .then(setSuppliers)
      .catch((error) => console.error(error));
  }, [open, material]);

  useEffect(() => {
    setGrnId(NONE);

    if (!open || !material || !supplierId) {
      setGrnOptions([]);
      return;
    }

    getReceivedGrnsForItem(material.id, supplierId)
      .then(setGrnOptions)
      .catch((error) => {
        console.error(error);
        setGrnOptions([]);
      });
  }, [open, material, supplierId]);

  if (!open || !material) {
    return null;
  }

  const currentQuantity = Number(material.quantity);
  const parsedQuantity = Number(quantity || 0);

  async function handleSave() {
    if (!material) return;

    if (!quantity.trim() || parsedQuantity <= 0) {
      toast.error("Enter a quantity greater than 0.");
      return;
    }

    if (parsedQuantity > currentQuantity) {
      toast.error(
        `Cannot return more than the current stock (${currentQuantity} available).`
      );
      return;
    }

    if (!supplierId) {
      toast.error("Select a supplier.");
      return;
    }

    try {
      setSaving(true);

      await returnToSupplier(material.id, parsedQuantity, supplierId, {
        reference: reference || undefined,
        notes: notes || undefined,
        batchNumber: batchNumber || null,
        grnId: grnId || null,
      });

      toast.success("Return to supplier recorded.");

      await onSaved();

      onClose();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Unable to record return to supplier.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Return to Supplier - ${material.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Record Return"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormInput
            label="Quantity to Return"
            required
            type="number"
            value={quantity}
            onChange={setQuantity}
          />

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Supplier
              <span className="ml-1 text-clay">*</span>
            </label>

            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              <option value={NONE}>Select a supplier...</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {grnOptions.length > 0 && (
          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Which Delivery Is This From? (optional)
            </label>

            <select
              value={grnId}
              onChange={(e) => setGrnId(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              <option value={NONE}>Not linked to a specific delivery</option>
              {grnOptions.map((grn) => (
                <option key={grn.grnId} value={grn.grnId}>
                  {grn.grnNumber} ({grn.dateReceived})
                </option>
              ))}
            </select>

            <p className="mt-1.5 text-xs text-mineral">
              Linking a delivery reduces what&apos;s shown as still owed for
              it, instead of overstating this supplier&apos;s balance.
            </p>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          {batches.length > 0 && (
            <div>
              <label className="mb-2 block text-sm font-semibold text-graphite">
                Batch (optional)
              </label>

              <select
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
              >
                <option value={NONE}>Unspecified</option>
                {batches.map((batch) => (
                  <option
                    key={batch.batchNumber ?? "unbatched"}
                    value={batch.batchNumber ?? ""}
                  >
                    {batch.batchNumber ?? "Unbatched"} ({batch.quantityRemaining}{" "}
                    {material.unit} available)
                  </option>
                ))}
              </select>
            </div>
          )}

          <FormInput
            label="Reference (optional)"
            placeholder="Return note / RMA number..."
            value={reference}
            onChange={setReference}
          />
        </div>

        <FormTextarea label="Reason / Notes (optional)" value={notes} onChange={setNotes} />

        <div className="rounded-lg border border-sea-glass bg-porcelain px-4 py-3 text-sm text-graphite">
          <div className="flex items-center justify-center gap-2 text-base font-semibold">
            <span>{currentQuantity}</span>
            <span className="text-mineral">→</span>
            <span className="text-clay">
              {Math.max(currentQuantity - parsedQuantity, 0)}
            </span>
            <span className="text-mineral">{material.unit}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
