"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";

import jsPDF from "jspdf";
import { toPng } from "html-to-image";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PermissionGuard from "@/components/auth/PermissionGuard";

import POStatusBadge from "@/components/procurement/POStatusBadge";
import POHeaderModal from "@/components/procurement/POHeaderModal";
import POItemModal from "@/components/procurement/POItemModal";
import PurchaseOrderDocument from "@/components/procurement/PurchaseOrderDocument";
import SendDocumentModal from "@/components/procurement/SendDocumentModal";

import usePermissions from "@/hooks/usePermissions";
import {
  getPurchaseOrder,
  addPurchaseOrderItem,
  updatePurchaseOrderItem,
  removePurchaseOrderItem,
  cancelPurchaseOrder,
  sendPurchaseOrder,
} from "@/services/purchaseOrders";
import { createGRNFromPurchaseOrder } from "@/services/grns";
import { getClinicSettings, ClinicSettings } from "@/services/settings";
import { getProcurementSettings } from "@/services/procurementSettings";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import {
  PurchaseOrderWithItems,
  PurchaseOrderItem,
  ProcurementSettings,
} from "@/types/procurement";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(amount);
}

function PurchaseOrderDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { hasPermission } = usePermissions();
  const canManage = hasPermission("procurement_manage");

  const [loading, setLoading] = useState(true);
  const [po, setPo] = useState<PurchaseOrderWithItems | null>(null);
  const [clinic, setClinic] = useState<ClinicSettings | null>(null);
  const [procurementSettings, setProcurementSettings] =
    useState<ProcurementSettings | null>(null);

  const documentRef = useRef<HTMLDivElement>(null);

  const [headerModalOpen, setHeaderModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PurchaseOrderItem | null>(
    null
  );
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removingItem, setRemovingItem] = useState<PurchaseOrderItem | null>(
    null
  );
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    try {
      setLoading(true);

      const [data, clinicData, settingsData] = await Promise.all([
        getPurchaseOrder(id),
        getClinicSettings(),
        getProcurementSettings(),
      ]);

      setPo(data);
      setClinic(clinicData);
      setProcurementSettings(settingsData);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to load purchase order.",
          "[PurchaseOrderDetail] load failed:"
        )
      );
    } finally {
      setLoading(false);
    }
  }

  async function downloadPDF() {
    if (!documentRef.current || !po) return;

    try {
      const dataUrl = await toPng(documentRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      const img = new Image();
      img.src = dataUrl;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load generated image."));
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = (img.height * pageWidth) / img.width;

      pdf.addImage(dataUrl, "PNG", 0, 0, pageWidth, pageHeight);
      pdf.save(`${po.po_number}.pdf`);
    } catch (error) {
      logError("[PurchaseOrderDetail] downloadPDF failed:", error);

      toast.error("Failed to generate PDF.");
    }
  }

  async function handleSent(via: "Email" | "WhatsApp", contactId: string | null) {
    if (!po) return;

    await sendPurchaseOrder(po.id, via, contactId);

    await load();
  }

  const [receiving, setReceiving] = useState(false);

  async function handleReceiveGoods() {
    if (!po) return;

    try {
      setReceiving(true);

      const grn = await createGRNFromPurchaseOrder(po.id);

      router.push(`/admin/inventory/grns/${grn.id}`);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to start receiving.",
          "[PurchaseOrderDetail] createGRNFromPurchaseOrder failed:"
        )
      );
    } finally {
      setReceiving(false);
    }
  }

  async function handleSaveItem(input: {
    inventory_item_id: string;
    description: string | null;
    quantity: number;
    unit: string;
    unit_price: number;
  }) {
    if (!po) return;

    if (selectedItem) {
      await updatePurchaseOrderItem(selectedItem.id, po.id, input);
    } else {
      await addPurchaseOrderItem(
        po.id,
        input,
        po.clinic_purchase_order_items.length
      );
    }

    await load();
  }

  async function confirmRemoveItem() {
    if (!po || !removingItem) return;

    try {
      setBusy(true);

      await removePurchaseOrderItem(removingItem.id, po.id);

      toast.success("Item removed.");

      setRemoveDialogOpen(false);
      setRemovingItem(null);

      await load();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to remove item.",
          "[PurchaseOrderDetail] remove item failed:"
        )
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!po) return;

    try {
      setBusy(true);

      await cancelPurchaseOrder(po.id);

      toast.success("Purchase order cancelled.");

      setCancelDialogOpen(false);

      await load();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to cancel purchase order.",
          "[PurchaseOrderDetail] cancel failed:"
        )
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingSpinner text="Loading purchase order..." />;
  }

  if (!po) {
    return (
      <EmptyState
        title="Purchase order not found"
        description="This purchase order may have been removed."
      />
    );
  }

  const isDraft = po.status === "Draft";
  const canCancel = canManage && (po.status === "Draft" || po.status === "Sent");

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            onClick={() => router.push("/admin/inventory/purchase-orders")}
            className="mb-2 text-sm font-semibold text-eucalyptus hover:underline"
          >
            ← Back to Purchase Orders
          </button>

          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{po.po_number}</h1>
            <POStatusBadge status={po.status} />
          </div>
        </div>

        {canManage && (
          <div className="flex gap-3">
            {isDraft && (
              <Button variant="secondary" onClick={() => setHeaderModalOpen(true)}>
                Edit Details
              </Button>
            )}
            {(po.status === "Draft" || po.status === "Sent") &&
              po.clinic_purchase_order_items.length > 0 && (
                <Button onClick={() => setSendModalOpen(true)}>Send</Button>
              )}
            {(po.status === "Sent" || po.status === "Partially Received") && (
              <Button disabled={receiving} onClick={handleReceiveGoods}>
                {receiving ? "Starting..." : "Receive Goods"}
              </Button>
            )}
            {canCancel && (
              <Button variant="danger" onClick={() => setCancelDialogOpen(true)}>
                Cancel
              </Button>
            )}
          </div>
        )}
      </div>

      <Card title="Purchase Order Details">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Supplier
            </p>
            <p className="mt-1 text-graphite">
              {po.clinic_suppliers?.name ?? "-"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Contact
            </p>
            <p className="mt-1 text-graphite">
              {po.clinic_supplier_contacts?.name ?? "-"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Order Date
            </p>
            <p className="mt-1 text-graphite">
              {new Date(po.order_date).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Expected Delivery
            </p>
            <p className="mt-1 text-graphite">
              {po.expected_delivery_date
                ? new Date(po.expected_delivery_date).toLocaleDateString()
                : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Delivery Location
            </p>
            <p className="mt-1 text-graphite">{po.delivery_location || "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Notes
            </p>
            <p className="mt-1 text-graphite">{po.notes || "-"}</p>
          </div>
        </div>
      </Card>

      <Card title="Items">
        {isDraft && canManage && (
          <div className="mb-4 flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedItem(null);
                setItemModalOpen(true);
              }}
            >
              + Add Item
            </Button>
          </div>
        )}

        {po.clinic_purchase_order_items.length === 0 ? (
          <p className="py-6 text-center text-sm text-mineral">
            No items added yet.
          </p>
        ) : (
          <div className="space-y-3">
            {po.clinic_purchase_order_items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-lg border border-sea-glass px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-semibold text-graphite">
                    {item.clinic_inventory_items?.name ?? "Unknown item"}
                  </p>
                  {item.description && (
                    <p className="text-sm text-mineral">{item.description}</p>
                  )}
                  <p className="mt-1 text-sm text-slate-600">
                    {item.quantity} {item.unit} × {formatCurrency(item.unit_price)}
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <p className="font-semibold text-graphite">
                    {formatCurrency(item.line_total)}
                  </p>

                  {isDraft && canManage && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setSelectedItem(item);
                          setItemModalOpen(true);
                        }}
                        className="rounded-lg p-2 text-slate-500 hover:bg-porcelain"
                        aria-label="Edit item"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => {
                          setRemovingItem(item);
                          setRemoveDialogOpen(true);
                        }}
                        className="rounded-lg p-2 text-clay hover:bg-porcelain"
                        aria-label="Remove item"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div className="flex justify-end border-t border-sea-glass pt-4">
              <div className="w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-mineral">Subtotal</span>
                  <span className="font-medium text-graphite">
                    {formatCurrency(po.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span>Total</span>
                  <span>{formatCurrency(po.total)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      {clinic && procurementSettings && (
        <>
          <div className="flex justify-end gap-3 print:hidden">
            <Button variant="secondary" onClick={downloadPDF}>
              Download PDF
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
          </div>

          <div ref={documentRef}>
            <PurchaseOrderDocument
              po={po}
              clinic={clinic}
              settings={procurementSettings}
            />
          </div>
        </>
      )}

      <SendDocumentModal
        open={sendModalOpen}
        supplierId={po.supplier_id}
        defaultSubject={`Purchase Order ${po.po_number} — ${clinic?.clinic_name ?? ""}`}
        defaultMessage={`Hello,\n\nPlease find Purchase Order ${po.po_number} from ${clinic?.clinic_name ?? "our clinic"}.\n\nItems:\n${po.clinic_purchase_order_items
          .map(
            (item) =>
              `- ${item.clinic_inventory_items?.name ?? "Item"} — ${item.quantity} ${item.unit}`
          )
          .join("\n")}\n\nExpected delivery: ${
          po.expected_delivery_date
            ? new Date(po.expected_delivery_date).toLocaleDateString()
            : "TBC"
        }\n\nThank you.`}
        onClose={() => setSendModalOpen(false)}
        onSent={handleSent}
      />

      <POHeaderModal
        open={headerModalOpen}
        po={po}
        onClose={() => setHeaderModalOpen(false)}
        onSaved={load}
      />

      <POItemModal
        open={itemModalOpen}
        item={selectedItem}
        onClose={() => setItemModalOpen(false)}
        onSave={handleSaveItem}
      />

      <ConfirmDialog
        open={removeDialogOpen}
        title="Remove item"
        description={
          removingItem
            ? `Remove "${removingItem.clinic_inventory_items?.name ?? "this item"}" from the purchase order?`
            : undefined
        }
        confirmText="Remove"
        loading={busy}
        onCancel={() => setRemoveDialogOpen(false)}
        onConfirm={confirmRemoveItem}
      />

      <ConfirmDialog
        open={cancelDialogOpen}
        title="Cancel purchase order"
        description="This purchase order will be marked Cancelled. This cannot be undone."
        confirmText="Cancel Purchase Order"
        loading={busy}
        onCancel={() => setCancelDialogOpen(false)}
        onConfirm={confirmCancel}
      />
    </div>
  );
}

export default function PurchaseOrderDetailPage() {
  return (
    <PermissionGuard permission="procurement">
      <PurchaseOrderDetailContent />
    </PermissionGuard>
  );
}
