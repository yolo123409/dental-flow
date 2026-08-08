"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";

import { getSuppliers } from "@/services/suppliers";
import { createDraftPurchaseOrder } from "@/services/purchaseOrders";
import { logError } from "@/lib/logError";

import { Supplier } from "@/types/procurement";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (poId: string) => void;
}

export default function NewPurchaseOrderModal({
  open,
  onClose,
  onCreated,
}: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;

    setSupplierId("");
    setLoading(true);

    getSuppliers()
      .then(setSuppliers)
      .catch((error) => {
        logError("[NewPurchaseOrderModal] load suppliers failed:", error);

        toast.error("Failed to load suppliers.");
      })
      .finally(() => setLoading(false));
  }, [open]);

  async function handleSubmit() {
    if (!supplierId) {
      toast.error("Select a supplier.");
      return;
    }

    try {
      setCreating(true);

      const po = await createDraftPurchaseOrder({ supplier_id: supplierId });

      toast.success(`${po.po_number} created.`);

      onClose();
      onCreated(po.id);
    } catch (error) {
      logError("[NewPurchaseOrderModal] create failed:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create purchase order."
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <FormModal
      open={open}
      title="New Purchase Order"
      loading={creating}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText="Create Draft"
    >
      <div>
        <label className="mb-2 block text-sm font-semibold text-graphite">
          Supplier
          <span className="ml-1 text-clay">*</span>
        </label>

        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          disabled={loading}
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
        >
          <option value="">
            {loading ? "Loading..." : "Select a supplier"}
          </option>

          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>

        {!loading && suppliers.length === 0 && (
          <p className="mt-2 text-sm text-mineral">
            Add a supplier first before creating a purchase order.
          </p>
        )}
      </div>
    </FormModal>
  );
}
