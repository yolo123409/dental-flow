"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import Button from "@/components/ui/Button";

import { getPurchaseOrders } from "@/services/purchaseOrders";
import { getSuppliers } from "@/services/suppliers";
import { createGRNFromPurchaseOrder, createManualGRN } from "@/services/grns";
import { logError } from "@/lib/logError";

import { PurchaseOrder, Supplier } from "@/types/procurement";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (grnId: string) => void;
}

type Mode = "po" | "manual";

export default function NewGRNModal({ open, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("po");

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [poId, setPoId] = useState("");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");

  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;

    setMode("po");
    setPoId("");
    setSupplierId("");
    setLoading(true);

    Promise.all([
      getPurchaseOrders({ status: "Sent" }),
      getPurchaseOrders({ status: "Partially Received" }),
      getSuppliers(),
    ])
      .then(([sent, partial, supplierList]) => {
        setOrders([...sent, ...partial]);
        setSuppliers(supplierList);
      })
      .catch((error) => {
        logError("[NewGRNModal] load failed:", error);

        toast.error("Failed to load purchase orders/suppliers.");
      })
      .finally(() => setLoading(false));
  }, [open]);

  async function handleSubmit() {
    try {
      setCreating(true);

      if (mode === "po") {
        if (!poId) {
          toast.error("Select a purchase order.");
          return;
        }

        const grn = await createGRNFromPurchaseOrder(poId);

        toast.success(`${grn.grn_number} created.`);

        onClose();
        onCreated(grn.id);
      } else {
        if (!supplierId) {
          toast.error("Select a supplier.");
          return;
        }

        const grn = await createManualGRN({ supplier_id: supplierId });

        toast.success(`${grn.grn_number} created.`);

        onClose();
        onCreated(grn.id);
      }
    } catch (error) {
      logError("[NewGRNModal] create failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to create GRN."
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <FormModal
      open={open}
      title="New Goods Received Note"
      loading={creating}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText="Create Draft"
    >
      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === "po" ? "primary" : "secondary"}
          className="flex-1"
          onClick={() => setMode("po")}
        >
          From Purchase Order
        </Button>
        <Button
          type="button"
          variant={mode === "manual" ? "primary" : "secondary"}
          className="flex-1"
          onClick={() => setMode("manual")}
        >
          Manual
        </Button>
      </div>

      {mode === "po" ? (
        <div>
          <label className="mb-2 block text-sm font-semibold text-graphite">
            Purchase Order
            <span className="ml-1 text-clay">*</span>
          </label>

          <select
            value={poId}
            onChange={(e) => setPoId(e.target.value)}
            disabled={loading}
            className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
          >
            <option value="">
              {loading ? "Loading..." : "Select a purchase order"}
            </option>

            {orders.map((po) => (
              <option key={po.id} value={po.id}>
                {po.po_number} — {po.clinic_suppliers?.name} ({po.status})
              </option>
            ))}
          </select>

          {!loading && orders.length === 0 && (
            <p className="mt-2 text-sm text-mineral">
              No Sent or Partially Received purchase orders to receive against.
            </p>
          )}
        </div>
      ) : (
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

          <p className="mt-2 text-sm text-mineral">
            Use this for goods received without a purchase order (emergency
            purchase, walk-in supplier, etc.).
          </p>
        </div>
      )}
    </FormModal>
  );
}
